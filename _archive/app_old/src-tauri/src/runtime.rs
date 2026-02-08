//! Local llama-server runtime: start/stop/status and generate via HTTP /completion.

use std::collections::HashMap;
use std::collections::VecDeque;
use std::io::BufRead;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;
use tauri::Emitter;

const RUNTIME_LOG_MAX_LINES: usize = 200;

#[derive(Default)]
pub struct RuntimeState {
    pub port: Option<u16>,
    pub child: Option<Child>,
}

/// Ring buffer of last RUNTIME_LOG_MAX_LINES lines from llama-server stdout/stderr.
#[derive(Clone)]
pub struct RuntimeLogState(pub Arc<Mutex<VecDeque<String>>>);

impl Default for RuntimeLogState {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(VecDeque::new())))
    }
}

impl RuntimeLogState {
    pub fn push(&self, line: String) {
        let mut q = self.0.lock().unwrap();
        if q.len() >= RUNTIME_LOG_MAX_LINES {
            q.pop_front();
        }
        q.push_back(line);
    }
    pub fn clear(&self) {
        self.0.lock().unwrap().clear();
    }
    pub fn lines(&self) -> Vec<String> {
        self.0.lock().unwrap().iter().cloned().collect()
    }
}

/// Per-run cancellation: run_id -> sender; when send(), the runtime_generate/runtime_chat waiting on the receiver returns Err.
#[derive(Default)]
pub struct CancelRunState(pub Mutex<HashMap<String, oneshot::Sender<()>>>);

#[derive(Default, Clone, Serialize, Deserialize)]
pub struct RuntimeStartParams {
    #[serde(default)]
    pub temperature: f64,
    #[serde(default)]
    pub top_p: f64,
    #[serde(default)]
    pub max_tokens: i32,
    #[serde(default)]
    pub context_length: i32,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct RuntimeStartResult {
    pub port: u16,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct RuntimeStatusResult {
    pub running: bool,
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
}

#[derive(Default, Clone, Serialize, Deserialize)]
pub struct GenerateOptions {
    #[serde(default)]
    pub temperature: f64,
    #[serde(default)]
    pub top_p: f64,
    #[serde(default)]
    pub max_tokens: i32,
}

fn default_port() -> u16 {
    std::env::var("LLAMA_PORT")
        .ok()
        .and_then(|s| s.trim().parse::<u16>().ok())
        .unwrap_or(8080)
}

/// PATCH_TIMEOUT_SECONDS: timeout for patch generation (default 240 = 4 minutes).
fn patch_timeout_seconds() -> u64 {
    std::env::var("PATCH_TIMEOUT_SECONDS")
        .ok()
        .and_then(|s| s.trim().parse::<u64>().ok())
        .unwrap_or(240)
}

#[derive(Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub patch_timeout_seconds: u64,
}

#[tauri::command]
pub fn get_app_config() -> AppConfig {
    AppConfig {
        patch_timeout_seconds: patch_timeout_seconds(),
    }
}

fn readiness_timeout_seconds() -> u64 {
    std::env::var("LLAMA_READY_TIMEOUT_SECONDS")
        .ok()
        .and_then(|s| s.trim().parse::<u64>().ok())
        .unwrap_or(180)
}

fn find_free_port() -> Option<u16> {
    let start = default_port();
    for offset in 0u16..100 {
        let port = start.saturating_add(offset);
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Some(port);
        }
    }
    None
}

/// Use LLAMA_PORT if free, else next free port. Log when falling back.
fn port_to_use() -> Option<u16> {
    let want = default_port();
    if TcpListener::bind(("127.0.0.1", want)).is_ok() {
        return Some(want);
    }
    let fallback = find_free_port();
    if let Some(p) = fallback {
        eprintln!("[llama] port {} busy, using {}", want, p);
    }
    fallback
}

#[cfg(windows)]
fn llama_exe_rel() -> &'static str {
    "runtime/llama/llama-server.exe"
}
#[cfg(not(windows))]
fn llama_exe_rel() -> &'static str {
    "runtime/llama/llama-server"
}

