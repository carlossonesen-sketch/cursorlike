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
const SEARCH_SCAN_LIMIT: usize = 100_000;
const SEARCH_FILE_LIMIT: u64 = 2 * 1024 * 1024;
const IGNORED_DIRS: &[&str] = &[
    ".git",
    ".dart_tool",
    ".gradle",
    ".idea",
    ".next",
    ".devassistant",
    "node_modules",
    "Pods",
    "target",
    "dist",
    "build",
];

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
    pub repository_name: String,
    pub branch: String,
    pub head: String,
    pub dirty: bool,
    pub status: String,
    pub diff: String,
    pub profile: DeveloperWorkspaceProfile,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeveloperWorkspaceProfile {
    pub project_type: String,
    pub project_name: Option<String>,
    pub flutter_sdk_available: bool,
    pub dart_sdk_available: bool,
    pub suggested_commands: Vec<DeveloperSuggestedCommand>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeveloperSuggestedCommand {
    pub label: String,
    pub command: String,
    pub permitted: bool,
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

fn executable_available(name: &str) -> bool {
    let Some(path) = std::env::var_os("PATH") else { return false };
    let extensions: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into())
            .split(';')
            .map(|value| value.to_ascii_lowercase())
            .collect()
    } else {
        vec![String::new()]
    };
    std::env::split_paths(&path).any(|directory| {
        extensions.iter().any(|extension| {
            directory.join(format!("{name}{extension}")).is_file()
                || directory.join(name).is_file()
        })
    })
}

fn parse_pubspec_name(root: &Path) -> Option<String> {
    let text = std::fs::read_to_string(root.join("pubspec.yaml")).ok()?;
    text.lines().find_map(|line| {
        let trimmed = line.trim();
        if line.chars().next().is_some_and(char::is_whitespace) || !trimmed.starts_with("name:") {
            return None;
        }
        let value = trimmed.strip_prefix("name:")?.trim().trim_matches(['\'', '"']);
        if !value.is_empty()
            && value.len() <= 100
            && value.chars().all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
        {
            Some(value.to_string())
        } else {
            None
        }
    })
}

fn workspace_profile(root: &Path) -> DeveloperWorkspaceProfile {
    let flutter = root.join("pubspec.yaml").is_file()
        && root.join("lib").is_dir()
        && (root.join("android").is_dir() || root.join("ios").is_dir());
    let commands = if flutter {
        [
            ("Get dependencies", "flutter pub get"),
            ("Analyze", "flutter analyze"),
            ("Run tests", "flutter test"),
            ("Check formatting", "dart format --output=none --set-exit-if-changed lib"),
        ]
        .into_iter()
        .map(|(label, command)| DeveloperSuggestedCommand {
            label: label.into(),
            command: command.into(),
            permitted: resolve_command(command, Some(root)).is_ok(),
        })
        .collect()
    } else {
        Vec::new()
    };
    DeveloperWorkspaceProfile {
        project_type: if flutter { "Flutter" } else { "Unknown" }.into(),
        project_name: if flutter { parse_pubspec_name(root) } else { None },
        flutter_sdk_available: executable_available("flutter"),
        dart_sdk_available: executable_available("dart"),
        suggested_commands: commands,
    }
}

#[tauri::command]
pub fn developer_inspect_workspace(workspace_root: String) -> Result<DeveloperWorkspaceInfo, String> {
    let root = canonical_workspace(&workspace_root)?;
    let status = run_git(&root, &["status", "--short", "--branch"])
        .map_err(|error| format!("The selected folder is not a readable Git repository: {error}"))?;
    let explicit_branch = run_git(&root, &["branch", "--show-current"]).unwrap_or_default().trim().to_string();
    let (status_branch, dirty) = parse_git_status(&status);
    let branch = if explicit_branch.is_empty() { status_branch } else { explicit_branch };
    let head = run_git(&root, &["rev-parse", "HEAD"])?.trim().to_string();
    let diff = run_git(&root, &["diff", "--no-ext-diff", "--"]).unwrap_or_default();
    let repository_name = root.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.to_string_lossy().into_owned());
    Ok(DeveloperWorkspaceInfo {
        canonical_path: root.to_string_lossy().into_owned(),
        repository_name,
        branch,
        head,
        dirty,
        status,
        diff,
        profile: workspace_profile(&root),
    })
}

