//! Tool-root discovery: walk up from workspace to find runtime/llama + models/.
//! Model registry: discover GGUF from allowed dirs only (no full C:\ scan).

use std::path::{Path, PathBuf};

const MAX_LEVELS: u32 = 8;

/// Path segments that disqualify a path from model scan (ignore _archive, target, etc.).
const IGNORE_PATH_SEGMENTS: &[&str] = &["_archive", "target", "build", "intermediates", "node_modules"];

fn path_should_ignore(p: &Path) -> bool {
    p.components().any(|c| {
        if let std::path::Component::Normal(s) = c {
            let seg = s.to_string_lossy().to_lowercase();
            IGNORE_PATH_SEGMENTS.iter().any(|ign| seg.contains(ign))
        } else {
            false
        }
    })
}

#[cfg(windows)]
const LLAMA_EXE: &str = "runtime/llama/llama-server.exe";
#[cfg(windows)]
const LLAMA_EXE_ALT: &str = "runtime/llama/llama-server";
#[cfg(not(windows))]
const LLAMA_EXE: &str = "runtime/llama/llama-server";
#[cfg(not(windows))]
const LLAMA_EXE_ALT: &str = "runtime/llama/llama-server.exe";

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

#[derive(serde::Serialize)]
pub struct ScanModelsByMtimeResult {
    pub path: String,
    pub had_multiple: bool,
}

/// Scan tool_root/models for *.gguf. Pick by most recently modified.
/// If multiple, pick newest and set had_multiple.
#[tauri::command]
pub fn scan_models_for_gguf_by_mtime(tool_root: String) -> Result<Option<ScanModelsByMtimeResult>, String> {
    let models_dir = Path::new(&tool_root).join(MODELS_DIR);
    if !models_dir.is_dir() {
        return Ok(None);
    }
    let mut ggufs: Vec<(String, std::time::SystemTime)> = Vec::new();
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
        let mtime = std::fs::metadata(&full).and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
        ggufs.push((rel, mtime));
    }
    if ggufs.is_empty() {
        return Ok(None);
    }
    let had_multiple = ggufs.len() > 1;
    ggufs.sort_by(|a, b| b.1.cmp(&a.1));
    Ok(Some(ScanModelsByMtimeResult {
        path: ggufs[0].0.clone(),
        had_multiple,
    }))
}

/// Global tool root: %LOCALAPPDATA%\DevAssistantCursorLite\tools (Windows) or $HOME/.local/share/DevAssistantCursorLite/tools (Unix).
pub fn get_global_tool_root() -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        let local = std::env::var("LOCALAPPDATA").map_err(|_| "LOCALAPPDATA not set".to_string())?;
        Ok(PathBuf::from(local)
            .join("DevAssistantCursorLite")
            .join("tools"))
    }
    #[cfg(not(windows))]
    {
        let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
        Ok(PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("DevAssistantCursorLite")
            .join("tools"))
    }
}

/// Return the global models directory: %LOCALAPPDATA%\DevAssistantCursorLite\tools\models (Windows)
/// or $HOME/.local/share/DevAssistantCursorLite/tools/models (Unix). Does not create it.
#[tauri::command]
pub fn get_global_models_dir() -> Result<String, String> {
    let root = get_global_tool_root()?;
    let p = root.join(MODELS_DIR);
    Ok(p.to_string_lossy().replace('\\', "/"))
}

/// Check if path contains a valid llama-server executable (either .exe or no extension).
fn llama_exe_exists_at(root: &Path) -> Option<PathBuf> {
    let a = root.join(LLAMA_EXE);
    if a.is_file() {
        return Some(a);
    }
    let b = root.join(LLAMA_EXE_ALT);
    if b.is_file() {
        return Some(b);
    }
    None
}

