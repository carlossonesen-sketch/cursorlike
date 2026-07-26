use crate::ai_credentials::{resolve_openai_credential, CredentialSource};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Duration;

const RESPONSE_LIMIT_BYTES: usize = 1024 * 1024;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiAgentStep {
    pub response_id: String,
    pub text: String,
    pub tool_calls: Vec<OpenAiToolCall>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiConnectivityResult {
    pub state: String,
    pub backend_credential_available: bool,
    pub model: String,
    pub diagnostic: String,
}

fn connectivity_result(
    model: String,
    backend_credential_available: bool,
    result: Result<(), String>,
) -> OpenAiConnectivityResult {
    match result {
        Ok(()) => OpenAiConnectivityResult {
            state: "available".into(),
            backend_credential_available,
            model,
            diagnostic: "OpenAI connectivity succeeded through the shared backend credential.".into(),
        },
        Err(diagnostic) => OpenAiConnectivityResult {
            state: "error".into(),
            backend_credential_available,
            model,
            diagnostic,
        },
    }
}

fn valid_model(model: &str) -> bool {
    !model.is_empty()
        && model.len() <= 100
        && model
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
}

fn safe_provider_error(status: reqwest::StatusCode, value: &serde_json::Value) -> String {
    let code = value
        .pointer("/error/code")
        .and_then(|item| item.as_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        "OpenAI rejected the backend credential.".into()
    } else if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        "OpenAI rate limit or quota was reached.".into()
    } else if status == reqwest::StatusCode::NOT_FOUND
        || code.contains("model")
        || code.contains("unsupported")
    {
        "Configured model is unavailable or unsupported.".into()
    } else {
        format!("OpenAI request failed with provider status {}.", status.as_u16())
    }
}

async fn send_request(
    api_key: &str,
    model: &str,
    prompt: &str,
    timeout: Duration,
    max_output_tokens: u32,
) -> Result<serde_json::Value, String> {
    let response = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|_| "OpenAI client initialization failed.".to_string())?
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(api_key)
        .json(&json!({
            "model": model,
            "input": prompt,
            "max_output_tokens": max_output_tokens
        }))
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "OpenAI request timed out.".to_string()
            } else {
                "OpenAI network request failed.".to_string()
            }
        })?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "OpenAI response could not be read.".to_string())?;
    if bytes.len() > RESPONSE_LIMIT_BYTES {
        return Err("OpenAI response exceeded the safe size limit.".into());
    }
    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| "OpenAI returned an invalid response.".to_string())?;
    if !status.is_success() {
        return Err(safe_provider_error(status, &value));
    }
    Ok(value)
}

pub async fn openai_agent_step(
    model: &str,
    instructions: &str,
    input: serde_json::Value,
    tools: &[OpenAiToolDefinition],
    previous_response_id: Option<&str>,
    timeout: Duration,
) -> Result<OpenAiAgentStep, String> {
    if !valid_model(model) || instructions.is_empty() || tools.len() > 32 {
        return Err("Agent provider request is invalid.".into());
    }
    let resolved = resolve_openai_credential()?
        .ok_or_else(|| "OpenAI provider unavailable: no backend credential is configured.".to_string())?;
    let provider_tools: Vec<serde_json::Value> = tools.iter().map(|tool| json!({
        "type": "function",
        "name": tool.name,
        "description": tool.description,
        "parameters": tool.parameters,
        "strict": true
    })).collect();
    let mut body = json!({
        "model": model,
        "instructions": instructions,
        "input": input,
        "tools": provider_tools,
        "tool_choice": "auto",
        "parallel_tool_calls": false,
        "max_output_tokens": 4096
    });
    if let Some(previous) = previous_response_id {
        body["previous_response_id"] = json!(previous);
    }
    let response = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|_| "OpenAI client initialization failed.".to_string())?
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(resolved.credential.as_backend_str())
        .json(&body)
        .send()
        .await
        .map_err(|error| if error.is_timeout() {
            "OpenAI agent request timed out.".to_string()
        } else {
            "OpenAI agent network request failed.".to_string()
        })?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|_| "OpenAI agent response could not be read.".to_string())?;
    if bytes.len() > RESPONSE_LIMIT_BYTES {
        return Err("OpenAI agent response exceeded the safe size limit.".into());
    }
    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| "OpenAI returned an invalid agent response.".to_string())?;
    if !status.is_success() {
        return Err(safe_provider_error(status, &value));
    }
    let mut calls = Vec::new();
    for item in value.get("output").and_then(|value| value.as_array()).into_iter().flatten() {
        if item.get("type").and_then(|value| value.as_str()) != Some("function_call") {
            continue;
        }
        let id = item.get("call_id").and_then(|value| value.as_str()).ok_or("Provider tool call omitted its id.")?;
        let name = item.get("name").and_then(|value| value.as_str()).ok_or("Provider tool call omitted its name.")?;
        let raw = item.get("arguments").and_then(|value| value.as_str()).ok_or("Provider tool call omitted arguments.")?;
        if raw.len() > 64 * 1024 {
            return Err("Provider tool arguments exceeded the safe limit.".into());
        }
        let arguments = serde_json::from_str(raw).map_err(|_| "Provider returned malformed tool arguments.")?;
        calls.push(OpenAiToolCall { id: id.into(), name: name.into(), arguments });
    }
    Ok(OpenAiAgentStep {
        response_id: value.get("id").and_then(|value| value.as_str()).unwrap_or_default().into(),
        text: output_text(&value),
        tool_calls: calls,
    })
}

