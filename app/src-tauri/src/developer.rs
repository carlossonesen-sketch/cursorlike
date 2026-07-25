use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

const OUTPUT_LIMIT_BYTES: usize = 2 * 1024 * 1024;
const SEARCH_LIMIT: usize = 200;
const SEARCH_FILE_LIMIT: u64 = 2 * 1024 * 1024;
const IGNORED_DIRS: &[&str] = &[".git", "node_modules", "target", "dist", "build", ".next", ".devassistant"];

pub struct DeveloperCommandRegistry {
    runs: Arc<Mutex<HashMap<String, ActiveRun>>>,
}

impl Default for DeveloperCommandRegistry {
    fn default() -> Self {
        Self { runs: Arc::new(Mutex::new(HashMap::new())) }
    }
}

struct ActiveRun {
    pid: u32,
    cancelled: Arc<AtomicBool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeveloperCommandRequest {
    pub run_id: String,
    pub workspace_root: String,
    pub command: String,
    pub purpose: String,
    pub risk: String,
    pub timeout_ms: u64,
    pub approved: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeveloperCommandResult {
    pub run_id: String,
    pub command: String,
    pub working_directory: String,
    pub duration_ms: u64,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub timed_out: bool,
    pub cancelled: bool,
    pub truncated: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeveloperOutputEvent {
    run_id: String,
    stream: String,
    chunk: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeveloperWorkspaceInfo {
    pub canonical_path: String,
    pub branch: String,
    pub dirty: bool,
    pub status: String,
    pub diff: String,
}

#[derive(Serialize)]
pub struct RepositorySearchMatch {
    pub path: String,
    pub line: Option<u32>,
    pub preview: Option<String>,
}

fn parse_git_status(status: &str) -> (String, bool) {
    let mut lines = status.lines();
    let first = lines.next().unwrap_or("");
    let branch = first
        .strip_prefix("## ")
        .unwrap_or("")
        .split("...")
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    (branch, lines.any(|line| !line.trim().is_empty()))
}

fn canonical_workspace(root: &str) -> Result<PathBuf, String> {
    let root = Path::new(root);
    if !root.is_absolute() {
        return Err("Workspace path must be absolute.".into());
    }
    let canonical = root.canonicalize().map_err(|error| error.to_string())?;
    if !canonical.is_dir() {
        return Err("Workspace path must be a directory.".into());
    }
    Ok(canonical)
}

fn run_git(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[tauri::command]
pub fn developer_inspect_workspace(workspace_root: String) -> Result<DeveloperWorkspaceInfo, String> {
    let root = canonical_workspace(&workspace_root)?;
    let status = run_git(&root, &["status", "--short", "--branch"])
        .map_err(|error| format!("The selected folder is not a readable Git repository: {error}"))?;
    let explicit_branch = run_git(&root, &["branch", "--show-current"]).unwrap_or_default().trim().to_string();
    let (status_branch, dirty) = parse_git_status(&status);
    let branch = if explicit_branch.is_empty() { status_branch } else { explicit_branch };
    let diff = run_git(&root, &["diff", "--no-ext-diff", "--"]).unwrap_or_default();
    Ok(DeveloperWorkspaceInfo {
        canonical_path: root.to_string_lossy().into_owned(),
        branch,
        dirty,
        status,
        diff,
    })
}

fn walk_repository(root: &Path, dir: &Path, output: &mut Vec<PathBuf>) -> Result<(), String> {
    if output.len() >= SEARCH_LIMIT {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        let canonical = path.canonicalize().map_err(|error| error.to_string())?;
        if !canonical.starts_with(root) {
            return Err(format!("Repository entry escapes canonical workspace: {}", path.display()));
        }
        if file_type.is_dir() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !IGNORED_DIRS.iter().any(|ignored| ignored.eq_ignore_ascii_case(&name)) {
                walk_repository(root, &canonical, output)?;
            }
        } else if file_type.is_file() {
            output.push(canonical);
            if output.len() >= SEARCH_LIMIT {
                break;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn developer_search_repository(
    workspace_root: String,
    query: String,
    mode: String,
) -> Result<Vec<RepositorySearchMatch>, String> {
    let root = canonical_workspace(&workspace_root)?;
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    walk_repository(&root, &root, &mut files)?;
    let mut matches = Vec::new();
    for file in files {
        let relative = file.strip_prefix(&root).map_err(|error| error.to_string())?;
        let relative_string = relative.to_string_lossy().replace('\\', "/");
        if mode == "filename" {
            if relative_string.to_lowercase().contains(&needle) {
                matches.push(RepositorySearchMatch { path: relative_string, line: None, preview: None });
            }
            continue;
        }
        let metadata = std::fs::metadata(&file).map_err(|error| error.to_string())?;
        if metadata.len() > SEARCH_FILE_LIMIT {
            continue;
        }
        let mut bytes = Vec::new();
        std::fs::File::open(&file)
            .and_then(|mut value| value.read_to_end(&mut bytes))
            .map_err(|error| error.to_string())?;
        if bytes.iter().take(4096).any(|byte| *byte == 0) {
            continue;
        }
        let content = String::from_utf8_lossy(&bytes);
        for (index, line) in content.lines().enumerate() {
            if line.to_lowercase().contains(&needle) {
                matches.push(RepositorySearchMatch {
                    path: relative_string.clone(),
                    line: Some((index + 1) as u32),
                    preview: Some(line.trim().chars().take(240).collect()),
                });
                if matches.len() >= SEARCH_LIMIT {
                    return Ok(matches);
                }
            }
        }
    }
    Ok(matches)
}

fn command_policy(command: &str) -> Option<(&'static str, Vec<&'static str>)> {
    match command.trim().to_ascii_lowercase().as_str() {
        "npm run build" | "npm.cmd run build" => Some(("npm.cmd", vec!["run", "build"])),
        "npm test" | "npm run test" | "npm.cmd test" | "npm.cmd run test" => Some(("npm.cmd", vec!["test"])),
        "npm run lint" | "npm.cmd run lint" => Some(("npm.cmd", vec!["run", "lint"])),
        "npm run typecheck" | "npm.cmd run typecheck" => Some(("npm.cmd", vec!["run", "typecheck"])),
        "npm run check" | "npm.cmd run check" => Some(("npm.cmd", vec!["run", "check"])),
        "pnpm run build" => Some(("pnpm.cmd", vec!["run", "build"])),
        "pnpm test" => Some(("pnpm.cmd", vec!["test"])),
        "yarn build" => Some(("yarn.cmd", vec!["build"])),
        "yarn test" => Some(("yarn.cmd", vec!["test"])),
        "cargo check" => Some(("cargo", vec!["check"])),
        "cargo build" => Some(("cargo", vec!["build"])),
        "cargo test" => Some(("cargo", vec!["test"])),
        "git status --short --branch" => Some(("git", vec!["status", "--short", "--branch"])),
        "git diff" => Some(("git", vec!["diff", "--no-ext-diff", "--"])),
        "git diff --stat" => Some(("git", vec!["diff", "--stat", "--"])),
        "git log -n 20 --oneline" => Some(("git", vec!["log", "-n", "20", "--oneline"])),
        _ => None,
    }
}

fn validate_command_request(request: &DeveloperCommandRequest) -> Result<(), String> {
    if !request.approved {
        return Err("Developer command requires explicit approval.".into());
    }
    if request.purpose.trim().is_empty() || request.risk.trim().is_empty() {
        return Err("Command purpose and risk are required.".into());
    }
    if command_policy(&request.command).is_none() {
        return Err(format!(
            "Command is not in the exact Developer Mode policy: {}",
            request.command
        ));
    }
    Ok(())
}

fn should_stop_command(cancelled: bool, elapsed: Duration, timeout: Duration) -> bool {
    cancelled || elapsed >= timeout
}

fn append_limited(target: &Arc<Mutex<(String, bool)>>, text: &str) {
    if let Ok(mut guard) = target.lock() {
        if guard.0.len() >= OUTPUT_LIMIT_BYTES {
            guard.1 = true;
            return;
        }
        let remaining = OUTPUT_LIMIT_BYTES - guard.0.len();
        if text.len() > remaining {
            guard.0.push_str(&text[..text.floor_char_boundary(remaining)]);
            guard.1 = true;
        } else {
            guard.0.push_str(text);
        }
    }
}

fn stream_reader<R: Read + Send + 'static>(
    reader: R,
    app: AppHandle,
    run_id: String,
    stream: &'static str,
    sink: Arc<Mutex<(String, bool)>>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            let chunk = format!("{line}\n");
            append_limited(&sink, &chunk);
            let _ = app.emit("developer-command-output", DeveloperOutputEvent {
                run_id: run_id.clone(),
                stream: stream.to_string(),
                chunk,
            });
        }
    })
}

fn terminate_process_tree(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

#[tauri::command]
pub fn developer_cancel_command(
    run_id: String,
    registry: State<'_, DeveloperCommandRegistry>,
) -> Result<bool, String> {
    let runs = registry.runs.lock().map_err(|_| "Command registry is unavailable.")?;
    let Some(active) = runs.get(&run_id) else {
        return Ok(false);
    };
    active.cancelled.store(true, Ordering::SeqCst);
    terminate_process_tree(active.pid);
    Ok(true)
}

#[tauri::command]
pub async fn developer_run_approved_command(
    request: DeveloperCommandRequest,
    app: AppHandle,
    registry: State<'_, DeveloperCommandRegistry>,
) -> Result<DeveloperCommandResult, String> {
    let runs = registry.runs.clone();
    tauri::async_runtime::spawn_blocking(move || run_approved_command_blocking(request, app, runs))
        .await
        .map_err(|error| format!("Command task failed: {error}"))?
}

fn run_approved_command_blocking(
    request: DeveloperCommandRequest,
    app: AppHandle,
    runs_registry: Arc<Mutex<HashMap<String, ActiveRun>>>,
) -> Result<DeveloperCommandResult, String> {
    validate_command_request(&request)?;
    let root = canonical_workspace(&request.workspace_root)?;
    let (program, args) = command_policy(&request.command)
        .ok_or_else(|| format!("Command is not in the exact Developer Mode policy: {}", request.command))?;
    let timeout_ms = request.timeout_ms.clamp(1_000, 30 * 60 * 1_000);
    let mut child = Command::new(program)
        .args(args)
        .current_dir(&root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    let pid = child.id();
    let cancelled_flag = Arc::new(AtomicBool::new(false));
    {
        let mut runs = runs_registry.lock().map_err(|_| "Command registry is unavailable.")?;
        if runs.contains_key(&request.run_id) {
            let _ = child.kill();
            return Err("A command with this run id is already active.".into());
        }
        runs.insert(request.run_id.clone(), ActiveRun { pid, cancelled: cancelled_flag.clone() });
    }
    let stdout_sink = Arc::new(Mutex::new((String::new(), false)));
    let stderr_sink = Arc::new(Mutex::new((String::new(), false)));
    let stdout_thread = child.stdout.take().map(|reader| {
        stream_reader(reader, app.clone(), request.run_id.clone(), "stdout", stdout_sink.clone())
    });
    let stderr_thread = child.stderr.take().map(|reader| {
        stream_reader(reader, app, request.run_id.clone(), "stderr", stderr_sink.clone())
    });
    let started = Instant::now();
    let mut timed_out = false;
    let exit_code = loop {
        if cancelled_flag.load(Ordering::SeqCst) {
            terminate_process_tree(pid);
            let _ = child.kill();
            break -1;
        }
        if should_stop_command(false, started.elapsed(), Duration::from_millis(timeout_ms)) {
            timed_out = true;
            terminate_process_tree(pid);
            let _ = child.kill();
            break -1;
        }
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            break status.code().unwrap_or(-1);
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let _ = child.wait();
    if let Some(thread) = stdout_thread { let _ = thread.join(); }
    if let Some(thread) = stderr_thread { let _ = thread.join(); }
    if let Ok(mut runs) = runs_registry.lock() {
        runs.remove(&request.run_id);
    }
    let (stdout, stdout_truncated) = stdout_sink.lock().map(|value| value.clone()).unwrap_or_default();
    let (stderr, stderr_truncated) = stderr_sink.lock().map(|value| value.clone()).unwrap_or_default();
    Ok(DeveloperCommandResult {
        run_id: request.run_id,
        command: request.command,
        working_directory: root.to_string_lossy().into_owned(),
        duration_ms: started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
        stdout,
        stderr,
        exit_code,
        timed_out,
        cancelled: cancelled_flag.load(Ordering::SeqCst),
        truncated: stdout_truncated || stderr_truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_command_policy_rejects_shell_composition_and_install() {
        assert!(command_policy("npm run build").is_some());
        assert!(command_policy("cargo test").is_some());
        assert!(command_policy("npm install").is_none());
        assert!(command_policy("npm run build && whoami").is_none());
        assert!(command_policy("git push").is_none());
    }

    #[test]
    fn command_approval_is_enforced() {
        let request = DeveloperCommandRequest {
            run_id: "test".into(),
            workspace_root: ".".into(),
            command: "git status --short --branch".into(),
            purpose: "Inspect status".into(),
            risk: "Read-only".into(),
            timeout_ms: 1_000,
            approved: false,
        };
        assert!(validate_command_request(&request).unwrap_err().contains("explicit approval"));
    }

    #[test]
    fn timeout_and_cancellation_stop_conditions_are_enforced() {
        assert!(should_stop_command(true, Duration::ZERO, Duration::from_secs(30)));
        assert!(should_stop_command(false, Duration::from_secs(30), Duration::from_secs(30)));
        assert!(!should_stop_command(false, Duration::from_secs(1), Duration::from_secs(30)));
    }

    #[test]
    fn git_status_parser_reports_branch_and_dirty_state() {
        assert_eq!(parse_git_status("## main...origin/main\n").0, "main");
        assert!(!parse_git_status("## main...origin/main\n").1);
        assert!(parse_git_status("## feature\n M src/main.ts\n?? new.ts\n").1);
    }

    #[test]
    fn output_limit_is_enforced() {
        let sink = Arc::new(Mutex::new((String::new(), false)));
        append_limited(&sink, &"x".repeat(OUTPUT_LIMIT_BYTES + 10));
        let value = sink.lock().unwrap();
        assert_eq!(value.0.len(), OUTPUT_LIMIT_BYTES);
        assert!(value.1);
    }

    #[test]
    fn repository_search_finds_filenames_and_text() {
        let root = std::env::temp_dir().join(format!(
            "nf-developer-search-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src").join("needle-file.ts"), "const unique_phrase = true;\n")
            .unwrap();

        let filenames = developer_search_repository(
            root.to_string_lossy().into_owned(),
            "needle-file".into(),
            "filename".into(),
        )
        .unwrap();
        assert_eq!(filenames.len(), 1);
        assert_eq!(filenames[0].path, "src/needle-file.ts");

        let text = developer_search_repository(
            root.to_string_lossy().into_owned(),
            "unique_phrase".into(),
            "text".into(),
        )
        .unwrap();
        assert_eq!(text.len(), 1);
        assert_eq!(text[0].line, Some(1));

        std::fs::remove_dir_all(root).unwrap();
    }
}
