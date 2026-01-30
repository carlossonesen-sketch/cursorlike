//! Local llama-server runtime: start/stop/status and generate via HTTP /completion.

use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};

#[derive(Default)]
pub struct RuntimeState {
    pub port: Option<u16>,
    pub child: Option<Child>,
}

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

const DEFAULT_PORT: u16 = 11435;

fn find_free_port() -> Option<u16> {
    for port in 8080u16..8100u16 {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Some(port);
        }
    }
    None
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

/// Health check: GET http://127.0.0.1:port/health, return true if 200.
#[tauri::command]
pub async fn runtime_health_check(port: u16) -> Result<bool, String> {
    let url = format!("http://127.0.0.1:{}/health", port);
    match reqwest::get(&url).await {
        Ok(resp) => Ok(resp.status().as_u16() == 200),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
pub async fn runtime_start(
    gguf_path: String,
    tool_root: Option<String>,
    params: Option<RuntimeStartParams>,
    port_override: Option<u16>,
    log_file_path: Option<String>,
    state: tauri::State<'_, Mutex<RuntimeState>>,
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
        let port = port_override.unwrap_or(DEFAULT_PORT);
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
            .or_else(find_free_port)
            .ok_or("No free port in 8080..8099.")?;
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

    let (stdout, stderr) = if let Some(ref log_path) = log_file_path {
        let p = PathBuf::from(log_path);
        if let Some(parent) = p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let mut opts = std::fs::OpenOptions::new();
        opts.create(true).append(true).write(true);
        let f1 = opts.open(&p).map_err(|e| format!("Failed to open log file: {}", e))?;
        let f2 = opts.open(&p).map_err(|e| format!("Failed to open log file: {}", e))?;
        (Stdio::from(f1), Stdio::from(f2))
    } else {
        (Stdio::null(), Stdio::null())
    };

    let child = Command::new(&server_path)
        .args(&args)
        .stdout(stdout)
        .stderr(stderr)
        .spawn()
        .map_err(|e| format!("Failed to start llama-server: {}", e))?;

    {
        let mut s = state.lock().map_err(|e| e.to_string())?;
        if let Some(ref mut old) = s.child {
            let _ = old.kill();
        }
        s.port = Some(port);
        s.child = Some(child);
    }

    for _ in 0..40 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        let url = format!("http://127.0.0.1:{}/health", port);
        if let Ok(resp) = reqwest::get(&url).await {
            if resp.status().as_u16() == 200 {
                return Ok(RuntimeStartResult { port });
            }
        }
    }

    let mut s = state.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = s.child.take() {
        let _ = child.kill();
    }
    s.port = None;
    Err("llama-server did not become ready within 20 seconds.".to_string())
}

#[tauri::command]
pub async fn runtime_status(
    state: tauri::State<'_, Mutex<RuntimeState>>,
) -> Result<RuntimeStatusResult, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let running = if let Some(child) = s.child.as_mut() {
        match child.try_wait() {
            Ok(Some(_)) => {
                s.child = None;
                s.port = None;
                false
            }
            Ok(None) => true,
            Err(_) => false,
        }
    } else {
        false
    };
    let port = if running { s.port } else { None };
    Ok(RuntimeStatusResult { running, port })
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

/// Try /v1/chat/completions first; on failure try /completion. Returns assistant content or error.
#[tauri::command]
pub async fn runtime_chat(
    system_prompt: String,
    user_prompt: String,
    options: Option<ChatOptions>,
    state: tauri::State<'_, Mutex<RuntimeState>>,
) -> Result<String, String> {
    let port = {
        let s = state.lock().map_err(|e| e.to_string())?;
        s.port.ok_or_else(|| {
            "Runtime not started. Start the runtime with a GGUF model first.\nEndpoint: n/a (runtime not started)".to_string()
        })?
    };

    let opt = options.unwrap_or_default();
    let max_tokens = if opt.max_tokens > 0 { opt.max_tokens } else { 512 };
    let temperature = if opt.temperature >= 0.0 && opt.temperature <= 2.0 {
        opt.temperature
    } else {
        0.5
    };

    let combined = format!("{}\n\n{}", system_prompt.trim(), user_prompt.trim());

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

    let client = reqwest::Client::new();
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

    let url_completion = format!("http://127.0.0.1:{}/completion", port);
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
}

#[tauri::command]
pub async fn runtime_generate(
    prompt: String,
    stream: bool,
    options: Option<GenerateOptions>,
    state: tauri::State<'_, Mutex<RuntimeState>>,
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
        prompt,
        n_predict: max_tokens,
        temperature,
        top_p,
        stream,
    };

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
}
