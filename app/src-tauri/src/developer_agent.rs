use crate::developer::{
    developer_inspect_workspace, developer_search_repository, resolve_command,
};
use crate::openai_backend::openai_generate;
use crate::developer_agent_loop::{
    resume_after_approval, resume_after_rejection, run_loop, LoopState, OpenAiAgentProvider, ToolCall,
    ToolExecutor, ToolResult, MAX_REPAIRS,
};
use crate::workspace::resolve;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::State;
use crate::developer_changes::{mark_task_reverted, record_agent_patch, DeveloperChangeStore};

const CONTEXT_LIMIT_BYTES: usize = 96 * 1024;
const TOOL_OUTPUT_LIMIT_BYTES: usize = 256 * 1024;
const DEFAULT_MAX_FILES: usize = 10;
const DEFAULT_MAX_LINES: usize = 800;

const TOOL_NAMES: &[&str] = &[
    "inspect_workspace", "get_project_profile", "list_directory", "find_files",
    "search_text", "read_file", "read_file_range", "inspect_symbol", "get_open_files",
    "get_selected_code", "get_git_status", "get_git_diff", "propose_patch",
    "apply_patch", "revert_task_changes", "run_allowed_command", "get_command_output",
    "get_diagnostics", "get_test_results", "append_project_memory", "finish_task",
];

const EXCLUDED_NAMES: &[&str] = &[
    ".env", ".env.local", ".env.production", ".env.development", "credentials.json",
    "service-account.json", "google-services.json", "googleservice-info.plist",
];

#[derive(Default)]
pub struct DeveloperAgentRegistry {
    runs: Arc<Mutex<HashMap<String, StoredRun>>>,
}