fn resolve_llama_from_tool_root(tool_root: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(tool_root.trim().replace('\\', "/"));
    let exe = root.join(llama_exe_rel());
    if exe.is_file() {
        return Ok(exe.canonicalize().map_err(|e| e.to_string())?);
    }
    Err(format!(
        "Could not find {}. Expected under toolRoot/runtime/llama.",
        llama_exe_rel()
    ))
}

/// Health check: GET /health; if non-200, try GET /v1/models. Return true if any returns HTTP 200 (body ignored).
#[tauri::command]
pub async fn runtime_health_check(port: u16) -> Result<bool, String> {
    let health_url = format!("http://127.0.0.1:{}/health", port);
    if let Ok(resp) = reqwest::get(&health_url).await {
        if resp.status().as_u16() == 200 {
            return Ok(true);
        }
    }
    let models_url = format!("http://127.0.0.1:{}/v1/models", port);
    if let Ok(resp) = reqwest::get(&models_url).await {
        if resp.status().as_u16() == 200 {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Health check returning HTTP status code or error string for UI.
#[tauri::command]
pub async fn runtime_health_check_status(port: u16) -> Result<u16, String> {
    let health_url = format!("http://127.0.0.1:{}/health", port);
    match reqwest::get(&health_url).await {
        Ok(resp) => Ok(resp.status().as_u16()),
        Err(e) => Err(format!("connection failed: {}", e)),
    }
}

#[tauri::command]
pub async fn runtime_start(
    gguf_path: String,
    tool_root: Option<String>,
    params: Option<RuntimeStartParams>,
    port_override: Option<u16>,
    _log_file_path: Option<String>,
    state: tauri::State<'_, Mutex<RuntimeState>>,
    log_state: tauri::State<'_, RuntimeLogState>,
) -> Result<RuntimeStartResult, String> {
    let gguf_path = gguf_path.trim();
    if gguf_path.is_empty() {
        return Err("GGUF model path is required.".to_string());
    }
    let path_buf = PathBuf::from(gguf_path);
    if !path_buf.is_file() {
        return Err(format!("Model file not found: {}", gguf_path));
    }

    let (server_path, port) = if let Some(tr) = &tool_root {
        let server_path = resolve_llama_from_tool_root(tr)?;
        let port = port_override
            .or_else(port_to_use)
            .ok_or_else(|| format!("No free port near {}.", default_port()))?;
        {
            let mut s = state.lock().map_err(|e| e.to_string())?;
            if s.port == Some(port) {
                if let Some(child) = s.child.as_mut() {
                    if child.try_wait().ok().flatten().is_none() {
                        return Ok(RuntimeStartResult { port });
                    }
                }
                s.child = None;
                s.port = None;
            }
        }
        (server_path, port)
    } else {
        #[cfg(windows)]
        let exe_name = "llama-server.exe";
        #[cfg(not(windows))]
        let exe_name = "llama-server";
        let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
        let candidate = cwd.join("runtime").join("llama").join(exe_name);
        if !candidate.is_file() {
            return Err(format!(
                "Could not find runtime/llama/{}. Expected under toolRoot. Use find_tool_root.",
                exe_name
            ));
        }
        let server_path = candidate.canonicalize().map_err(|e| e.to_string())?;
        let port = port_override
            .or_else(port_to_use)
            .ok_or_else(|| format!("No free port near {}.", default_port()))?;
        (server_path, port)
    };

    let mut args = vec![
        "--model".to_string(),
        gguf_path.to_string(),
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        port.to_string(),
    ];
    let p = params.unwrap_or_default();
    if p.context_length > 0 {
        args.push("--ctx-size".to_string());
        args.push(p.context_length.to_string());
    }

    let debug_runtime = std::env::var("DEVASSISTANT_DEBUG_RUNTIME").is_ok();
    if debug_runtime {
        eprintln!(
            "[runtime DEBUG] spawn start ts={:?} exe={:?} args=[{}] cwd={:?}",
            std::time::SystemTime::now(),
            server_path,
            args.join(" "),
            std::env::current_dir()
        );
    }

    log_state.clear();
    let mut child = Command::new(&server_path)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start llama-server: {}", e))?;

    let stdout = child.stdout.take().ok_or("stdout not captured")?;
    let stderr = child.stderr.take().ok_or("stderr not captured")?;
    let arc_log_out = log_state.0.clone();
    let arc_log_err = log_state.0.clone();
    std::thread::spawn(move || {
        let log_out = RuntimeLogState(arc_log_out);
        let r = std::io::BufReader::new(stdout);
        for line in r.lines() {
            if let Ok(l) = line {
                log_out.push(l);
            }
        }
    });
    std::thread::spawn(move || {
        let log_err = RuntimeLogState(arc_log_err);
        let r = std::io::BufReader::new(stderr);
        for line in r.lines() {
            if let Ok(l) = line {
                log_err.push(l);
            }
        }
    });

    {
        let mut s = state.lock().map_err(|e| e.to_string())?;
        if let Some(ref mut old) = s.child {
            let _ = old.kill();
        }
        s.port = Some(port);
        s.child = Some(child);
    }

    let timeout_secs = readiness_timeout_seconds();
    let args_debug = args.join(" ");

    for elapsed_secs in 1..=timeout_secs {
        tokio::time::sleep(Duration::from_secs(1)).await;

        let health_url = format!("http://127.0.0.1:{}/health", port);
        match reqwest::get(&health_url).await {
            Ok(resp) => {
                let status = resp.status().as_u16();
                if status == 200 {
                    if debug_runtime {
                        eprintln!("[runtime DEBUG] time_to_first_200_secs={}", elapsed_secs);
                    } else {
                        eprintln!("[llama readiness] elapsedSeconds={} url={} httpStatus={}", elapsed_secs, health_url, status);
                    }
                    return Ok(RuntimeStartResult { port });
                }
                let body_preview = if debug_runtime {
                    let body_snippet = resp.text().await.unwrap_or_default();
                    if body_snippet.len() > 120 {
                        format!("{}...", &body_snippet[..120])
                    } else {
                        body_snippet
                    }
                } else {
                    String::new()
                };
                if debug_runtime {
                    eprintln!(
                        "[runtime DEBUG] health probe elapsed_secs={} url={} status={} body={:?}",
                        elapsed_secs, health_url, status, body_preview
                    );
                } else {
                    eprintln!("[llama readiness] elapsedSeconds={} url={} httpStatus={}", elapsed_secs, health_url, status);
                }
            }
            Err(e) => {
                if debug_runtime {
                    eprintln!("[runtime DEBUG] health probe elapsed_secs={} url={} error={}", elapsed_secs, health_url, e);
                } else {
                    eprintln!("[llama readiness] elapsedSeconds={} url={} httpStatus=(request failed)", elapsed_secs, health_url);
                }
            }
        }

        let models_url = format!("http://127.0.0.1:{}/v1/models", port);
        match reqwest::get(&models_url).await {
            Ok(resp) => {
                let status = resp.status().as_u16();
                if debug_runtime {
                    let _ = resp.text().await;
                }
                eprintln!("[llama readiness] elapsedSeconds={} url={} httpStatus={}", elapsed_secs, models_url, status);
                if status == 200 {
                    if debug_runtime {
                        eprintln!("[runtime DEBUG] time_to_first_200_secs={} (via /v1/models)", elapsed_secs);
                    }
                    return Ok(RuntimeStartResult { port });
                }
            }
            Err(_) => {
                eprintln!("[llama readiness] elapsedSeconds={} url={} httpStatus=(request failed)", elapsed_secs, models_url);
            }
        }
    }

    let mut s = state.lock().map_err(|e| e.to_string())?;
    let last_output: String = log_state.lines().join("\n");
    let last_output_trim = if last_output.len() > 2000 {
        format!("...{}", last_output.get(last_output.len().saturating_sub(2000)..).unwrap_or(""))
    } else {
        last_output
    };
    if let Some(mut child) = s.child.take() {
        let _ = child.kill();
    }
    s.port = None;

    let last_output_suffix = if last_output_trim.is_empty() {
        String::new()
    } else {
        format!("\n\nLast llama-server output:\n{}", last_output_trim)
    };
    let err_msg = format!(
        "llama-server did not become ready within {} seconds. port={} model_path={} launch_args=[{}]{}",
        timeout_secs,
        port,
        gguf_path,
        args_debug,
        last_output_suffix
    );
    Err(err_msg)
}

#[tauri::command]
pub async fn runtime_status(
    state: tauri::State<'_, Mutex<RuntimeState>>,
) -> Result<RuntimeStatusResult, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let (running, pid): (bool, Option<u32>) = if let Some(child) = s.child.as_mut() {
        let pid_u32 = child.id();
        match child.try_wait() {
            Ok(Some(_)) => {
                s.child = None;
                s.port = None;
                (false, None)
            }
            Ok(None) => (true, Some(pid_u32)),
            Err(_) => (false, None),
        }
    } else {
        (false, None)
    };
    let port = if running { s.port } else { None };
    Ok(RuntimeStatusResult {
        running,
        port,
        pid: if running { pid } else { None },
    })
}

#[tauri::command]
pub fn get_runtime_log(log_state: tauri::State<'_, RuntimeLogState>) -> Vec<String> {
    log_state.lines()
}

#[tauri::command]
pub async fn runtime_stop(
    state: tauri::State<'_, Mutex<RuntimeState>>,
) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = s.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    s.port = None;
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize)]
struct CompletionRequest {
    prompt: String,
    n_predict: i32,
    temperature: f64,
    top_p: f64,
    stream: bool,
}

