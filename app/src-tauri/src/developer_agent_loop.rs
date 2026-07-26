use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;
use crate::openai_backend::{openai_agent_step, OpenAiToolDefinition};

pub const MAX_ITERATIONS: usize = 20;
pub const MAX_TOOL_CALLS: usize = 50;
pub const MAX_REPAIRS: usize = 3;
const RESULT_LIMIT: usize = 256 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStep {
    pub response_id: String,
    pub text: String,
    pub calls: Vec<ToolCall>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResult {
    pub call_id: String,
    pub name: String,
    pub status: String,
    pub output: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopState {
    pub task_id: String,
    pub mode: String,
    pub status: String,
    pub iterations: usize,
    pub tool_calls: usize,
    pub repair_count: usize,
    pub plan: Vec<String>,
    pub final_report: String,
    pub approval_required: bool,
    pub history: Vec<ToolResult>,
    pub failure_fingerprints: Vec<String>,
    pub pending_approval_call: Option<ToolCall>,
    pub resume_results: Vec<ToolResult>,
}

impl LoopState {
    pub fn new(task_id: String, mode: String) -> Self {
        Self {
            task_id,
            mode,
            status: "understanding".into(),
            iterations: 0,
            tool_calls: 0,
            repair_count: 0,
            plan: Vec::new(),
            final_report: String::new(),
            approval_required: false,
            history: Vec::new(),
            failure_fingerprints: Vec::new(),
            pending_approval_call: None,
            resume_results: Vec::new(),
        }
    }
}

pub type ProviderFuture<'a> =
    Pin<Box<dyn Future<Output = Result<ModelStep, String>> + Send + 'a>>;

pub trait AgentProvider: Send + Sync {
    fn next_step<'a>(
        &'a self,
        state: &'a LoopState,
        results: &'a [ToolResult],
        cancelled: Arc<AtomicBool>,
    ) -> ProviderFuture<'a>;
}

pub struct OpenAiAgentProvider {
    pub model: String,
    pub instructions: String,
    previous_response_id: Mutex<Option<String>>,
}

impl OpenAiAgentProvider {
    pub fn new(model: String, instructions: String) -> Self {
        Self { model, instructions, previous_response_id: Mutex::new(None) }
    }
}

fn schema(name: &str, description: &str) -> OpenAiToolDefinition {
    OpenAiToolDefinition {
        name: name.into(),
        description: description.into(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "query": {"type": "string"},
                "mode": {"type": "string"},
                "patch": {"type": "string"},
                "command": {"type": "string"},
                "summary": {"type": "string"},
                "startLine": {"type": "integer"},
                "endLine": {"type": "integer"}
            },
            "additionalProperties": false
        }),
    }
}

fn tool_schemas() -> Vec<OpenAiToolDefinition> {
    [
        ("inspect_workspace", "Inspect the selected repository."),
        ("get_project_profile", "Get project type and permitted validation commands."),
        ("list_directory", "List a workspace-relative directory."),
        ("find_files", "Find filenames in the repository."),
        ("search_text", "Search bounded repository text."),
        ("read_file", "Read a bounded UTF-8 workspace file."),
        ("read_file_range", "Read a bounded line range."),
        ("get_git_status", "Read Git branch and working tree status."),
        ("get_git_diff", "Read the bounded working tree diff."),
        ("propose_patch", "Submit a unified patch for validation and review."),
        ("apply_patch", "Apply the currently proposed safe patch."),
        ("run_allowed_command", "Run an exact policy-approved validation command."),
        ("get_command_output", "Return the latest bounded command result."),
        ("get_diagnostics", "Return latest validation failures."),
        ("get_test_results", "Return latest test results."),
        ("revert_task_changes", "Revert snapshots created by this task."),
        ("finish_task", "Explicitly finish with a bounded summary."),
    ].into_iter().map(|(name, description)| schema(name, description)).collect()
}

