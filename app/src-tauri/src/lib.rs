mod runtime;
mod toolroot;
mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(std::sync::Mutex::new(runtime::RuntimeState::default()))
        .invoke_handler(tauri::generate_handler![
            workspace::workspace_read_dir,
            workspace::workspace_read_file,
            workspace::workspace_write_file,
            workspace::write_project_file,
            workspace::workspace_exists,
            workspace::workspace_mkdir_all,
            workspace::workspace_file_size,
            workspace::workspace_resolve_path,
            workspace::workspace_ensure_log_dir,
            workspace::workspace_append_file,
            workspace::workspace_search_files_by_name,
            toolroot::find_tool_root,
            toolroot::scan_models_for_gguf,
            toolroot::scan_models_for_gguf_by_mtime,
            toolroot::tool_root_exists,
            runtime::runtime_health_check,
            runtime::runtime_start,
            runtime::runtime_chat,
            runtime::runtime_status,
            runtime::runtime_stop,
            runtime::runtime_generate,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