#[derive(serde::Deserialize)]
struct CompletionResponse {
    content: Option<String>,
}

/// SSE chunk when stream: true (llama-server sends data: {...} lines).
#[derive(serde::Deserialize)]
#[allow(dead_code)]
struct CompletionChunk {
    content: Option<String>,
    #[serde(default)]
    stop: bool,
}

#[derive(Clone, Serialize)]
struct StreamTokenPayload {
    run_id: Option<String>,
    content: String,
}

/// Process SSE buffer: split on \n, handle lines starting with "data: ", emit tokens and append to full_text.
fn process_sse_buf(
    buf: &mut Vec<u8>,
    app: &tauri::AppHandle,
    run_id: Option<&String>,
    full_text: &mut String,
) {
    let mut keep = 0;
    let mut i = 0;
    while i < buf.len() {
        if buf[i] == b'\n' || (buf[i] == b'\r' && i + 1 < buf.len() && buf[i + 1] == b'\n') {
            let line_end = if buf[i] == b'\r' { i + 2 } else { i + 1 };
            let line = std::str::from_utf8(&buf[keep..i]).unwrap_or("");
            let line = line.trim();
            if line.starts_with("data: ") {
                let rest = line["data: ".len()..].trim();
                if rest == "[DONE]" || rest.is_empty() {
                    // skip
                } else if let Ok(chunk) = serde_json::from_str::<CompletionChunk>(rest) {
                    if let Some(ref c) = chunk.content {
                        full_text.push_str(c);
                        let _ = app.emit("llama-stream-token", StreamTokenPayload {
                            run_id: run_id.cloned(),
                            content: c.clone(),
                        });
                    }
                }
            }
            keep = line_end;
            i = line_end;
        } else {
            i += 1;
        }
    }
    if keep > 0 {
        buf.drain(..keep);
    }
}