impl AgentProvider for OpenAiAgentProvider {
    fn next_step<'a>(
        &'a self,
        _: &'a LoopState,
        results: &'a [ToolResult],
        cancelled: Arc<AtomicBool>,
    ) -> ProviderFuture<'a> {
        Box::pin(async move {
            if cancelled.load(Ordering::SeqCst) {
                return Err("Agent provider request cancelled.".into());
            }
            let previous = self.previous_response_id.lock()
                .map_err(|_| "Provider conversation state is unavailable.")?.clone();
            let input = if results.is_empty() {
                serde_json::json!("Begin the repository task using tools. Finish only with finish_task.")
            } else {
                Value::Array(results.iter().map(|result| serde_json::json!({
                    "type": "function_call_output",
                    "call_id": result.call_id,
                    "output": serde_json::to_string(result).unwrap_or_else(|_| "{\"status\":\"execution failure\"}".into())
                })).collect())
            };
            let step = openai_agent_step(
                &self.model, &self.instructions, input, &tool_schemas(),
                previous.as_deref(), Duration::from_secs(120)
            ).await?;
            if cancelled.load(Ordering::SeqCst) {
                return Err("Agent provider request cancelled.".into());
            }
            *self.previous_response_id.lock()
                .map_err(|_| "Provider conversation state is unavailable.")? =
                Some(step.response_id.clone());
            Ok(ModelStep {
                response_id: step.response_id,
                text: step.text,
                calls: step.tool_calls.into_iter().map(|call| ToolCall {
                    id: call.id, name: call.name, arguments: call.arguments
                }).collect(),
            })
        })
    }
}

pub trait ToolExecutor {
    fn execute(&mut self, task_id: &str, call: &ToolCall) -> ToolResult;
}

fn bounded(mut value: String) -> String {
    if value.len() > RESULT_LIMIT {
        value.truncate(value.floor_char_boundary(RESULT_LIMIT));
        value.push_str("\n[output truncated]");
    }
    value
}