fn walk_repository(root: &Path, dir: &Path, output: &mut Vec<PathBuf>) -> Result<(), String> {
    if output.len() >= SEARCH_SCAN_LIMIT {
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
            if output.len() >= SEARCH_SCAN_LIMIT {
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
                if matches.len() >= SEARCH_LIMIT {
                    return Ok(matches);
                }
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

pub(crate) struct ResolvedCommand {
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
}

fn tokenize_command(command: &str) -> Result<Vec<String>, String> {
    if command.trim() != command || command.is_empty() || command.contains(['\r', '\n', '\0']) {
        return Err("Command contains leading, trailing, or hidden tokens.".into());
    }
    if command.chars().any(|character| matches!(character, '&' | '|' | '>' | '<' | ';' | '`' | '$')) {
        return Err("Shell metacharacters, interpolation, pipes, and redirection are not permitted.".into());
    }
    let mut tokens = Vec::new();
    let mut token = String::new();
    let mut quote = None;
    for character in command.chars() {
        if let Some(active) = quote {
            if character == active {
                quote = None;
            } else {
                token.push(character);
            }
        } else if matches!(character, '\'' | '"') {
            quote = Some(character);
        } else if character.is_whitespace() {
            if !token.is_empty() {
                tokens.push(std::mem::take(&mut token));
            }
        } else {
            token.push(character);
        }
    }
    if quote.is_some() {
        return Err("Command contains an unterminated quote.".into());
    }
    if !token.is_empty() {
        tokens.push(token);
    }
    if tokens.is_empty() {
        return Err("Command is empty.".into());
    }
    Ok(tokens)
}

fn validate_format_target(root: &Path, target: &str) -> Result<String, String> {
    let relative = Path::new(target);
    if target.is_empty() || relative.is_absolute() || relative.components().any(|part| matches!(part, std::path::Component::ParentDir)) {
        return Err("Dart format target must be an explicit workspace-relative path without '..'.".into());
    }
    let canonical = root.join(relative).canonicalize()
        .map_err(|_| "Dart format target must already exist inside the workspace.".to_string())?;
    if !canonical.starts_with(root) {
        return Err("Dart format target escapes the canonical workspace.".into());
    }
    Ok(relative.to_string_lossy().into_owned())
}

pub(crate) fn resolve_command(command: &str, root: Option<&Path>) -> Result<ResolvedCommand, String> {
    let tokens = tokenize_command(command)?;
    let lower: Vec<String> = tokens.iter().map(|token| token.to_ascii_lowercase()).collect();
    let exact = |program: &str, args: &[&str]| ResolvedCommand {
        program: program.into(),
        args: args.iter().map(|value| (*value).into()).collect(),
    };
    let resolved = match lower.as_slice() {
        [program, run, action] if matches!(program.as_str(), "npm" | "npm.cmd")
            && run == "run" && matches!(action.as_str(), "build" | "lint" | "typecheck" | "check") =>
            exact("npm.cmd", &["run", action]),
        [program, action] if matches!(program.as_str(), "npm" | "npm.cmd") && action == "test" =>
            exact("npm.cmd", &["test"]),
        [program, run, action] if matches!(program.as_str(), "npm" | "npm.cmd") && run == "run" && action == "test" =>
            exact("npm.cmd", &["test"]),
        [program, run, action] if program == "pnpm" && run == "run" && action == "build" =>
            exact("pnpm.cmd", &["run", "build"]),
        [program, action] if program == "pnpm" && action == "test" => exact("pnpm.cmd", &["test"]),
        [program, action] if program == "yarn" && matches!(action.as_str(), "build" | "test") =>
            exact("yarn.cmd", &[action]),
        [program, action] if program == "cargo" && matches!(action.as_str(), "check" | "build" | "test") =>
            exact("cargo", &[action]),
        [program, flag] if program == "flutter" && flag == "--version" => exact("flutter", &["--version"]),
        [program, doctor] if program == "flutter" && doctor == "doctor" => exact("flutter", &["doctor"]),
        [program, doctor, verbose] if program == "flutter" && doctor == "doctor" && verbose == "-v" =>
            exact("flutter", &["doctor", "-v"]),
        [program, pub_arg, get] if program == "flutter" && pub_arg == "pub" && get == "get" =>
            exact("flutter", &["pub", "get"]),
        [program, action] if program == "flutter" && matches!(action.as_str(), "analyze" | "test") =>
            exact("flutter", &[action]),
        [program, flag] if program == "dart" && flag == "--version" => exact("dart", &["--version"]),
        [program, action] if program == "dart" && action == "analyze" => exact("dart", &["analyze"]),
        [program, format, target] if program == "dart" && format == "format" => {
            let root = root.ok_or_else(|| "Workspace is required for a Dart format target.".to_string())?;
            ResolvedCommand { program: "dart".into(), args: vec!["format".into(), validate_format_target(root, target)?] }
        }
        [program, format, output, changed, target]
            if program == "dart" && format == "format" && output == "--output=none"
                && changed == "--set-exit-if-changed" => {
            let root = root.ok_or_else(|| "Workspace is required for a Dart format target.".to_string())?;
            ResolvedCommand {
                program: "dart".into(),
                args: vec!["format".into(), "--output=none".into(), "--set-exit-if-changed".into(), validate_format_target(root, target)?],
            }
        }
        [program, status, short] if program == "git" && status == "status" && short == "--short" =>
            exact("git", &["status", "--short"]),
        [program, status, short, branch] if program == "git" && status == "status" && short == "--short" && branch == "--branch" =>
            exact("git", &["status", "--short", "--branch"]),
        [program, branch, current] if program == "git" && branch == "branch" && current == "--show-current" =>
            exact("git", &["branch", "--show-current"]),
        [program, diff] if program == "git" && diff == "diff" =>
            exact("git", &["diff", "--no-ext-diff", "--"]),
        [program, diff, option] if program == "git" && diff == "diff" && option == "--stat" =>
            exact("git", &["diff", "--stat", "--"]),
        [program, diff, option] if program == "git" && diff == "diff" && option == "--check" =>
            exact("git", &["diff", "--check", "--"]),
        [program, log, count, amount, oneline]
            if program == "git" && log == "log" && count == "-n" && amount == "20" && oneline == "--oneline" =>
            exact("git", &["log", "-n", "20", "--oneline"]),
        _ => return Err(format!("Command is not in the structured Developer Mode policy: {command}")),
    };
    Ok(resolved)
}

fn validate_command_request(request: &DeveloperCommandRequest) -> Result<(), String> {
    if !request.approved {
        return Err("Developer command requires explicit approval.".into());
    }
    if request.purpose.trim().is_empty() || request.risk.trim().is_empty() {
        return Err("Command purpose and risk are required.".into());
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
    let root = canonical_workspace(&request.workspace_root)?;
    validate_command_request(&request)?;
    let resolved = resolve_command(&request.command, Some(&root))?;
    let timeout_ms = request.timeout_ms.clamp(1_000, 30 * 60 * 1_000);
    let mut child = Command::new(&resolved.program)
        .args(&resolved.args)
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
        let root = std::env::current_dir().unwrap();
        assert!(resolve_command("npm run build", Some(&root)).is_ok());
        assert!(resolve_command("cargo test", Some(&root)).is_ok());
        assert!(resolve_command("npm install", Some(&root)).is_err());
        assert!(resolve_command("npm run build && whoami", Some(&root)).is_err());
        assert!(resolve_command("git push", Some(&root)).is_err());
    }

    #[test]
    fn curated_flutter_dart_and_git_commands_are_exact() {
        let root = std::env::temp_dir().join(format!("nf-command-policy-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("lib")).unwrap();
        std::fs::write(root.join("lib/main.dart"), "void main() {}\n").unwrap();
        let canonical = root.canonicalize().unwrap();
        for command in [
            "flutter --version", "flutter doctor", "flutter doctor -v", "dart --version",
            "flutter pub get", "flutter analyze", "dart analyze", "flutter test",
            "dart format lib", "dart format lib/main.dart",
            "dart format --output=none --set-exit-if-changed lib",
            "git status --short", "git status --short --branch", "git branch --show-current",
            "git diff", "git diff --stat", "git diff --check",
        ] {
            assert!(resolve_command(command, Some(&canonical)).is_ok(), "expected permitted: {command}");
        }
        for command in [
            "flutter run", "flutter build", "flutter clean", "flutter pub upgrade",
            "dart fix --apply", "dart format", "dart format --line-length 120 lib",
            "dart format ..", "dart format C:\\other-project", "dart format lib && git status",
            "dart format lib | more", "dart format $(malicious)", "dart format lib > out.txt",
            "git commit", "git push", "git checkout main", "git reset --hard",
            "git restore .", "git clean -fd", "git stash", "git merge main", "git rebase main",
            "flutter analyze extra", "flutterx analyze", "git status --short hidden",
            "git status --short\nwhoami", "\"flutter analyze && git status\"",
        ] {
            assert!(resolve_command(command, Some(&canonical)).is_err(), "expected rejected: {command}");
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn dart_format_rejects_windows_junction_escape() {
        let root = std::env::temp_dir().join(format!("nf-command-junction-{}", std::process::id()));
        let outside = std::env::temp_dir().join(format!("nf-command-outside-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let status = Command::new("cmd")
            .args(["/C", "mklink", "/J", root.join("escape").to_str().unwrap(), outside.to_str().unwrap()])
            .status()
            .unwrap();
        assert!(status.success());
        assert!(resolve_command("dart format escape", Some(&root.canonicalize().unwrap())).is_err());
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&outside).unwrap();
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

    #[test]
    fn flutter_profile_is_generic_and_does_not_execute_commands() {
        let root = std::env::temp_dir().join(format!("nf-flutter-profile-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("lib")).unwrap();
        std::fs::create_dir_all(root.join("android")).unwrap();
        std::fs::write(root.join("pubspec.yaml"), "name: sample_flutter_app\nversion: 1.0.0\n").unwrap();
        let canonical = root.canonicalize().unwrap();
        let profile = workspace_profile(&canonical);
        assert_eq!(profile.project_type, "Flutter");
        assert_eq!(profile.project_name.as_deref(), Some("sample_flutter_app"));
        assert_eq!(profile.suggested_commands.len(), 4);
        assert!(profile.suggested_commands.iter().all(|command| command.permitted));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn configured_real_repository_can_be_inspected_without_writes() {
        let Ok(root) = std::env::var("NF_DEVELOPER_VALIDATION_REPOSITORY") else {
            return;
        };
        let info = developer_inspect_workspace(root.clone()).unwrap();
        assert_eq!(
            std::fs::canonicalize(&info.canonical_path).unwrap(),
            std::fs::canonicalize(&root).unwrap()
        );
        assert!(!info.branch.trim().is_empty());
        assert!(!info.head.trim().is_empty());
        assert!(!info.repository_name.trim().is_empty());
        let pubspec = developer_search_repository(
            root.clone(),
            "pubspec.yaml".into(),
            "filename".into(),
        )
        .unwrap();
        assert!(pubspec.iter().any(|entry| entry.path == "pubspec.yaml"));
        let markdown = developer_search_repository(root.clone(), ".md".into(), "filename".into()).unwrap();
        assert!(!markdown.is_empty());
        let dart = developer_search_repository(root, "main.dart".into(), "filename".into()).unwrap();
        assert!(dart.iter().any(|entry| entry.path.ends_with("main.dart")));
        assert_eq!(info.profile.project_type, "Flutter");
        assert!(info.profile.project_name.is_some());
        assert!(info.profile.suggested_commands.iter().all(|command| command.permitted));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_process_reports_nonzero_exit_and_enforces_cwd() {
        let root = std::env::temp_dir().join(format!("nf-command-cwd-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let output = Command::new("cmd.exe")
            .args(["/D", "/C", "cd & exit /b 7"])
            .current_dir(&root)
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(7));
        let cwd = String::from_utf8_lossy(&output.stdout).trim().to_string();
        assert_eq!(
            std::fs::canonicalize(cwd).unwrap(),
            std::fs::canonicalize(&root).unwrap()
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_cancellation_terminates_descendant_process_tree() {
        let root = std::env::temp_dir().join(format!("nf-command-tree-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let pid_file = root.join("child.pid");
        let script = format!(
            "$child=Start-Process ping.exe -ArgumentList '127.0.0.1','-n','120' -PassThru; \
             Set-Content -LiteralPath '{}' -Value $child.Id; Wait-Process -Id $child.Id",
            pid_file.to_string_lossy().replace('\'', "''")
        );
        let mut parent = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .current_dir(&root)
            .spawn()
            .unwrap();
        for _ in 0..100 {
            if pid_file.exists() {
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        let child_pid: u32 = std::fs::read_to_string(&pid_file).unwrap().trim().parse().unwrap();
        terminate_process_tree(parent.id());
        let _ = parent.wait();
        std::thread::sleep(Duration::from_millis(150));
        let tasklist = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {child_pid}"), "/NH"])
            .output()
            .unwrap();
        let listing = String::from_utf8_lossy(&tasklist.stdout);
        assert!(!listing.contains(&child_pid.to_string()), "descendant process survived cancellation");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_timeout_terminates_process() {
        let mut child = Command::new("ping.exe")
            .args(["127.0.0.1", "-n", "120"])
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let started = Instant::now();
        while !should_stop_command(false, started.elapsed(), Duration::from_millis(100)) {
            std::thread::sleep(Duration::from_millis(10));
        }
        terminate_process_tree(child.id());
        let status = child.wait().unwrap();
        assert!(!status.success());
    }
}
