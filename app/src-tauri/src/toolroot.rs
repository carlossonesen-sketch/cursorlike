//! Tool-root discovery: walk up from workspace to find runtime/llama + models/.

use std::path::Path;

const MAX_LEVELS: u32 = 8;

#[cfg(windows)]
const LLAMA_EXE: &str = "runtime/llama/llama-server.exe";
#[cfg(not(windows))]
const LLAMA_EXE: &str = "runtime/llama/llama-server";

const MODELS_DIR: &str = "models";
const GGUF_EXT: &str = ".gguf";
const PREFER_PATTERN: &[&str] = &["coder", "code", "instruct"];

fn name_preferred(name: &str) -> bool {
    let lower = name.to_lowercase();
    PREFER_PATTERN.iter().any(|p| lower.contains(p))
}

/// Walk up from workspace_root (up to 8 levels). First dir containing BOTH
/// runtime/llama/llama-server.exe and models/ (folder) is toolRoot.
/// Returns absolute path as string, or None.
#[tauri::command]
pub fn find_tool_root(workspace_root: String) -> Result<Option<String>, String> {
    let mut dir = Path::new(&workspace_root)
        .canonicalize()
        .map_err(|e| format!("workspace_root invalid: {}", e))?;
    for _ in 0..MAX_LEVELS {
        let exe = dir.join(LLAMA_EXE);
        let models = dir.join(MODELS_DIR);
        if exe.is_file() && models.is_dir() {
            return Ok(Some(
                dir.to_string_lossy().into_owned().replace('\\', "/"),
            ));
        }
        let Some(parent) = dir.parent() else {
            break;
        };
        dir = parent.to_path_buf();
    }
    Ok(None)
}

/// Check that tool_root/rel_path exists (file or dir).
#[tauri::command]
pub fn tool_root_exists(tool_root: String, rel_path: String) -> Result<bool, String> {
    let rel = rel_path.trim().trim_start_matches(|c| c == '/' || c == '\\');
    let full = Path::new(&tool_root).join(rel);
    Ok(full.try_exists().unwrap_or(false))
}

/// Scan tool_root/models for *.gguf. Returns toolRoot-relative path (e.g. models/foo.gguf) or None.
/// If exactly 1 => pick it. If multiple => prefer filename containing coder|code|instruct, then largest size.
#[tauri::command]
pub fn scan_models_for_gguf(tool_root: String) -> Result<Option<String>, String> {
    let models_dir = Path::new(&tool_root).join(MODELS_DIR);
    if !models_dir.is_dir() {
        return Ok(None);
    }
    let mut ggufs: Vec<(String, u64, bool)> = Vec::new();
    for e in std::fs::read_dir(&models_dir).map_err(|e| e.to_string())? {
        let e = e.map_err(|e| e.to_string())?;
        let name = e.file_name().to_string_lossy().into_owned();
        if e.file_type().map(|t| t.is_dir()).unwrap_or(true) {
            continue;
        }
        if !name.to_lowercase().ends_with(GGUF_EXT) {
            continue;
        }
        let rel = format!("{}/{}", MODELS_DIR, name);
        let full = models_dir.join(&name);
        let size = std::fs::metadata(&full).map(|m| m.len()).unwrap_or(0);
        let prefer = name_preferred(&name);
        ggufs.push((rel, size, prefer));
    }
    if ggufs.is_empty() {
        return Ok(None);
    }
    if ggufs.len() == 1 {
        return Ok(Some(ggufs[0].0.clone()));
    }
    ggufs.sort_by(|a, b| {
        if a.2 != b.2 {
            return if a.2 { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater };
        }
        b.1.cmp(&a.1)
    });
    Ok(Some(ggufs[0].0.clone()))
}