fn normalized_failure(result: &ToolResult) -> String {
    result
        .output
        .lines()
        .take(20)
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

pub async fn run_loop<P: AgentProvider, T: ToolExecutor>(
    provider: &P,
    tools: &mut T,
    state: &mut LoopState,
    cancelled: Arc<AtomicBool>,
) -> Result<(), String> {
    let mut pending_results = std::mem::take(&mut state.resume_results);
    let supported: HashSet<&str> = [
        "inspect_workspace", "get_project_profile", "list_directory", "find_files",
        "search_text", "read_file", "read_file_range", "get_git_status", "get_git_diff",
        "propose_patch", "apply_patch", "run_allowed_command", "get_command_output",
        "get_diagnostics", "get_test_results", "revert_task_changes", "finish_task",
    ].into_iter().collect();
    while state.iterations < MAX_ITERATIONS && state.tool_calls < MAX_TOOL_CALLS {
        if cancelled.load(Ordering::SeqCst) {
            state.status = "cancelled".into();
            return Ok(());
        }
        state.iterations += 1;
        let step = provider.next_step(state, &pending_results, cancelled.clone()).await?;
        pending_results.clear();
        if !step.text.trim().is_empty() {
            state.final_report = bounded(step.text);
        }
        if step.calls.is_empty() {
            state.status = "failed".into();
            return Err("Provider returned neither a tool call nor explicit completion.".into());
        }
        for call in step.calls {
            if cancelled.load(Ordering::SeqCst) {
                state.status = "cancelled".into();
                return Ok(());
            }
            state.tool_calls += 1;
            if !supported.contains(call.name.as_str()) {
                let result = ToolResult {
                    call_id: call.id,
                    name: call.name,
                    status: "rejected".into(),
                    output: "Unknown or unsupported tool.".into(),
                };
                state.history.push(result.clone());
                pending_results.push(result);
                continue;
            }
            if call.name == "apply_patch" && state.mode == "agent" && !state.approval_required {
                state.approval_required = true;
                state.status = "awaitingApproval".into();
                state.pending_approval_call = Some(call.clone());
                let result = ToolResult {
                    call_id: call.id,
                    name: call.name,
                    status: "approvalRequired".into(),
                    output: "First write requires explicit approval.".into(),
                };
                state.history.push(result);
                return Ok(());
            }
            state.status = match call.name.as_str() {
                "apply_patch" => "editing",
                "run_allowed_command" => "validating",
                _ => "searching",
            }.into();
            let mut result = tools.execute(&state.task_id, &call);
            result.output = bounded(result.output);
            if call.name == "run_allowed_command" && result.status == "failed" {
                let fingerprint = normalized_failure(&result);
                if state.failure_fingerprints.contains(&fingerprint) {
                    state.status = "blocked".into();
                    state.history.push(result);
                    return Ok(());
                }
                state.failure_fingerprints.push(fingerprint);
                state.repair_count += 1;
                if state.repair_count > MAX_REPAIRS {
                    state.status = "blocked".into();
                    state.history.push(result);
                    return Ok(());
                }
                state.status = "repairing".into();
            }
            let finished = call.name == "finish_task" && result.status == "success";
            state.history.push(result.clone());
            pending_results.push(result);
            if finished {
                state.status = "completed".into();
                return Ok(());
            }
        }
    }
    state.status = "blocked".into();
    Err("Agent execution limit reached.".into())
}

pub async fn resume_after_approval<P: AgentProvider, T: ToolExecutor>(
    provider: &P,
    tools: &mut T,
    state: &mut LoopState,
    cancelled: Arc<AtomicBool>,
) -> Result<(), String> {
    if state.status != "awaitingApproval" {
        return Err("Task is not awaiting approval.".into());
    }
    let call = state.pending_approval_call.take()
        .ok_or("Approved task has no pending write tool.")?;
    state.approval_required = false;
    state.status = "editing".into();
    let result = tools.execute(&state.task_id, &call);
    if result.status != "success" {
        state.status = "blocked".into();
        state.history.push(result);
        return Ok(());
    }
    state.history.push(result);
    run_loop(provider, tools, state, cancelled).await
}

pub async fn resume_after_rejection<P: AgentProvider, T: ToolExecutor>(
    provider: &P,
    tools: &mut T,
    state: &mut LoopState,
    cancelled: Arc<AtomicBool>,
) -> Result<(), String> {
    if state.status != "awaitingApproval" {
        return Err("Task is not awaiting approval.".into());
    }
    let call = state.pending_approval_call.take()
        .ok_or("Rejected task has no pending write tool.")?;
    state.approval_required = false;
    let result = ToolResult {
        call_id: call.id,
        name: call.name,
        status: "rejected".into(),
        output: "The user rejected this write. Do not apply it; revise the plan or finish safely.".into(),
    };
    state.history.push(result.clone());
    state.resume_results.push(result);
    state.status = "planning".into();
    run_loop(provider, tools, state, cancelled).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct ScriptedProvider(Mutex<Vec<ModelStep>>);
    impl AgentProvider for ScriptedProvider {
        fn next_step<'a>(&'a self, _: &'a LoopState, _: &'a [ToolResult], _: Arc<AtomicBool>) -> ProviderFuture<'a> {
            Box::pin(async move {
                let mut steps = self.0.lock().unwrap();
                if steps.is_empty() { return Err("script exhausted".into()); }
                Ok(steps.remove(0))
            })
        }
    }
    #[derive(Default)]
    struct FakeTools { validation: usize, calls: Vec<String> }
    impl ToolExecutor for FakeTools {
        fn execute(&mut self, _: &str, call: &ToolCall) -> ToolResult {
            self.calls.push(call.name.clone());
            let status = if call.name == "run_allowed_command" {
                self.validation += 1;
                if self.validation == 1 { "failed" } else { "success" }
            } else { "success" };
            ToolResult { call_id: call.id.clone(), name: call.name.clone(), status: status.into(), output: format!("{} result {}", call.name, self.validation) }
        }
    }
    fn call(id: usize, name: &str) -> ModelStep {
        ModelStep { response_id: id.to_string(), text: String::new(), calls: vec![ToolCall { id: id.to_string(), name: name.into(), arguments: Value::Object(Default::default()) }] }
    }

    #[test]
    fn auto_executes_iterative_failure_repair_and_finish() {
        let provider = ScriptedProvider(Mutex::new(vec![
            call(1, "inspect_workspace"), call(2, "search_text"), call(3, "read_file"),
            call(4, "propose_patch"), call(5, "apply_patch"), call(6, "run_allowed_command"),
            call(7, "get_diagnostics"), call(8, "propose_patch"), call(9, "apply_patch"),
            call(10, "run_allowed_command"), call(11, "finish_task"),
        ]));
        let mut tools = FakeTools::default();
        let mut state = LoopState::new("fixture".into(), "auto".into());
        tauri::async_runtime::block_on(run_loop(&provider, &mut tools, &mut state, Arc::new(AtomicBool::new(false)))).unwrap();
        assert_eq!(state.status, "completed");
        assert_eq!(state.repair_count, 1);
        assert_eq!(tools.validation, 2);
        assert_eq!(state.history.len(), 11);
    }

    #[test]
    fn agent_pauses_and_resumes_same_state() {
        let provider = ScriptedProvider(Mutex::new(vec![call(1, "inspect_workspace"), call(2, "apply_patch"), call(3, "finish_task")]));
        let mut tools = FakeTools::default();
        let mut state = LoopState::new("fixture".into(), "agent".into());
        let token = Arc::new(AtomicBool::new(false));
        tauri::async_runtime::block_on(run_loop(&provider, &mut tools, &mut state, token.clone())).unwrap();
        assert_eq!(state.status, "awaitingApproval");
        let iterations = state.iterations;
        tauri::async_runtime::block_on(resume_after_approval(&provider, &mut tools, &mut state, token)).unwrap();
        assert_eq!(state.status, "completed");
        assert!(state.iterations > iterations);
        assert_eq!(tools.calls.iter().filter(|name| name.as_str() == "apply_patch").count(), 1);
    }

    #[test]
    fn unknown_tool_is_rejected_and_result_returned() {
        let provider = ScriptedProvider(Mutex::new(vec![call(1, "shell"), call(2, "finish_task")]));
        let mut tools = FakeTools::default();
        let mut state = LoopState::new("fixture".into(), "auto".into());
        tauri::async_runtime::block_on(run_loop(&provider, &mut tools, &mut state, Arc::new(AtomicBool::new(false)))).unwrap();
        assert_eq!(state.history[0].status, "rejected");
        assert!(!tools.calls.contains(&"shell".into()));
    }

    #[test]
    fn repeated_validation_failure_blocks_before_another_repair() {
        struct AlwaysFail;
        impl ToolExecutor for AlwaysFail {
            fn execute(&mut self, _: &str, call: &ToolCall) -> ToolResult {
                ToolResult {
                    call_id: call.id.clone(), name: call.name.clone(),
                    status: "failed".into(),
                    output: "src/greeting.ts:2 E100 expected comma".into(),
                }
            }
        }
        let provider = ScriptedProvider(Mutex::new(vec![
            call(1, "run_allowed_command"),
            call(2, "run_allowed_command"),
            call(3, "finish_task"),
        ]));
        let mut tools = AlwaysFail;
        let mut state = LoopState::new("repeat".into(), "auto".into());
        run_test_loop(&provider, &mut tools, &mut state);
        assert_eq!(state.status, "blocked");
        assert_eq!(state.repair_count, 1);
        assert_eq!(state.iterations, 2);
    }

    #[test]
    fn rejected_write_result_returns_to_same_provider_conversation() {
        struct RejectionProvider {
            steps: Mutex<Vec<ModelStep>>,
            saw_rejection: AtomicBool,
        }
        impl AgentProvider for RejectionProvider {
            fn next_step<'a>(
                &'a self, _: &'a LoopState, results: &'a [ToolResult], _: Arc<AtomicBool>
            ) -> ProviderFuture<'a> {
                Box::pin(async move {
                    if results.iter().any(|result| result.status == "rejected" && result.call_id == "2") {
                        self.saw_rejection.store(true, Ordering::SeqCst);
                    }
                    let mut steps = self.steps.lock().unwrap();
                    Ok(steps.remove(0))
                })
            }
        }
        let provider = RejectionProvider {
            steps: Mutex::new(vec![call(1, "inspect_workspace"), call(2, "apply_patch"), call(3, "finish_task")]),
            saw_rejection: AtomicBool::new(false),
        };
        let mut tools = FakeTools::default();
        let mut state = LoopState::new("reject".into(), "agent".into());
        let token = Arc::new(AtomicBool::new(false));
        run_test_loop(&provider, &mut tools, &mut state);
        assert_eq!(state.status, "awaitingApproval");
        tauri::async_runtime::block_on(resume_after_rejection(
            &provider, &mut tools, &mut state, token
        )).unwrap();
        assert!(provider.saw_rejection.load(Ordering::SeqCst));
        assert_eq!(state.status, "completed");
        assert!(!tools.calls.contains(&"apply_patch".into()));
    }

    fn run_test_loop<P: AgentProvider, T: ToolExecutor>(
        provider: &P, tools: &mut T, state: &mut LoopState
    ) {
        tauri::async_runtime::block_on(run_loop(
            provider, tools, state, Arc::new(AtomicBool::new(false))
        )).unwrap();
    }
}