struct StoredRun {
    state: AgentRunState,
    cancelled: Arc<AtomicBool>,
    snapshots: Vec<AgentFileSnapshot>,
    proposed_patch: Option<String>,
    loop_state: Option<LoopState>,
    loop_provider: Option<Arc<OpenAiAgentProvider>>,
    loop_tools: Option<RepositoryToolExecutor>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStartRequest {
    pub run_id: String,
    pub workspace_root: String,
    pub mode: String,
    pub prompt: String,
    pub scope: Option<String>,
    pub open_file: Option<String>,
    pub selected_code: Option<SelectedCode>,
    pub trusted_changes: bool,
    pub max_files: Option<usize>,
    pub max_changed_lines: Option<usize>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedCode {
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub content: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuditEvent {
    pub sequence: usize,
    pub kind: String,
    pub summary: String,
    pub status: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunState {
    pub run_id: String,
    pub mode: String,
    pub workspace: String,
    pub user_request: String,
    pub scope: String,
    pub status: String,
    pub plan: Vec<String>,
    pub response: String,
    pub pending_patch: Option<String>,
    pub changed_files: Vec<String>,
    pub validation_commands: Vec<String>,
    pub validation_results: Vec<AgentValidationResult>,
    pub repair_count: u8,
    pub max_files: usize,
    pub max_changed_lines: usize,
    pub risk: String,
    pub approval_reason: Option<String>,
    pub audit_events: Vec<AgentAuditEvent>,
    pub tool_names: Vec<String>,
    pub changes: Vec<AgentChangeRecord>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentChangeRecord {
    pub task_id: String,
    pub patch_id: String,
    pub path: String,
    pub hunk_count: usize,
    pub status: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentValidationResult {
    pub command: String,
    pub status: String,
    pub exit_code: i32,
    pub duration_ms: u64,
    pub output: String,
    pub truncated: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct AgentFileSnapshot {
    pub(crate) path: String,
    pub(crate) content: String,
    pub(crate) existed: bool,
}

#[derive(Deserialize)]
struct ModelTaskResponse {
    summary: String,
    #[serde(default)]
    plan: Vec<String>,
    #[serde(default)]
    patch: String,
    #[serde(default)]
    validation_commands: Vec<String>,
}

#[derive(Clone)]
pub(crate) struct ParsedPatchFile {
    pub(crate) path: String,
    pub(crate) old_content: String,
    pub(crate) new_content: String,
    pub(crate) existed: bool,
    pub(crate) delete: bool,
    pub(crate) changed_lines: usize,
}

struct RepositoryToolExecutor {
    root: String,
    max_files: usize,
    max_lines: usize,
    proposed_patch: Option<String>,
    snapshots: Vec<AgentFileSnapshot>,
    changed_files: Vec<String>,
    last_validation: Option<AgentValidationResult>,
    changes: Vec<AgentChangeRecord>,
    patch_sequence: usize,
    patch_history: Vec<(String, String)>,
}

impl RepositoryToolExecutor {
    fn new(root: String, max_files: usize, max_lines: usize) -> Self {
        Self {
            root, max_files, max_lines, proposed_patch: None, snapshots: Vec::new(),
            changed_files: Vec::new(), last_validation: None,
            changes: Vec::new(), patch_sequence: 0,
            patch_history: Vec::new(),
        }
    }
    fn result(call: &ToolCall, status: &str, output: impl Into<String>) -> ToolResult {
        ToolResult {
            call_id: call.id.clone(), name: call.name.clone(),
            status: status.into(), output: output.into(),
        }
    }
    fn string_arg<'a>(call: &'a ToolCall, name: &str) -> Result<&'a str, String> {
        call.arguments.get(name).and_then(Value::as_str)
            .filter(|value| !value.is_empty() && value.len() <= 256 * 1024)
            .ok_or_else(|| format!("Tool argument {name} is missing or invalid."))
    }
}

impl ToolExecutor for RepositoryToolExecutor {
    fn execute(&mut self, task_id: &str, call: &ToolCall) -> ToolResult {
        let outcome: Result<String, String> = (|| match call.name.as_str() {
            "inspect_workspace" | "get_project_profile" | "get_git_status" => {
                let info = developer_inspect_workspace(self.root.clone())?;
                serde_json::to_string(&info).map_err(|_| "Workspace result serialization failed.".into())
            }
            "list_directory" => {
                let path = call.arguments.get("path").and_then(Value::as_str).unwrap_or("");
                let full = resolve(&self.root, path)?;
                let mut names = Vec::new();
                for entry in std::fs::read_dir(full).map_err(|error| error.to_string())?.take(500) {
                    names.push(entry.map_err(|error| error.to_string())?.file_name().to_string_lossy().into_owned());
                }
                serde_json::to_string(&names).map_err(|_| "Directory result serialization failed.".into())
            }
            "find_files" | "search_text" => {
                let query = Self::string_arg(call, "query")?;
                let mode = if call.name == "find_files" { "filename" } else { "text" };
                let result = developer_search_repository(self.root.clone(), query.into(), mode.into())?;
                serde_json::to_string(&result).map_err(|_| "Search result serialization failed.".into())
            }
            "read_file" | "read_file_range" => {
                let path = Self::string_arg(call, "path")?;
                let content = read_context_file(&self.root, path, 64 * 1024)?;
                if call.name == "read_file_range" {
                    let start = call.arguments.get("startLine").and_then(Value::as_u64).unwrap_or(1).max(1) as usize;
                    let end = call.arguments.get("endLine").and_then(Value::as_u64).unwrap_or(start as u64 + 200).min(start as u64 + 500) as usize;
                    Ok(content.lines().skip(start - 1).take(end - start + 1).collect::<Vec<_>>().join("\n"))
                } else { Ok(content) }
            }
            "get_git_diff" => {
                let output = Command::new("git").args(["diff", "--no-ext-diff", "--"]).current_dir(&self.root)
                    .output().map_err(|error| error.to_string())?;
                Ok(String::from_utf8_lossy(&output.stdout).into_owned())
            }
            "propose_patch" => {
                let patch = Self::string_arg(call, "patch")?.to_string();
                let preview = preview_patch(&self.root, &patch, self.max_files, self.max_lines)?;
                self.changed_files = preview.iter().map(|file| file.path.clone()).collect();
                self.patch_sequence += 1;
                let patch_id = format!("{task_id}-patch-{}", self.patch_sequence);
                self.patch_history.push((patch_id.clone(), patch.clone()));
                for (block, file) in patch_blocks(&patch).iter().zip(preview.iter()) {
                    self.changes.push(AgentChangeRecord {
                        task_id: task_id.into(),
                        patch_id: patch_id.clone(),
                        path: file.path.clone(),
                        hunk_count: block.lines().filter(|line| line.starts_with("@@ ")).count(),
                        status: "pending".into(),
                    });
                }
                self.proposed_patch = Some(patch);
                serde_json::to_string(&self.changed_files).map_err(|_| "Patch preview serialization failed.".into())
            }
            "apply_patch" => {
                let patch = self.proposed_patch.clone().ok_or("No validated patch is pending.")?;
                let preview = preview_patch(&self.root, &patch, self.max_files, self.max_lines)?;
                let fresh = apply_preview(&self.root, &preview)?;
                for snapshot in fresh {
                    if !self.snapshots.iter().any(|existing| existing.path == snapshot.path) {
                        self.snapshots.push(snapshot);
                    }
                }
                self.proposed_patch = None;
                if let Some(patch_id) = self.changes.last().map(|record| record.patch_id.clone()) {
                    for record in self.changes.iter_mut().filter(|record| record.patch_id == patch_id) {
                        record.status = "applied".into();
                    }
                }
                Ok(format!("Applied {} validated file change(s).", preview.len()))
            }
            "run_allowed_command" => {
                let command = Self::string_arg(call, "command")?;
                let result = run_validation(&self.root, command);
                let status = result.status.clone();
                let output = result.output.clone();
                self.last_validation = Some(result);
                if status == "passed" { Ok(output) } else { Err(output) }
            }
            "get_command_output" | "get_diagnostics" | "get_test_results" => {
                Ok(self.last_validation.as_ref().map(|result| result.output.clone()).unwrap_or_default())
            }
            "revert_task_changes" => {
                let reverted = revert_snapshots(&self.root, &self.snapshots)?;
                self.snapshots.clear();
                for record in &mut self.changes {
                    if record.status == "applied" { record.status = "reverted".into(); }
                }
                Ok(format!("Reverted: {}", reverted.join(", ")))
            }
            "finish_task" => Ok(call.arguments.get("summary").and_then(Value::as_str).unwrap_or("Task completed.").to_string()),
            _ => Err("Unsupported repository tool.".into()),
        })();
        match outcome {
            Ok(output) => Self::result(call, if output.is_empty() { "empty" } else { "success" }, output),
            Err(error) => Self::result(call, "failed", error),
        }
    }
}

fn audit(state: &mut AgentRunState, kind: &str, summary: impl Into<String>, status: &str) {
    state.audit_events.push(AgentAuditEvent {
        sequence: state.audit_events.len() + 1,
        kind: kind.into(),
        summary: summary.into(),
        status: status.into(),
    });
}

fn safe_relative_path(path: &str) -> bool {
    let normalized = path.replace('\\', "/").to_ascii_lowercase();
    !normalized.is_empty()
        && !Path::new(path).is_absolute()
        && !normalized.split('/').any(|part| part == "..")
        && !normalized.split('/').any(|part| EXCLUDED_NAMES.contains(&part))
        && !normalized.contains("/.git/")
        && !normalized.starts_with(".git/")
        && !normalized.contains("secret")
        && !normalized.contains("credential")
        && !normalized.ends_with(".p12")
        && !normalized.ends_with(".pem")
        && !normalized.ends_with(".key")
}

fn bounded(value: String, limit: usize) -> (String, bool) {
    if value.len() <= limit {
        return (value, false);
    }
    let boundary = value.floor_char_boundary(limit);
    (format!("{}\n[output truncated]", &value[..boundary]), true)
}

fn keywords(prompt: &str) -> Vec<String> {
    let stop: HashSet<&str> = [
        "this", "that", "with", "from", "have", "will", "into", "when", "where",
        "what", "every", "should", "could", "would", "there", "their", "about",
        "please", "make", "change", "code", "file", "files", "repository", "project",
    ].into_iter().collect();
    let mut values = Vec::new();
    for token in prompt.split(|character: char| !character.is_ascii_alphanumeric() && character != '_') {
        let token = token.to_ascii_lowercase();
        if token.len() >= 4 && !stop.contains(token.as_str()) && !values.contains(&token) {
            values.push(token);
        }
        if values.len() >= 6 { break; }
    }
    values
}

fn read_context_file(root: &str, path: &str, remaining: usize) -> Result<String, String> {
    if !safe_relative_path(path) {
        return Err("Agent context policy rejected a secret, generated, or unsafe path.".into());
    }
    let full = resolve(root, path)?;
    if !full.is_file() {
        return Err("Context path is not a readable file.".into());
    }
    let metadata = std::fs::metadata(&full).map_err(|error| error.to_string())?;
    if metadata.len() > 2 * 1024 * 1024 {
        return Err("Context file exceeds the safe read limit.".into());
    }
    let content = std::fs::read_to_string(full).map_err(|_| "Context file is not UTF-8 text.".to_string())?;
    Ok(content.chars().take(remaining).collect())
}

fn discover_context(request: &AgentStartRequest, state: &mut AgentRunState) -> Result<String, String> {
    let info = developer_inspect_workspace(request.workspace_root.clone())?;
    audit(state, "tool", format!("Inspected {} on {}.", info.repository_name, info.branch), "passed");
    let mut candidates = Vec::new();
    if let Some(path) = request.open_file.as_deref().filter(|path| safe_relative_path(path)) {
        candidates.push(path.to_string());
    }
    for keyword in keywords(&request.prompt) {
        let filename_matches = developer_search_repository(
            request.workspace_root.clone(), keyword.clone(), "filename".into()
        ).unwrap_or_default();
        let text_matches = developer_search_repository(
            request.workspace_root.clone(), keyword, "text".into()
        ).unwrap_or_default();
        for item in filename_matches.into_iter().chain(text_matches) {
            if safe_relative_path(&item.path) && !candidates.contains(&item.path) {
                candidates.push(item.path);
            }
            if candidates.len() >= state.max_files { break; }
        }
        if candidates.len() >= state.max_files { break; }
    }
    audit(state, "search", format!("Found {} candidate context file(s).", candidates.len()), "passed");
    let mut context = format!(
        "Repository: {}\nBranch: {}\nHEAD: {}\nProject type: {}\nWorking tree: {}\n\n",
        info.repository_name, info.branch, info.head, info.profile.project_type,
        if info.dirty { "dirty" } else { "clean" }
    );
    if let Some(selected) = &request.selected_code {
        if safe_relative_path(&selected.path) {
            let selected_text: String = selected.content.chars().take(16_384).collect();
            context.push_str(&format!(
                "SELECTED {}:{}-{}\n{}\n\n",
                selected.path, selected.start_line, selected.end_line, selected_text
            ));
        }
    }
    for path in candidates {
        if context.len() >= CONTEXT_LIMIT_BYTES { break; }
        let remaining = CONTEXT_LIMIT_BYTES - context.len();
        if let Ok(content) = read_context_file(&request.workspace_root, &path, remaining.min(24 * 1024)) {
            context.push_str(&format!("FILE: {path}\n```\n{content}\n```\n\n"));
            audit(state, "read", format!("Read bounded context from {path}."), "passed");
        }
    }
    Ok(context)
}

fn developer_contract(request: &AgentStartRequest, context: &str) -> String {
    let mode_contract = match request.mode.as_str() {
        "ask" => "ASK MODE: explain and diagnose only. Return no patch and no modifying commands.",
        "agent" => "AGENT MODE: create a concise plan and a unified diff. The first write requires approval.",
        "auto" => "AUTO MODE: create a concise plan and an ordinary scoped unified diff. High-risk work must be blocked.",
        _ => "Unsupported mode.",
    };
    format!(
        "You are NF Developer Mode, a repository-focused coding agent.\n\
         {mode_contract}\n\
         Never request or reveal secrets. Never access .env, credentials, generated dependencies, or files outside the workspace.\n\
         Never commit, push, deploy, delete files, edit dependencies, manifests, auth, permissions, credentials, database schemas, or infrastructure.\n\
         Use only facts in the bounded backend-provided context. Do not invent tool results.\n\
         Return ONLY JSON: {{\"summary\":\"...\",\"plan\":[\"...\"],\"patch\":\"unified diff or empty\",\"validation_commands\":[\"exact allowed command\"]}}.\n\
         User task: {}\nTask scope: {}\n\nBounded context:\n{}",
        request.prompt,
        request.scope.as_deref().unwrap_or("ordinary files relevant to this task"),
        context
    )
}

fn parse_model_response(text: &str) -> Result<ModelTaskResponse, String> {
    serde_json::from_str(text).map_err(|_| "Provider did not return the required bounded agent JSON.".into())
}

fn parse_hunk_header(header: &str) -> Result<(usize, usize), String> {
    let old = header.split_whitespace().nth(1).ok_or("Invalid hunk header.")?;
    let old = old.trim_start_matches('-');
    let mut parts = old.split(',');
    let start = parts.next().and_then(|value| value.parse::<usize>().ok()).ok_or("Invalid hunk start.")?;
    let count = parts.next().and_then(|value| value.parse::<usize>().ok()).unwrap_or(1);
    Ok((start, count))
}

fn apply_file_patch(root: &str, block: &str) -> Result<ParsedPatchFile, String> {
    let lines: Vec<&str> = block.lines().collect();
    if lines.len() < 3 || !lines[0].starts_with("--- ") || !lines[1].starts_with("+++ ") {
        return Err("Patch file headers are invalid.".into());
    }
    let old_path = lines[0].trim_start_matches("--- ").trim().trim_start_matches("a/");
    let new_path = lines[1].trim_start_matches("+++ ").trim().trim_start_matches("b/");
    let delete = new_path == "/dev/null";
    let path = if delete { old_path } else { new_path };
    if !safe_relative_path(path) {
        return Err(format!("Patch path is unsafe or secret: {path}"));
    }
    let full = resolve(root, path)?;
    let existed = full.is_file();
    let old_content = if existed {
        std::fs::read_to_string(&full).map_err(|_| "Patch target is not UTF-8 text.".to_string())?
    } else {
        String::new()
    };
    let original: Vec<String> = old_content.lines().map(str::to_string).collect();
    let mut output = Vec::new();
    let mut source_index = 0usize;
    let mut index = 2usize;
    let mut changed_lines = 0usize;
    while index < lines.len() {
        if !lines[index].starts_with("@@ ") {
            index += 1;
            continue;
        }
        let (old_start, _) = parse_hunk_header(lines[index])?;
        let hunk_start = old_start.saturating_sub(1);
        if hunk_start < source_index || hunk_start > original.len() {
            return Err("Patch is stale or has invalid hunk offsets.".into());
        }
        output.extend_from_slice(&original[source_index..hunk_start]);
        source_index = hunk_start;
        index += 1;
        while index < lines.len() && !lines[index].starts_with("@@ ") {
            let line = lines[index];
            if let Some(value) = line.strip_prefix(' ') {
                if original.get(source_index).map(String::as_str) != Some(value) {
                    return Err("Patch context no longer matches disk; refresh the proposal.".into());
                }
                output.push(value.to_string());
                source_index += 1;
            } else if let Some(value) = line.strip_prefix('-') {
                if original.get(source_index).map(String::as_str) != Some(value) {
                    return Err("Patch removal no longer matches disk; refresh the proposal.".into());
                }
                source_index += 1;
                changed_lines += 1;
            } else if let Some(value) = line.strip_prefix('+') {
                output.push(value.to_string());
                changed_lines += 1;
            } else if line != "\\ No newline at end of file" {
                return Err("Patch contains an unsupported line.".into());
            }
            index += 1;
        }
    }
    output.extend_from_slice(&original[source_index..]);
    let mut new_content = output.join("\n");
    if old_content.ends_with('\n') || (!delete && !new_content.is_empty()) {
        new_content.push('\n');
    }
    Ok(ParsedPatchFile { path: path.into(), old_content, new_content, existed, delete, changed_lines })
}

pub(crate) fn patch_blocks(patch: &str) -> Vec<String> {
    let normalized = patch.replace("\r\n", "\n");
    let mut starts = Vec::new();
    let mut offset = 0usize;
    for line in normalized.split_inclusive('\n') {
        if line.starts_with("--- ") { starts.push(offset); }
        offset += line.len();
    }
    starts.iter().enumerate().map(|(index, start)| {
        let end = starts.get(index + 1).copied().unwrap_or(normalized.len());
        normalized[*start..end].trim_end().to_string()
    }).collect()
}

fn high_risk_path(path: &str) -> bool {
    let lower = path.replace('\\', "/").to_ascii_lowercase();
    lower.ends_with("package.json") || lower.ends_with("package-lock.json")
        || lower.ends_with("cargo.toml") || lower.ends_with("cargo.lock")
        || lower.ends_with("pubspec.yaml") || lower.contains("/migrations/")
        || lower.contains("/auth/") || lower.contains("permission")
        || lower.contains("credential") || lower.contains("deploy")
        || lower.contains("infrastructure")
}

pub(crate) fn preview_patch(root: &str, patch: &str, max_files: usize, max_lines: usize) -> Result<Vec<ParsedPatchFile>, String> {
    let blocks = patch_blocks(patch);
    if blocks.is_empty() { return Err("Provider returned no valid unified patch.".into()); }
    if blocks.len() > max_files { return Err("Patch exceeds the configured file-count limit.".into()); }
    let files: Vec<ParsedPatchFile> = blocks.iter().map(|block| apply_file_patch(root, block)).collect::<Result<_, _>>()?;
    if files.iter().any(|file| file.delete) { return Err("File deletion requires a separate high-risk approval and is blocked.".into()); }
    if files.iter().any(|file| high_risk_path(&file.path)) { return Err("Patch crosses a high-risk file boundary.".into()); }
    if files.iter().map(|file| file.changed_lines).sum::<usize>() > max_lines {
        return Err("Patch exceeds the configured changed-line limit.".into());
    }
    Ok(files)
}

pub(crate) fn apply_preview(root: &str, files: &[ParsedPatchFile]) -> Result<Vec<AgentFileSnapshot>, String> {
    let mut snapshots = Vec::new();
    for file in files {
        let full = resolve(root, &file.path)?;
        let current = if full.is_file() {
            std::fs::read_to_string(&full).map_err(|_| "Patch target is not UTF-8 text.".to_string())?
        } else { String::new() };
        if current != file.old_content {
            return Err(format!("External change detected in {}; patch is stale.", file.path));
        }
        snapshots.push(AgentFileSnapshot { path: file.path.clone(), content: current, existed: file.existed });
    }
    for file in files {
        let full = resolve(root, &file.path)?;
        if let Some(parent) = full.parent() { std::fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
        std::fs::write(&full, file.new_content.as_bytes()).map_err(|error| error.to_string())?;
    }
    Ok(snapshots)
}

pub(crate) fn revert_snapshots(root: &str, snapshots: &[AgentFileSnapshot]) -> Result<Vec<String>, String> {
    let mut reverted = Vec::new();
    for snapshot in snapshots.iter().rev() {
        let full = resolve(root, &snapshot.path)?;
        if snapshot.existed {
            std::fs::write(&full, snapshot.content.as_bytes()).map_err(|error| error.to_string())?;
        } else if full.exists() {
            std::fs::remove_file(&full).map_err(|error| error.to_string())?;
        }
        reverted.push(snapshot.path.clone());
    }
    Ok(reverted)
}

fn safe_validation_commands(profile: &str, requested: &[String]) -> Vec<String> {
    let defaults: &[&str] = if profile == "Flutter" {
        &["flutter analyze", "flutter test"]
    } else {
        &[]
    };
    requested.iter().map(String::as_str).chain(defaults.iter().copied())
        .filter(|command| !command.contains("pub get"))
        .filter(|command| !command.contains("format"))
        .filter(|command| !command.is_empty())
        .fold(Vec::new(), |mut values, command| {
            if !values.iter().any(|value| value == command) { values.push(command.to_string()); }
            values
        })
}

fn run_validation(root: &str, command: &str) -> AgentValidationResult {
    let started = Instant::now();
    let canonical = Path::new(root).canonicalize();
    let resolved = canonical.as_ref().ok().and_then(|root| resolve_command(command, Some(root)).ok());
    let Some(resolved) = resolved else {
        return AgentValidationResult {
            command: command.into(), status: "blocked".into(), exit_code: -1,
            duration_ms: 0, output: "Command is outside the approved argument-array policy.".into(), truncated: false,
        };
    };
    let output = Command::new(resolved.program)
        .args(resolved.args)
        .current_dir(root)
        .stdin(Stdio::null())
        .output();
    match output {
        Ok(output) => {
            let combined = format!(
                "{}{}{}",
                String::from_utf8_lossy(&output.stdout),
                if output.stderr.is_empty() { "" } else { "\n" },
                String::from_utf8_lossy(&output.stderr)
            );
            let (output_text, truncated) = bounded(combined, TOOL_OUTPUT_LIMIT_BYTES);
            AgentValidationResult {
                command: command.into(),
                status: if output.status.success() { "passed" } else { "failed" }.into(),
                exit_code: output.status.code().unwrap_or(-1),
                duration_ms: started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
                output: output_text, truncated,
            }
        }
        Err(_) => AgentValidationResult {
            command: command.into(), status: "failed".into(), exit_code: -1,
            duration_ms: started.elapsed().as_millis() as u64,
            output: "Approved command could not be started.".into(), truncated: false,
        },
    }
}

fn task_risk(prompt: &str) -> Option<&'static str> {
    let lower = prompt.to_ascii_lowercase();
    [
        "commit", "push", "rebase", "reset", "checkout", "delete", "remove dependency",
        "install dependency", "package.json", "pubspec", "migration", "credential", "secret",
        "authentication", "authorization", "deploy", "publish", "production", "infrastructure",
    ].into_iter().find(|boundary| lower.contains(boundary))
}

fn initial_state(request: &AgentStartRequest, workspace: String) -> AgentRunState {
    AgentRunState {
        run_id: request.run_id.clone(), mode: request.mode.clone(), workspace,
        user_request: request.prompt.clone(),
        scope: request.scope.clone().unwrap_or_else(|| "ordinary task-relevant source and test files".into()),
        status: "understanding".into(), plan: Vec::new(), response: String::new(),
        pending_patch: None, changed_files: Vec::new(), validation_commands: Vec::new(),
        validation_results: Vec::new(), repair_count: 0,
        max_files: request.max_files.unwrap_or(DEFAULT_MAX_FILES).clamp(1, DEFAULT_MAX_FILES),
        max_changed_lines: request.max_changed_lines.unwrap_or(DEFAULT_MAX_LINES).clamp(1, DEFAULT_MAX_LINES),
        risk: "ordinary".into(), approval_reason: None, audit_events: Vec::new(),
        tool_names: TOOL_NAMES.iter().map(|value| (*value).into()).collect(), changes: Vec::new(),
    }
}

fn store_state(registry: &DeveloperAgentRegistry, run_id: &str, state: AgentRunState) {
    if let Ok(mut runs) = registry.runs.lock() {
        if let Some(run) = runs.get_mut(run_id) { run.state = state; }
    }
}

#[tauri::command]
pub async fn developer_agent_start(
    request: AgentStartRequest,
    registry: State<'_, DeveloperAgentRegistry>,
    change_store: State<'_, DeveloperChangeStore>,
) -> Result<AgentRunState, String> {
    if !matches!(request.mode.as_str(), "ask" | "agent" | "auto") {
        return Err("Developer AI mode must be Ask, Agent, or Auto.".into());
    }
    if request.prompt.trim().is_empty() || request.prompt.len() > 8_000 {
        return Err("Developer task prompt is empty or exceeds the safe limit.".into());
    }
    let info = developer_inspect_workspace(request.workspace_root.clone())?;
    let mut state = initial_state(&request, info.canonical_path.clone());
    audit(&mut state, "status", "Understanding the request and validating task scope.", "running");
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut runs = registry.runs.lock().map_err(|_| "Agent registry is unavailable.")?;
        if runs.contains_key(&request.run_id) { return Err("Agent run id is already active.".into()); }
        runs.insert(request.run_id.clone(), StoredRun {
            state: state.clone(), cancelled: cancelled.clone(), snapshots: Vec::new(), proposed_patch: None,
            loop_state: None, loop_provider: None, loop_tools: None,
        });
    }
    if let Some(boundary) = task_risk(&request.prompt) {
        state.status = "blocked".into();
        state.risk = "high".into();
        let reason = format!("Task mentions high-risk boundary: {boundary}.");
        state.approval_reason = Some(reason.clone());
        audit(&mut state, "warning", reason, "blocked");
        store_state(&registry, &request.run_id, state.clone());
        return Ok(state);
    }
    if request.mode == "auto" || request.mode == "agent" {
        let instructions = format!(
            "You are NF Developer Auto Mode. Complete this ordinary scoped repository task using only the supplied tools: {}. \
             Inspect and read before editing. Use propose_patch before apply_patch. Run only policy-approved validation. \
             If validation fails, inspect the bounded result and repair it, with at most {} repairs. \
             Never delete, commit, push, deploy, edit manifests, dependencies, credentials, authentication, permissions, migrations, or files outside the workspace. \
             Explicitly call finish_task with a concise factual summary. Do not expose hidden reasoning.",
            request.prompt,
            MAX_REPAIRS,
        );
        let provider = Arc::new(OpenAiAgentProvider::new("gpt-5.4".into(), instructions));
        let mut tools = RepositoryToolExecutor::new(
            state.workspace.clone(), state.max_files, state.max_changed_lines
        );
        let mut loop_state = LoopState::new(request.run_id.clone(), request.mode.clone());
        let outcome = run_loop(provider.as_ref(), &mut tools, &mut loop_state, cancelled.clone()).await;
        state.status = loop_state.status.clone();
        state.response = loop_state.final_report.clone();
        state.repair_count = loop_state.repair_count.min(u8::MAX as usize) as u8;
        state.changed_files = tools.changed_files.clone();
        state.pending_patch = tools.proposed_patch.clone();
        state.changes = tools.changes.clone();
        if state.status == "awaitingApproval" {
            state.approval_reason = Some("Approve the exact pending apply_patch tool call to continue this Agent task.".into());
        }
        if let Some(validation) = tools.last_validation.clone() {
            state.validation_results.push(validation);
        }
        for result in &loop_state.history {
            audit(
                &mut state,
                "tool",
                format!("{} [{}]: {}", result.name, result.status, result.output.chars().take(500).collect::<String>()),
                &result.status,
            );
        }
        if let Err(error) = outcome {
            state.approval_reason = Some(error);
            if state.status != "cancelled" {
                state.status = "blocked".into();
            }
        }
        let shared_history = tools.patch_history.clone();
        let pending_patch = tools.proposed_patch.clone();
        for (patch_id, patch) in &shared_history {
            let status = if pending_patch.as_deref() == Some(patch.as_str()) {
                "pendingApproval"
            } else {
                "applied"
            };
            record_agent_patch(
                &change_store, &state.workspace, &request.mode, &request.run_id,
                patch_id, patch, status
            )?;
        }
        if let Ok(mut runs) = registry.runs.lock() {
            if let Some(run) = runs.get_mut(&request.run_id) {
                run.state = state.clone();
                run.snapshots = tools.snapshots.clone();
                run.proposed_patch = tools.proposed_patch.clone();
                run.loop_state = Some(loop_state);
                run.loop_provider = Some(provider);
                run.loop_tools = Some(tools);
            }
        }
        return Ok(state);
    }
    state.status = "searching".into();
    store_state(&registry, &request.run_id, state.clone());
    let context = discover_context(&request, &mut state)?;
    if cancelled.load(Ordering::SeqCst) {
        state.status = "stopped".into();
        audit(&mut state, "status", "Task stopped before provider request.", "stopped");
        store_state(&registry, &request.run_id, state.clone());
        return Ok(state);
    }
    state.status = "planning".into();
    audit(&mut state, "provider", "Requesting a bounded plan from the configured backend provider.", "running");
    store_state(&registry, &request.run_id, state.clone());
    let mut provider = Box::pin(openai_generate(
        "gpt-5.4".into(),
        developer_contract(&request, &context),
    ));
    let text = loop {
        if cancelled.load(Ordering::SeqCst) {
            state.status = "stopped".into();
            audit(&mut state, "status", "Provider request cancelled by the user.", "stopped");
            store_state(&registry, &request.run_id, state.clone());
            return Ok(state);
        }
        match tokio::time::timeout(
            std::time::Duration::from_millis(100),
            provider.as_mut(),
        )
        .await
        {
            Ok(result) => break result?,
            Err(_) => continue,
        }
    };
    let response = parse_model_response(&text)?;
    state.plan = response.plan.into_iter().take(12).collect();
    state.response = response.summary.chars().take(8_000).collect();
    if request.mode == "ask" {
        state.status = "completed".into();
        state.pending_patch = None;
        audit(&mut state, "final", "Ask Mode completed read-only; no files were changed.", "passed");
        store_state(&registry, &request.run_id, state.clone());
        return Ok(state);
    }
    let preview = match preview_patch(&request.workspace_root, &response.patch, state.max_files, state.max_changed_lines) {
        Ok(files) => files,
        Err(error) => {
            state.status = "blocked".into();
            state.approval_reason = Some(error.clone());
            audit(&mut state, "patch", error, "blocked");
            store_state(&registry, &request.run_id, state.clone());
            return Ok(state);
        }
    };
    state.pending_patch = Some(response.patch.clone());
    state.changed_files = preview.iter().map(|file| file.path.clone()).collect();
    state.validation_commands = safe_validation_commands(&info.profile.project_type, &response.validation_commands);
    if request.mode == "agent" && !request.trusted_changes {
        state.status = "awaitingApproval".into();
        state.approval_reason = Some("Approve the displayed plan and first patch application.".into());
        audit(&mut state, "approval", "Plan and patch are ready for explicit approval.", "pending");
        if let Ok(mut runs) = registry.runs.lock() {
            if let Some(run) = runs.get_mut(&request.run_id) {
                run.state = state.clone();
                run.proposed_patch = Some(response.patch);
            }
        }
        return Ok(state);
    }
    let snapshots = apply_preview(&request.workspace_root, &preview)?;
    state.pending_patch = None;
    state.status = "validating".into();
    audit(&mut state, "patch", format!("Applied {} ordinary scoped file change(s).", preview.len()), "passed");
    for command in state.validation_commands.clone() {
        if cancelled.load(Ordering::SeqCst) { break; }
        audit(&mut state, "command", format!("Running {command}."), "running");
        let result = run_validation(&request.workspace_root, &command);
        audit(&mut state, "command", format!("{command}: {}.", result.status), &result.status);
        state.validation_results.push(result);
    }
    state.status = if cancelled.load(Ordering::SeqCst) {
        "stopped"
    } else if state.validation_results.iter().any(|result| result.status == "failed") {
        "blocked"
    } else {
        "completed"
    }.into();
    let final_status = state.status.clone();
    let final_message = if final_status == "completed" {
        "Task changes and validations completed."
    } else {
        "Task stopped or validation failed; changes remain visible and revertible."
    };
    audit(&mut state, "final", final_message, &final_status);
    if let Ok(mut runs) = registry.runs.lock() {
        if let Some(run) = runs.get_mut(&request.run_id) {
            run.state = state.clone();
            run.snapshots = snapshots;
        }
    }
    Ok(state)
}

#[tauri::command]
pub async fn developer_agent_approve(
    run_id: String,
    registry: State<'_, DeveloperAgentRegistry>,
    change_store: State<'_, DeveloperChangeStore>,
) -> Result<AgentRunState, String> {
    let (mut state, mut loop_state, provider, mut tools, cancelled) = {
        let mut runs = registry.runs.lock().map_err(|_| "Agent registry is unavailable.")?;
        let run = runs.get_mut(&run_id).ok_or("Agent run was not found.")?;
        if run.state.status != "awaitingApproval" || run.state.mode != "agent" {
            return Err("Agent run is not awaiting first-write approval.".into());
        }
        (
            run.state.clone(),
            run.loop_state.take().ok_or("Iterative Agent state is unavailable.")?,
            run.loop_provider.take().ok_or("Iterative Agent provider is unavailable.")?,
            run.loop_tools.take().ok_or("Iterative Agent tools are unavailable.")?,
            run.cancelled.clone(),
        )
    };
    let history_before = loop_state.history.len();
    let outcome = resume_after_approval(
        provider.as_ref(), &mut tools, &mut loop_state, cancelled
    ).await;
    state.status = loop_state.status.clone();
    state.response = loop_state.final_report.clone();
    state.repair_count = loop_state.repair_count.min(u8::MAX as usize) as u8;
    state.changed_files = tools.changed_files.clone();
    state.pending_patch = tools.proposed_patch.clone();
    state.changes = tools.changes.clone();
    if let Some(validation) = tools.last_validation.clone() {
        state.validation_results = vec![validation];
    }
    for result in loop_state.history.iter().skip(history_before) {
        audit(&mut state, "tool", format!("{} [{}]: {}", result.name, result.status, result.output.chars().take(500).collect::<String>()), &result.status);
    }
    if let Err(error) = outcome {
        state.approval_reason = Some(error);
        state.status = "blocked".into();
    } else {
        state.approval_reason = None;
    }
    let mut runs = registry.runs.lock().map_err(|_| "Agent registry is unavailable.")?;
    let run = runs.get_mut(&run_id).ok_or("Agent run was not found.")?;
    run.snapshots = tools.snapshots.clone();
    run.proposed_patch = tools.proposed_patch.clone();
    run.loop_state = Some(loop_state);
    run.loop_provider = Some(provider);
    run.loop_tools = Some(tools);
    run.state = state.clone();
    for (patch_id, patch) in &run.loop_tools.as_ref().unwrap().patch_history {
        record_agent_patch(
            &change_store, &state.workspace, "agent", &run_id, patch_id, patch,
            if state.status == "awaitingApproval" { "pendingApproval" } else { "applied" }
        )?;
    }
    Ok(state)
}

#[tauri::command]
pub async fn developer_agent_reject(
    run_id: String,
    registry: State<'_, DeveloperAgentRegistry>,
    change_store: State<'_, DeveloperChangeStore>,
) -> Result<AgentRunState, String> {
    let (mut state, mut loop_state, provider, mut tools, cancelled) = {
        let mut runs = registry.runs.lock().map_err(|_| "Agent registry is unavailable.")?;
        let run = runs.get_mut(&run_id).ok_or("Agent run was not found.")?;
        if run.state.status != "awaitingApproval" || run.state.mode != "agent" {
            return Err("Agent run is not awaiting a write decision.".into());
        }
        (
            run.state.clone(),
            run.loop_state.take().ok_or("Iterative Agent state is unavailable.")?,
            run.loop_provider.take().ok_or("Iterative Agent provider is unavailable.")?,
            run.loop_tools.take().ok_or("Iterative Agent tools are unavailable.")?,
            run.cancelled.clone(),
        )
    };
    let rejected_patch = tools.proposed_patch.take();
    if let Some((patch_id, patch)) = tools.patch_history.iter().find(|(_, patch)| {
        rejected_patch.as_deref() == Some(patch.as_str())
    }) {
        record_agent_patch(
            &change_store, &state.workspace, "agent", &run_id, patch_id, patch, "rejected"
        )?;
        for record in tools.changes.iter_mut().filter(|record| &record.patch_id == patch_id) {
            record.status = "rejected".into();
        }
    }
    let history_before = loop_state.history.len();
    let outcome = resume_after_rejection(
        provider.as_ref(), &mut tools, &mut loop_state, cancelled
    ).await;
    state.status = loop_state.status.clone();
    state.response = loop_state.final_report.clone();
    state.pending_patch = tools.proposed_patch.clone();
    state.changed_files = tools.changed_files.clone();
    state.changes = tools.changes.clone();
    for result in loop_state.history.iter().skip(history_before) {
        audit(&mut state, "tool", format!("{} [{}]: {}", result.name, result.status, result.output.chars().take(500).collect::<String>()), &result.status);
    }
    if let Err(error) = outcome {
        state.status = "blocked".into();
        state.approval_reason = Some(error);
    } else {
        state.approval_reason = (state.status == "awaitingApproval")
            .then(|| "A revised write is awaiting approval.".into());
    }
    for (patch_id, patch) in &tools.patch_history {
        let status = tools.changes.iter().find(|record| &record.patch_id == patch_id)
            .map(|record| record.status.as_str()).unwrap_or("pendingApproval");
        record_agent_patch(&change_store, &state.workspace, "agent", &run_id, patch_id, patch, status)?;
    }
    let mut runs = registry.runs.lock().map_err(|_| "Agent registry is unavailable.")?;
    let run = runs.get_mut(&run_id).ok_or("Agent run was not found.")?;
    run.snapshots = tools.snapshots.clone();
    run.proposed_patch = tools.proposed_patch.clone();
    run.loop_state = Some(loop_state);
    run.loop_provider = Some(provider);
    run.loop_tools = Some(tools);
    run.state = state.clone();
    Ok(state)
}

#[tauri::command]
pub fn developer_agent_revert(
    run_id: String,
    approved: bool,
    registry: State<'_, DeveloperAgentRegistry>,
    change_store: State<'_, DeveloperChangeStore>,
) -> Result<AgentRunState, String> {
    if !approved { return Err("Full-task revert requires explicit approval.".into()); }
    let mut runs = registry.runs.lock().map_err(|_| "Agent registry is unavailable.")?;
    let run = runs.get_mut(&run_id).ok_or("Agent run was not found.")?;
    let reverted = revert_snapshots(&run.state.workspace, &run.snapshots)?;
    run.snapshots.clear();
    run.state.status = "completed".into();
    run.state.changed_files.clear();
    for record in &mut run.state.changes {
        if record.status == "applied" { record.status = "reverted".into(); }
    }
    mark_task_reverted(&change_store, &run_id)?;
    audit(&mut run.state, "revert", format!("Restored {} task file snapshot(s).", reverted.len()), "passed");
    Ok(run.state.clone())
}

#[tauri::command]
pub fn developer_agent_stop(
    run_id: String,
    registry: State<'_, DeveloperAgentRegistry>,
) -> Result<AgentRunState, String> {
    let mut runs = registry.runs.lock().map_err(|_| "Agent registry is unavailable.")?;
    let run = runs.get_mut(&run_id).ok_or("Agent run was not found.")?;
    run.cancelled.store(true, Ordering::SeqCst);
    run.state.status = "stopped".into();
    audit(&mut run.state, "status", "Stop requested. Applied changes remain visible and revertible.", "stopped");
    Ok(run.state.clone())
}

#[tauri::command]
pub fn developer_agent_get(
    run_id: String,
    registry: State<'_, DeveloperAgentRegistry>,
) -> Result<AgentRunState, String> {
    let runs = registry.runs.lock().map_err(|_| "Agent registry is unavailable.")?;
    runs.get(&run_id).map(|run| run.state.clone()).ok_or_else(|| "Agent run was not found.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::developer_agent_loop::{AgentProvider, ModelStep, ProviderFuture};
    use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
    use std::sync::Mutex as TestMutex;
    use std::hash::{Hash, Hasher};

    static FIXTURE_ID: AtomicUsize = AtomicUsize::new(0);

    fn fixture() -> std::path::PathBuf {
        let id = FIXTURE_ID.fetch_add(1, AtomicOrdering::SeqCst);
        let root = std::env::temp_dir().join(format!("nf-agent-fixture-{}-{id}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src/app.ts"), "const value = 'old';\n").unwrap();
        root
    }
    fn content_hash(value: &str) -> u64 {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        value.hash(&mut hasher);
        hasher.finish()
    }

    #[test]
    fn ask_mode_contract_is_read_only_and_context_excludes_secrets() {
        let request = AgentStartRequest {
            run_id: "ask".into(), workspace_root: "C:\\fixture".into(), mode: "ask".into(),
            prompt: "Explain the service".into(), scope: None, open_file: None,
            selected_code: None, trusted_changes: false, max_files: None, max_changed_lines: None,
        };
        let contract = developer_contract(&request, "bounded");
        assert!(contract.contains("Return no patch"));
        assert!(!safe_relative_path(".env"));
        assert!(!safe_relative_path("android/app/google-services.json"));
        assert!(!safe_relative_path("../outside.txt"));
        assert!(safe_relative_path("lib/main.dart"));
    }

    #[test]
    fn agent_requires_approval_while_auto_allows_only_ordinary_scope() {
        let request = AgentStartRequest {
            run_id: "agent".into(), workspace_root: "C:\\fixture".into(), mode: "agent".into(),
            prompt: "Change the message".into(), scope: None, open_file: None,
            selected_code: None, trusted_changes: false, max_files: None, max_changed_lines: None,
        };
        assert!(!request.trusted_changes);
        assert!(task_risk("commit and push this").is_some());
        assert!(task_risk("install dependency foo").is_some());
        assert!(task_risk("delete the old file").is_some());
        assert!(task_risk("update a normal widget").is_none());
    }

    #[test]
    fn fixture_patch_applies_detects_staleness_and_reverts_exactly() {
        let root = fixture();
        let canonical = root.canonicalize().unwrap();
        let patch = "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,1 +1,1 @@\n-const value = 'old';\n+const value = 'new';\n";
        let preview = preview_patch(canonical.to_str().unwrap(), patch, 10, 800).unwrap();
        let snapshots = apply_preview(canonical.to_str().unwrap(), &preview).unwrap();
        assert_eq!(std::fs::read_to_string(root.join("src/app.ts")).unwrap(), "const value = 'new';\n");
        assert!(apply_preview(canonical.to_str().unwrap(), &preview).unwrap_err().contains("External change"));
        revert_snapshots(canonical.to_str().unwrap(), &snapshots).unwrap();
        assert_eq!(std::fs::read_to_string(root.join("src/app.ts")).unwrap(), "const value = 'old';\n");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn auto_limits_and_high_risk_paths_are_enforced() {
        let root = fixture();
        let canonical = root.canonicalize().unwrap();
        let patch = "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,1 +1,1 @@\n-const value = 'old';\n+const value = 'new';\n";
        assert!(preview_patch(canonical.to_str().unwrap(), patch, 0, 800).is_err());
        assert!(preview_patch(canonical.to_str().unwrap(), patch, 10, 1).is_err());
        assert!(high_risk_path("package.json"));
        assert!(high_risk_path("src/auth/session.ts"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn repeated_repair_limit_and_serialized_state_are_safe() {
        assert_eq!(MAX_REPAIRS, 3);
        let request = AgentStartRequest {
            run_id: "safe".into(), workspace_root: "C:\\fixture".into(), mode: "auto".into(),
            prompt: "Update widget".into(), scope: None, open_file: None,
            selected_code: None, trusted_changes: false, max_files: None, max_changed_lines: None,
        };
        let state = initial_state(&request, "C:\\fixture".into());
        let serialized = serde_json::to_string(&state).unwrap();
        assert!(!serialized.to_ascii_lowercase().contains("api_key"));
        assert!(!serialized.to_ascii_lowercase().contains("authorization"));
        assert_eq!(state.max_files, 10);
        assert_eq!(state.max_changed_lines, 800);
    }

    struct FixtureProvider {
        steps: TestMutex<Vec<ModelStep>>,
        calls: AtomicUsize,
    }
    impl AgentProvider for FixtureProvider {
        fn next_step<'a>(
            &'a self, _: &'a LoopState, _: &'a [ToolResult], _: Arc<AtomicBool>
        ) -> ProviderFuture<'a> {
            Box::pin(async move {
                self.calls.fetch_add(1, AtomicOrdering::SeqCst);
                let mut steps = self.steps.lock().unwrap();
                if steps.is_empty() { return Err("fixture provider exhausted".into()); }
                Ok(steps.remove(0))
            })
        }
    }
    fn fixture_step(id: usize, name: &str, arguments: Value) -> ModelStep {
        ModelStep {
            response_id: id.to_string(), text: if name == "finish_task" { "Greeting task completed after repair.".into() } else { String::new() },
            calls: vec![ToolCall { id: id.to_string(), name: name.into(), arguments }],
        }
    }

    #[test]
    fn filesystem_auto_fails_repairs_passes_and_reverts_exactly() {
        let root = std::env::temp_dir().join(format!(
            "nf-agent-greeting-{}-{}", std::process::id(),
            FIXTURE_ID.fetch_add(1, AtomicOrdering::SeqCst)
        ));
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("test")).unwrap();
        let source = "export function greeting(): string {\n  return \"Hello\";\n}\n";
        let test = "import { greeting } from \"../src/greeting.ts\";\nif (greeting() !== \"Hello\") throw new Error(\"old greeting failed\");\n";
        let hashes_before = (content_hash(source), content_hash(test));
        std::fs::write(root.join("src/greeting.ts"), source).unwrap();
        std::fs::write(root.join("test/greeting.test.ts"), test).unwrap();
        std::fs::write(root.join("package.json"), "{\"type\":\"module\",\"scripts\":{\"test\":\"node test/greeting.test.ts\"}}\n").unwrap();
        std::fs::write(root.join("tsconfig.json"), "{\"compilerOptions\":{\"allowImportingTsExtensions\":true}}\n").unwrap();
        Command::new("git").args(["init", "-q"]).current_dir(&root).status().unwrap();
        let canonical = root.canonicalize().unwrap().to_string_lossy().into_owned();
        let patch1 = "--- a/src/greeting.ts\n+++ b/src/greeting.ts\n@@ -1,3 +1,3 @@\n-export function greeting(): string {\n-  return \"Hello\";\n+export function greeting(name: string): string {\n+  return `Hello ${name}`;\n }\n--- a/test/greeting.test.ts\n+++ b/test/greeting.test.ts\n@@ -1,2 +1,2 @@\n import { greeting } from \"../src/greeting.ts\";\n-if (greeting() !== \"Hello\") throw new Error(\"old greeting failed\");\n+if (greeting(\"Ada\") !== \"Hello, Ada\") throw new Error(\"named greeting failed\");\n--- /dev/null\n+++ b/test/generated.ts\n@@ -0,0 +1,1 @@\n+export const fixtureMarker = true;\n";
        let repair = "--- a/src/greeting.ts\n+++ b/src/greeting.ts\n@@ -1,3 +1,3 @@\n export function greeting(name: string): string {\n-  return `Hello ${name}`;\n+  return `Hello, ${name}`;\n }\n";
        let steps = vec![
            fixture_step(1, "inspect_workspace", serde_json::json!({})),
            fixture_step(2, "search_text", serde_json::json!({"query":"greeting"})),
            fixture_step(3, "read_file", serde_json::json!({"path":"src/greeting.ts"})),
            fixture_step(4, "read_file", serde_json::json!({"path":"test/greeting.test.ts"})),
            fixture_step(5, "propose_patch", serde_json::json!({"patch":patch1})),
            fixture_step(6, "apply_patch", serde_json::json!({})),
            fixture_step(7, "run_allowed_command", serde_json::json!({"command":"npm test"})),
            fixture_step(8, "get_diagnostics", serde_json::json!({})),
            fixture_step(9, "propose_patch", serde_json::json!({"patch":repair})),
            fixture_step(10, "apply_patch", serde_json::json!({})),
            fixture_step(11, "run_allowed_command", serde_json::json!({"command":"npm test"})),
            fixture_step(12, "finish_task", serde_json::json!({"summary":"Greeting accepts a name and validation passes."})),
        ];
        let provider = FixtureProvider { steps: TestMutex::new(steps), calls: AtomicUsize::new(0) };
        let mut tools = RepositoryToolExecutor::new(canonical, 10, 800);
        let mut state = LoopState::new("greeting-task".into(), "auto".into());
        tauri::async_runtime::block_on(run_loop(
            &provider, &mut tools, &mut state, Arc::new(AtomicBool::new(false))
        )).unwrap();
        assert_eq!(state.status, "completed");
        assert_eq!(state.repair_count, 1);
        assert!(state.history.iter().any(|result| result.name == "run_allowed_command" && result.status == "failed"));
        assert!(state.history.iter().any(|result| result.name == "run_allowed_command" && result.status == "success"));
        assert_eq!(std::fs::read_to_string(root.join("src/greeting.ts")).unwrap(), "export function greeting(name: string): string {\n  return `Hello, ${name}`;\n}\n");
        assert!(root.join("test/generated.ts").is_file());
        assert!(tools.changes.iter().all(|record| record.task_id == "greeting-task"));
        assert!(tools.changes.iter().all(|record| record.hunk_count > 0));
        assert!(tools.changes.iter().any(|record| record.status == "applied"));
        let revert = ToolCall { id: "revert".into(), name: "revert_task_changes".into(), arguments: serde_json::json!({}) };
        assert_eq!(tools.execute("greeting-task", &revert).status, "success");
        assert_eq!(std::fs::read_to_string(root.join("src/greeting.ts")).unwrap(), source);
        assert_eq!(std::fs::read_to_string(root.join("test/greeting.test.ts")).unwrap(), test);
        let hashes_after = (
            content_hash(&std::fs::read_to_string(root.join("src/greeting.ts")).unwrap()),
            content_hash(&std::fs::read_to_string(root.join("test/greeting.test.ts")).unwrap()),
        );
        assert_eq!(hashes_before, hashes_after);
        assert!(tools.changes.iter().all(|record| record.status == "reverted"));
        assert!(!root.join("test/generated.ts").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn filesystem_agent_pauses_then_applies_exact_pending_patch_and_finishes() {
        let root = fixture();
        std::fs::create_dir_all(root.join("test")).unwrap();
        std::fs::write(root.join("src/greeting.ts"), "export function greeting(): string {\n  return \"Hello\";\n}\n").unwrap();
        std::fs::write(root.join("test/greeting.test.ts"), "import { greeting } from \"../src/greeting.ts\";\nif (greeting(\"Ada\") !== \"Hello, Ada\") throw new Error(\"failed\");\n").unwrap();
        std::fs::write(root.join("package.json"), "{\"type\":\"module\",\"scripts\":{\"test\":\"node test/greeting.test.ts\"}}\n").unwrap();
        Command::new("git").args(["init", "-q"]).current_dir(&root).status().unwrap();
        let patch = "--- a/src/greeting.ts\n+++ b/src/greeting.ts\n@@ -1,3 +1,3 @@\n-export function greeting(): string {\n-  return \"Hello\";\n+export function greeting(name: string): string {\n+  return `Hello, ${name}`;\n }\n";
        let provider = FixtureProvider {
            steps: TestMutex::new(vec![
                fixture_step(1, "inspect_workspace", serde_json::json!({})),
                fixture_step(2, "search_text", serde_json::json!({"query":"greeting"})),
                fixture_step(3, "read_file", serde_json::json!({"path":"src/greeting.ts"})),
                fixture_step(4, "propose_patch", serde_json::json!({"patch":patch})),
                fixture_step(5, "apply_patch", serde_json::json!({})),
                fixture_step(6, "run_allowed_command", serde_json::json!({"command":"npm test"})),
                fixture_step(7, "finish_task", serde_json::json!({"summary":"done"})),
            ]),
            calls: AtomicUsize::new(0),
        };
        let canonical = root.canonicalize().unwrap().to_string_lossy().into_owned();
        let mut tools = RepositoryToolExecutor::new(canonical, 10, 800);
        let mut state = LoopState::new("agent-fixture".into(), "agent".into());
        let token = Arc::new(AtomicBool::new(false));
        tauri::async_runtime::block_on(run_loop(&provider, &mut tools, &mut state, token.clone())).unwrap();
        assert_eq!(state.status, "awaitingApproval");
        assert_eq!(provider.calls.load(AtomicOrdering::SeqCst), 5);
        assert!(std::fs::read_to_string(root.join("src/greeting.ts")).unwrap().contains("greeting():"));
        assert_eq!(state.pending_approval_call.as_ref().unwrap().id, "5");
        tauri::async_runtime::block_on(resume_after_approval(&provider, &mut tools, &mut state, token)).unwrap();
        assert_eq!(state.status, "completed");
        assert_eq!(provider.calls.load(AtomicOrdering::SeqCst), 7);
        assert!(tools.last_validation.as_ref().is_some_and(|result| result.status == "passed"));
        assert!(std::fs::read_to_string(root.join("src/greeting.ts")).unwrap().contains("Hello, ${name}"));
        revert_snapshots(&tools.root, &tools.snapshots).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}
