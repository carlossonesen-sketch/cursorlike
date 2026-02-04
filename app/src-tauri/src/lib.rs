mod project_root;
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
        .manage(runtime::CancelRunState::default())
        .manage(runtime::RuntimeLogState::default())
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
            workspace::workspace_walk_snapshot,
            workspace::delete_project_file,
            workspace::run_system_command,
            workspace::workspace_run_command,
            project_root::detect_project_root,
            toolroot::find_tool_root,
            toolroot::scan_models_for_gguf,
            toolroot::scan_models_for_gguf_by_mtime,
            toolroot::tool_root_exists,
            runtime::runtime_health_check,
            runtime::runtime_health_check_status,
            runtime::runtime_start,
            runtime::runtime_cancel_run,
            runtime::get_runtime_log,
            runtime::runtime_chat,
            runtime::runtime_status,
            runtime::runtime_stop,
            runtime::runtime_generate,
            workspace::get_global_tool_root,
            workspace::ensure_global_tool_dirs,
            workspace::scan_global_models_gguf,
            workspace::download_file_to_path,
            runtime::get_app_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

