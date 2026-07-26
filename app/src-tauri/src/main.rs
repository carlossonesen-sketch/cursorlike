// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|argument| argument == "--test-openai-connectivity") {
        let model = std::env::args()
            .skip_while(|argument| argument != "--model")
            .nth(1)
            .unwrap_or_else(|| "gpt-5.4".into());
        let result = tauri::async_runtime::block_on(
            devassistant_cursor_light_lib::test_openai_connectivity_backend(model),
        );
        println!("State: {}", result.state);
        println!("Backend credential available: {}", result.backend_credential_available);
        println!("Model: {}", result.model);
        println!("Diagnostic: {}", result.diagnostic);
        std::process::exit(if result.state == "available" { 0 } else { 2 });
    }
    devassistant_cursor_light_lib::run()
}