/// OpenAI-style chat message.
#[derive(serde::Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

/// Request for /v1/chat/completions.
#[derive(serde::Serialize)]
struct ChatCompletionsRequest {
    model: String,
    messages: Vec<ChatMessage>,
    max_tokens: i32,
    temperature: f64,
    stream: bool,
}

#[derive(serde::Deserialize)]
struct ChatChoice {
    message: Option<ChatMessageResponse>,
}

#[derive(serde::Deserialize)]
struct ChatMessageResponse {
    content: Option<String>,
}

#[derive(serde::Deserialize)]
struct ChatCompletionsResponse {
    choices: Option<Vec<ChatChoice>>,
}

#[derive(Default, Clone, serde::Serialize, serde::Deserialize)]
pub struct ChatOptions {
    #[serde(default)]
    pub max_tokens: i32,
    #[serde(default)]
    pub temperature: f64,
}

/// Cancel an in-flight run (e.g. after timeout or user Stop). No-op if run_id not registered.
#[tauri::command]
pub fn runtime_cancel_run(run_id: String, cancel_state: tauri::State<'_, CancelRunState>) {
    if let Some(tx) = cancel_state.0.lock().unwrap().remove(&run_id) {
        let _ = tx.send(());
    }
}

/// Try /v1/chat/completions first (non-stream); on failure try /completion. When stream is true, use /completion with SSE.
/// If run_id is Some, the request can be aborted via runtime_cancel_run(run_id).
#[tauri::command]
pub async fn runtime_chat(
    app: tauri::AppHandle,
    system_prompt: String,
    user_prompt: String,
    options: Option<ChatOptions>,
    run_id: Option<String>,
    state: tauri::State<'_, Mutex<RuntimeState>>,
    cancel_state: tauri::State<'_, CancelRunState>,
) -> Result<String, String> {
    let port = {
        let s = state.lock().map_err(|e| e.to_string())?;
        s.port.ok_or_else(|| {
            "Runtime not started. Start the runtime with a GGUF model first.\nEndpoint: n/a (runtime not started)".to_string()
        })?
    };

    let opt = options.unwrap_or_default();
    let max_tokens = if opt.max_tokens > 0 { opt.max_tokens } else { 128 };
    let temperature = if opt.temperature >= 0.0 && opt.temperature <= 2.0 {
        opt.temperature
    } else {
        0.5
    };

    let combined = format!("{}\n\n{}", system_prompt.trim(), user_prompt.trim());

    let url_completion = format!("http://127.0.0.1:{}/completion", port);
    let body_completion_stream = CompletionRequest {
        prompt: combined.clone(),
        n_predict: max_tokens,
        temperature,
        top_p: 0.9,
        stream: true,
    };

    let do_request_non_stream = async {
        let client = reqwest::Client::new();
        let url_completions = format!("http://127.0.0.1:{}/v1/chat/completions", port);
        let body_completions = ChatCompletionsRequest {
            model: "llama".to_string(),
            messages: vec![
                ChatMessage { role: "system".to_string(), content: system_prompt },
                ChatMessage { role: "user".to_string(), content: user_prompt },
            ],
            max_tokens,
            temperature,
            stream: false,
        };

        if let Ok(resp) = client.post(&url_completions).json(&body_completions).send().await {
            if resp.status().is_success() {
                if let Ok(json) = resp.json::<ChatCompletionsResponse>().await {
                    if let Some(choices) = json.choices {
                        if let Some(first) = choices.into_iter().next() {
                            if let Some(msg) = first.message {
                                if let Some(c) = msg.content {
                                    return Ok(c.trim().to_string());
                                }
                            }
                        }
                    }
                }
            }
        }

        let body_completion = CompletionRequest {
            prompt: combined,
            n_predict: max_tokens,
            temperature,
            top_p: 0.9,
            stream: false,
        };
        let resp = client
            .post(&url_completion)
            .json(&body_completion)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}\nEndpoint: {} (no response)", e, url_completion))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!(
                "llama-server error {}: {}\nEndpoint: {} HTTP {}",
                status, text, url_completion, status
            ));
        }

        let json: CompletionResponse = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
        Ok(json.content.unwrap_or_default().trim().to_string())
    };

    let client = reqwest::Client::new();
    let resp = match client
        .post(&url_completion)
        .json(&body_completion_stream)
        .send()
        .await
    {
        Err(_) => return do_request_non_stream.await,
        Ok(r) if !r.status().is_success() => return do_request_non_stream.await,
        Ok(r) => r,
    };

    let (tx, mut rx) = oneshot::channel::<()>();
    if let Some(ref rid) = run_id {
        cancel_state.0.lock().unwrap().insert(rid.clone(), tx);
    }

    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    let mut full_text = String::new();
    let run_id_ref = run_id.as_ref();

    loop {
        tokio::select! {
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        buf.extend_from_slice(&bytes);
                        process_sse_buf(&mut buf, &app, run_id_ref, &mut full_text);
                    }
                    Some(Err(_)) => {
                        if run_id.is_some() {
                            cancel_state.0.lock().unwrap().remove(run_id.as_ref().unwrap());
                        }
                        return do_request_non_stream.await;
                    }
                    None => break,
                }
            }
            _ = &mut rx => {
                if let Some(ref rid) = run_id {
                    cancel_state.0.lock().unwrap().remove(rid);
                }
                return Err("Run cancelled or timed out.".to_string());
            }
        }
    }

    if let Some(ref rid) = run_id {
        cancel_state.0.lock().unwrap().remove(rid);
    }
    Ok(full_text.trim().to_string())
}