/// Resolve tool root: use UI path if it contains runtime/llama/llama-server(.exe), else global tool root.
/// Returns the resolved PathBuf or an error listing the paths checked.
pub fn resolve_tool_root(tool_root_from_ui: Option<&str>) -> Result<PathBuf, String> {
    let mut checked: Vec<String> = Vec::new();
    if let Some(tr) = tool_root_from_ui {
        let tr = tr.trim();
        if !tr.is_empty() {
            let root = PathBuf::from(tr.replace('\\', "/"));
            if llama_exe_exists_at(&root).is_some() {
                return Ok(root);
            }
            checked.push(exe_path_display(&root, LLAMA_EXE));
            #[cfg(windows)]
            checked.push(exe_path_display(&root, LLAMA_EXE_ALT));
        }
    }
    let global = get_global_tool_root().map_err(|e| {
        format!(
            "Global tool root unavailable: {}. Paths checked: {}",
            e,
            checked.join("; ")
        )
    })?;
    checked.push(global.join(LLAMA_EXE).to_string_lossy().into_owned());
    #[cfg(windows)]
    checked.push(global.join(LLAMA_EXE_ALT).to_string_lossy().into_owned());
    if llama_exe_exists_at(&global).is_some() {
        return Ok(global);
    }
    Err(format!(
        "llama-server not found. Checked: {}",
        checked.join("; ")
    ))
}

fn exe_path_display(root: &Path, rel: &str) -> String {
    root.join(rel).to_string_lossy().replace('\\', "/")
}

/// Resolve tool root (Tauri command for frontend). Returns absolute path with forward slashes.
#[tauri::command]
pub fn resolve_tool_root_cmd(tool_root_from_ui: Option<String>) -> Result<String, String> {
    let path = resolve_tool_root(tool_root_from_ui.as_deref())?;
    Ok(path.to_string_lossy().replace('\\', "/"))
}

/// Check if path exists as a file (for GGUF path validation).
#[tauri::command]
pub fn path_exists(path: String) -> Result<bool, String> {
    let p = PathBuf::from(path.trim());
    Ok(p.is_file())
}

#[derive(serde::Serialize)]
pub struct DiscoveredModelEntry {
    /// Display/relative path (e.g. models/foo.gguf or .cursorlite/models/foo.gguf).
    pub display_path: String,
    /// Absolute path for loading.
    pub absolute_path: String,
    /// Source: "global" | "workspace" | "env".
    pub source: String,
}

/// Discover all .gguf in allowed dirs only: (a) global tools/models, (b) workspace/.cursorlite/models, (c) DEVASSISTANT_MODELS_DIRS.
/// Skips paths containing _archive, target, build, intermediates, node_modules.
#[tauri::command]
pub fn discover_gguf_models(workspace_root: String) -> Result<Vec<DiscoveredModelEntry>, String> {
    let mut out: Vec<DiscoveredModelEntry> = Vec::new();
    let workspace = Path::new(&workspace_root);

    // (a) Global models dir
    if let Ok(global_dir) = get_global_models_dir() {
        let global_path = PathBuf::from(&global_dir);
        if global_path.is_dir() && !path_should_ignore(&global_path) {
            collect_gguf_one_level(&global_path, &global_path, "global", &mut out);
        }
    }

    // (b) Workspace .cursorlite/models
    let cursorlite = workspace.join(".cursorlite").join(MODELS_DIR);
    if cursorlite.is_dir() && !path_should_ignore(&cursorlite) {
        let canon = cursorlite.canonicalize().unwrap_or(cursorlite);
        collect_gguf_one_level(&canon, &canon, "workspace", &mut out);
    }

    // (c) Env DEVASSISTANT_MODELS_DIRS (semicolon-separated)
    if let Ok(dirs) = std::env::var("DEVASSISTANT_MODELS_DIRS") {
        for d in dirs.split(';') {
            let d = d.trim();
            if d.is_empty() {
                continue;
            }
            let p = PathBuf::from(d);
            if let Ok(canon) = p.canonicalize() {
                if canon.is_dir() && !path_should_ignore(&canon) {
                    collect_gguf_one_level(&canon, &canon, "env", &mut out);
                }
            }
        }
    }

    Ok(out)
}

fn collect_gguf_one_level(
    dir: &Path,
    _base: &Path,
    source: &str,
    out: &mut Vec<DiscoveredModelEntry>,
) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if e.file_type().map(|t| t.is_dir()).unwrap_or(true) {
            continue;
        }
        if !name.to_lowercase().ends_with(GGUF_EXT) {
            continue;
        }
        let full = dir.join(&name);
        if path_should_ignore(&full) {
            continue;
        }
        let display = if source == "global" {
            format!("{}/{}", MODELS_DIR, name)
        } else if source == "workspace" {
            format!(".cursorlite/{}/{}", MODELS_DIR, name)
        } else {
            full.to_string_lossy().replace('\\', "/")
        };
        out.push(DiscoveredModelEntry {
            display_path: display,
            absolute_path: full.to_string_lossy().replace('\\', "/"),
            source: source.to_string(),
        });
    }
}