fn output_text(value: &serde_json::Value) -> String {
    value
        .get("output")
        .and_then(|item| item.as_array())
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("content").and_then(|content| content.as_array()))
        .flatten()
        .filter_map(|content| {
            (content.get("type").and_then(|item| item.as_str()) == Some("output_text"))
                .then(|| content.get("text").and_then(|item| item.as_str()))
                .flatten()
        })
        .collect::<Vec<_>>()
        .join("")
}

#[tauri::command]
pub async fn openai_generate(model: String, prompt: String) -> Result<String, String> {
    let model = model.trim();
    if !valid_model(model) || prompt.trim().is_empty() {
        return Err("A supported OpenAI model and non-empty prompt are required.".into());
    }
    let resolved = resolve_openai_credential()?
        .ok_or_else(|| "OpenAI provider unavailable: no backend credential is configured.".to_string())?;
    let value = send_request(
        resolved.credential.as_backend_str(),
        model,
        &prompt,
        Duration::from_secs(120),
        16_384,
    )
    .await?;
    let text = output_text(&value);
    if text.trim().is_empty() {
        Err("OpenAI returned no text output.".into())
    } else {
        Ok(text.trim().to_string())
    }
}

#[tauri::command]
pub async fn openai_test_connectivity(model: String) -> OpenAiConnectivityResult {
    test_openai_connectivity_backend(model).await
}

pub async fn test_openai_connectivity_backend(model: String) -> OpenAiConnectivityResult {
    let model = model.trim().to_string();
    if !valid_model(&model) {
        return OpenAiConnectivityResult {
            state: "error".into(),
            backend_credential_available: matches!(resolve_openai_credential(), Ok(Some(_))),
            model,
            diagnostic: "Configured model name is invalid or unsupported by NF settings.".into(),
        };
    }
    let resolved = match resolve_openai_credential() {
        Ok(Some(value)) => value,
        Ok(None) => {
            return OpenAiConnectivityResult {
                state: "unavailable".into(),
                backend_credential_available: false,
                model,
                diagnostic: "No shared backend credential is available.".into(),
            }
        }
        Err(_) => {
            return OpenAiConnectivityResult {
                state: "error".into(),
                backend_credential_available: false,
                model,
                diagnostic: "Shared backend credential access failed.".into(),
            }
        }
    };
    let result = send_request(
        resolved.credential.as_backend_str(),
        &model,
        "Reply with OK.",
        Duration::from_secs(20),
        16,
    )
    .await;
    connectivity_result(model, true, result.map(|_| ()))
}

pub fn safe_credential_source_message(source: CredentialSource) -> &'static str {
    match source {
        CredentialSource::SavedBackendConfiguration => {
            "Shared saved backend credential is available."
        }
        CredentialSource::EnvironmentFallback => {
            "Shared backend credential is available through the environment fallback."
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_validation_is_separate_from_credentials() {
        assert!(valid_model("gpt-5.4"));
        assert!(valid_model("gpt-5-mini"));
        assert!(!valid_model(""));
        assert!(!valid_model("gpt-5;whoami"));
        assert!(!valid_model(&"x".repeat(101)));
    }

    #[test]
    fn provider_errors_are_bounded_and_secret_free() {
        let fake_secret = "fake-test-secret";
        let invalid = safe_provider_error(
            reqwest::StatusCode::UNAUTHORIZED,
            &json!({"error": {"message": fake_secret}}),
        );
        assert_eq!(invalid, "OpenAI rejected the backend credential.");
        assert!(!invalid.contains(fake_secret));
        let model = safe_provider_error(
            reqwest::StatusCode::NOT_FOUND,
            &json!({"error": {"message": fake_secret, "code": "model_not_found"}}),
        );
        assert_eq!(model, "Configured model is unavailable or unsupported.");
        assert!(!model.contains(fake_secret));
    }

    #[test]
    fn connectivity_serialization_contains_status_only() {
        let result = OpenAiConnectivityResult {
            state: "available".into(),
            backend_credential_available: true,
            model: "test-model".into(),
            diagnostic: "Shared backend credential is available.".into(),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(!json.to_ascii_lowercase().contains("api_key"));
        assert!(!json.contains("fake-test-secret"));
    }

    #[test]
    fn injected_connectivity_results_keep_credential_and_model_failures_separate() {
        let success = connectivity_result("test-model".into(), true, Ok(()));
        assert_eq!(success.state, "available");
        assert!(success.backend_credential_available);
        let invalid = connectivity_result(
            "test-model".into(),
            true,
            Err("OpenAI rejected the backend credential.".into()),
        );
        assert_eq!(invalid.state, "error");
        assert!(invalid.backend_credential_available);
        assert_eq!(invalid.diagnostic, "OpenAI rejected the backend credential.");
        let model = connectivity_result(
            "unsupported-model".into(),
            true,
            Err("Configured model is unavailable or unsupported.".into()),
        );
        assert!(model.backend_credential_available);
        assert_eq!(model.diagnostic, "Configured model is unavailable or unsupported.");
    }
}
