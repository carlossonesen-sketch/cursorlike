//! Workspace-scoped filesystem operations. All paths validated against root; no writes outside.

use std::path::{Path, PathBuf};

fn normalize_rel(s: &str) -> PathBuf {
    let p = Path::new(s);
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::Normal(x) => out.push(x),
            _ => {}
        }
    }
    out
}

/// Resolve relative path under workspace root. Fails if path escapes root.
/// Does not require target to exist (for write/exists).
fn resolve(root: &str, rel: &str) -> Result<PathBuf, String> {
    let root = Path::new(root);
    if !root.is_absolute() {
        return Err("workspace_root must be absolute".into());
    }
    if rel.contains("..") {
        return Err("path must not escape workspace".into());
    }
    let rel = normalize_rel(rel);
    let root_canon = root.canonicalize().map_err(|e| e.to_string())?;
    let full = root_canon.join(&rel);
    if !full.starts_with(&root_canon) {
        return Err("path escapes workspace root".into());
    }
    Ok(full)
}

#[tauri::command]
pub fn workspace_read_dir(workspace_root: String, path: String) -> Result<Vec<DirEntry>, String> {
    let full = resolve(&workspace_root, &path)?;
    if !full.is_dir() {
        return Err("not a directory".into());
    }
    let mut out = Vec::new();
    for e in std::fs::read_dir(&full).map_err(|e| e.to_string())? {
        let e = e.map_err(|e| e.to_string())?;
        let name = e.file_name().to_string_lossy().into_owned();
        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(DirEntry { name, is_dir });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[derive(serde::Serialize)]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
}

#[tauri::command]
pub fn workspace_read_file(workspace_root: String, path: String) -> Result<String, String> {
    let full = resolve(&workspace_root, &path)?;
    std::fs::read_to_string(&full).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn workspace_write_file(
    workspace_root: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let full = resolve(&workspace_root, &path)?;
    if let Some(p) = full.parent() {
        std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    std::fs::write(&full, content.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn workspace_exists(workspace_root: String, path: String) -> Result<bool, String> {
    let full = resolve(&workspace_root, &path)?;
    Ok(full.try_exists().unwrap_or(false))
}

#[tauri::command]
pub fn workspace_file_size(workspace_root: String, path: String) -> Result<u64, String> {
    let full = resolve(&workspace_root, &path)?;
    let meta = std::fs::metadata(&full).map_err(|e| e.to_string())?;
    Ok(meta.len())
}

#[tauri::command]
pub fn workspace_mkdir_all(workspace_root: String, path: String) -> Result<(), String> {
    let full = resolve(&workspace_root, &path)?;
    std::fs::create_dir_all(&full).map_err(|e| e.to_string())
}