/// Generate completion. If run_id is Some, the request can be aborted via runtime_cancel_run(run_id).
/// When stream is true, emits "llama-stream-token" events and returns full text when done.
#[tauri::command]
pub async fn runtime_generate(
    app: tauri::AppHandle,
    prompt: String,
    stream: bool,
    options: Option<GenerateOptions>,
    run_id: Option<String>,
    state: tauri::State<'_, Mutex<RuntimeState>>,
    cancel_state: tauri::State<'_, CancelRunState>,
) -> Result<String, String> {
    let port = {
        let s = state.lock().map_err(|e| e.to_string())?;
        s.port.ok_or("Runtime not started. Start the runtime with a GGUF model first.")?
    };

    let opt = options.unwrap_or_default();
    let temperature = if opt.temperature != 0.0 {
        opt.temperature
    } else {
        0.7
    };
    let top_p = if opt.top_p != 0.0 { opt.top_p } else { 0.9 };
    let max_tokens = if opt.max_tokens > 0 {
        opt.max_tokens
    } else {
        2048
    };

    let url = format!("http://127.0.0.1:{}/completion", port);
    let body = CompletionRequest {
        prompt: prompt.clone(),
        n_predict: max_tokens,
        temperature,
        top_p,
        stream,
    };

    if stream {
        let client = reqwest::Client::new();
        let resp = match client.post(&url).json(&body).send().await {
            Err(e) => return Err(format!("Request failed: {}", e)),
            Ok(r) if !r.status().is_success() => {
                let status = r.status();
                let text = r.text().await.unwrap_or_default();
                return Err(format!("Server error {}: {}", status, text));
            }
            Ok(r) => r,
        };

        let mut stream = resp.bytes_stream();
        let mut buf: Vec<u8> = Vec::new();
        let mut full_text = String::new();

        let (tx, mut rx) = oneshot::channel::<()>();
        if let Some(ref rid) = run_id {
            cancel_state.0.lock().unwrap().insert(rid.clone(), tx);
        }

        let run_id_ref = run_id.as_ref();
        loop {
            tokio::select! {
                chunk = stream.next() => {
                    match chunk {
                        Some(Ok(bytes)) => {
                            buf.extend_from_slice(&bytes);
                            process_sse_buf(&mut buf, &app, run_id_ref, &mut full_text);
                        }
                        Some(Err(e)) => {
                            if run_id.is_some() {
                                cancel_state.0.lock().unwrap().remove(run_id.as_ref().unwrap());
                            }
                            return Err(format!("Stream error: {}", e));
                        }
                        None => break,
                    }
                }
                _ = &mut rx => {
                    if let Some(ref rid) = run_id {
                        cancel_state.0.lock().unwrap().remove(rid);
                    }
                    return Err("Run cancelled or timed out.".to_string());
                }
            }
        }

        if let Some(ref rid) = run_id {
            cancel_state.0.lock().unwrap().remove(rid);
        }
        Ok(full_text)
    } else {
        let do_request = async {
            let client = reqwest::Client::new();
            let resp = client
                .post(&url)
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                return Err(format!("Server error {}: {}", status, text));
            }

            let json: CompletionResponse = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
            Ok(json.content.unwrap_or_default())
        };

        if let Some(rid) = run_id {
            let (tx, rx) = oneshot::channel();
            cancel_state.0.lock().unwrap().insert(rid.clone(), tx);
            let result = tokio::select! {
                r = do_request => {
                    cancel_state.0.lock().unwrap().remove(&rid);
                    r
                }
                _ = rx => {
                    cancel_state.0.lock().unwrap().remove(&rid);
                    Err("Run cancelled or timed out.".to_string())
                }
            };
            result
        } else {
            do_request.await
        }
    }
}
