use serde_json::json;
use std::time::Duration;

#[tauri::command]
pub async fn openai_generate(model: String, prompt: String) -> Result<String, String> {
    let api_key = std::env::var("OPENAI_API_KEY")
        .map_err(|_| "OpenAI provider unavailable: OPENAI_API_KEY is not configured in the NF backend process.")?;
    if model.trim().is_empty() || prompt.trim().is_empty() {
        return Err("OpenAI model and prompt are required.".into());
    }
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| error.to_string())?
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(api_key)
        .json(&json!({ "model": model, "input": prompt }))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let value: serde_json::Value = response.json().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        let message = value.pointer("/error/message").and_then(|item| item.as_str()).unwrap_or("OpenAI request failed.");
        return Err(format!("OpenAI request failed ({status}): {message}"));
    }
    let text = value.get("output")
        .and_then(|item| item.as_array())
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("content").and_then(|content| content.as_array()))
        .flatten()
        .filter_map(|content| {
            if content.get("type").and_then(|item| item.as_str()) == Some("output_text") {
                content.get("text").and_then(|item| item.as_str())
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join("");
    let text = text.trim();
    if text.is_empty() {
        Err("OpenAI returned no text output.".to_string())
    } else {
        Ok(text.to_string())
    }
}
