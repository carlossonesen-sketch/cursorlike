//! Workspace-scoped filesystem operations. All paths validated against root; no writes outside.

use chrono::{TimeZone, Utc};
use std::fs::OpenOptions;
use std::io::Write;
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

/// Write a file under workspace root. Same as workspace_write_file; alias for file-editor use.
/// Security: resolve() rejects ".." and ensures path stays under workspace_root.
#[tauri::command]
pub fn write_project_file(
    workspace_root: String,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    workspace_write_file(workspace_root, relative_path, content)
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

/// Resolve relative path under workspace root; return absolute path as string.
#[tauri::command]
pub fn workspace_resolve_path(workspace_root: String, path: String) -> Result<String, String> {
    let full = resolve(&workspace_root, &path)?;
    Ok(full.to_string_lossy().replace('\\', "/"))
}

/// Create .devassistant/logs and return absolute path for llama-server.log.
#[tauri::command]
pub fn workspace_ensure_log_dir(workspace_root: String) -> Result<String, String> {
    let logs_dir = resolve(&workspace_root, ".devassistant/logs")?;
    std::fs::create_dir_all(&logs_dir).map_err(|e| e.to_string())?;
    let log_file = logs_dir.join("llama-server.log");
    Ok(log_file.to_string_lossy().replace('\\', "/"))
}

/// Append content to a file under workspace root. Creates parent dirs and file if missing.
#[tauri::command]
pub fn workspace_append_file(
    workspace_root: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let full = resolve(&workspace_root, &path)?;
    if let Some(p) = full.parent() {
        std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .write(true)
        .open(&full)
        .map_err(|e| format!("append_file {}: {}", full.display(), e))?;
    f.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    f.write_all(b"\n").map_err(|e| e.to_string())?;
    f.flush().map_err(|e| e.to_string())?;
    Ok(())
}

/// Directories that must NEVER appear in search results (no descend, no files from under them).
const SEARCH_IGNORED: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    ".git",
    ".devassistant",
    "runtime",
    "models",
    "source", // excludes source/, source/DevAssistant, source/DevAssistant/_internal
];
/// Path prefixes to filter from results (defense in depth; use forward slash).
const SEARCH_IGNORED_PREFIXES: &[&str] = &["source/", "runtime/", "models/"];
const SEARCH_MAX_DEPTH: u32 = 8;
const SEARCH_MAX_RESULTS: usize = 20;

/// Search files by name under workspace root. Returns relative paths (max 20), sorted:
/// exact filename > exact stem > partial, then fewer segments (root-near), then shorter path, then alphabetical.
#[tauri::command]
pub fn workspace_search_files_by_name(
    workspace_root: String,
    file_name: String,
) -> Result<Vec<String>, String> {
    let root = Path::new(&workspace_root);
    if !root.is_absolute() {
        return Err("workspace_root must be absolute".into());
    }
    let root_canon = root.canonicalize().map_err(|e| e.to_string())?;
    let search_lower = file_name.trim().to_lowercase();
    if search_lower.is_empty() {
        return Ok(Vec::new());
    }
    let mut matches: Vec<String> = Vec::new();
    walk_for_name(
        &root_canon,
        PathBuf::new(),
        0,
        &search_lower,
        &mut matches,
    )?;
    matches.retain(|p| {
        let n = p.replace('\\', "/");
        !SEARCH_IGNORED_PREFIXES.iter().any(|pref| n.starts_with(*pref))
    });
    sort_search_results(&mut matches, &search_lower);
    if matches.len() > SEARCH_MAX_RESULTS {
        matches.truncate(SEARCH_MAX_RESULTS);
    }
    Ok(matches)
}

fn walk_for_name(
    root: &Path,
    rel: PathBuf,
    depth: u32,
    search_lower: &str,
    out: &mut Vec<String>,
) -> Result<(), String> {
    if depth > SEARCH_MAX_DEPTH || out.len() >= SEARCH_MAX_RESULTS {
        return Ok(());
    }
    let full = root.join(&rel);
    let entries = match std::fs::read_dir(&full) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };
    for e in entries {
        if out.len() >= SEARCH_MAX_RESULTS {
            break;
        }
        let e = e.map_err(|e| e.to_string())?;
        let name = e.file_name().to_string_lossy().into_owned();
        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            if SEARCH_IGNORED.iter().any(|&d| d.eq_ignore_ascii_case(&name)) {
                continue;
            }
            let next_rel = rel.join(&name);
            walk_for_name(root, next_rel, depth + 1, search_lower, out)?;
        } else {
            let name_lower = name.to_lowercase();
            let stem = Path::new(&name)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            let exact = name_lower == *search_lower || stem == *search_lower;
            let fuzzy = name_lower.contains(search_lower) || stem.contains(search_lower);
            if exact || fuzzy {
                let rel_str = rel.join(&name).to_string_lossy().replace('\\', "/");
                out.push(rel_str);
            }
        }
    }
    Ok(())
}

fn sort_search_results(matches: &mut [String], search_lower: &str) {
    fn rank(path: &str, search_lower: &str) -> (u8, usize, usize) {
        let name = Path::new(path).file_name().and_then(|n| n.to_str()).unwrap_or("").to_lowercase();
        let stem = Path::new(path).file_stem().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
        let tier = if name == search_lower {
            0u8 // exact filename
        } else if stem == search_lower {
            1 // exact stem
        } else {
            2 // partial
        };
        let segments = path.matches(|c| c == '/' || c == '\\').count() + 1;
        (tier, segments, path.len())
    }
    matches.sort_by(|a, b| {
        let (a_tier, a_seg, a_len) = rank(a, search_lower);
        let (b_tier, b_seg, b_len) = rank(b, search_lower);
        a_tier.cmp(&b_tier)
            .then(a_seg.cmp(&b_seg))
            .then(a_len.cmp(&b_len))
            .then(a.cmp(b))
    });
}

// --- Snapshot walk ---

const SNAPSHOT_IGNORED: &[&str] = &[
    "node_modules", ".git", "dist", "build", ".next", "out", ".turbo", ".cache",
    "coverage", "target", ".venv", "venv", "__pycache__", ".DS_Store", ".devassistant",
];
const SNAPSHOT_MAX_DEPTH: u32 = 25;
const SNAPSHOT_MAX_FILES: usize = 2000;
const SNAPSHOT_MAX_FILE_BYTES: u64 = 2 * 1024 * 1024; // 2MB

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotFileEntry {
    pub path: String,
    pub size_bytes: u64,
    pub modified_at: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalkSnapshotResult {
    pub total_files: u64,
    pub total_dirs: u64,
    pub files: Vec<SnapshotFileEntry>,
    pub top_level: Vec<String>,
}

#[tauri::command]
pub fn workspace_walk_snapshot(
    workspace_root: String,
) -> Result<WalkSnapshotResult, String> {
    let root = Path::new(&workspace_root);
    if !root.is_absolute() {
        return Err("workspace_root must be absolute".into());
    }
    let root_canon = root.canonicalize().map_err(|e| e.to_string())?;

    let mut total_files: u64 = 0;
    let mut total_dirs: u64 = 0;
    let mut files: Vec<SnapshotFileEntry> = Vec::new();
    let mut top_level: Vec<String> = Vec::new();

    let mut stack: Vec<(PathBuf, u32, String)> = vec![(root_canon.clone(), 0, String::new())];

    while let Some((dir, depth, rel_prefix)) = stack.pop() {
        if depth > SNAPSHOT_MAX_DEPTH {
            continue;
        }
        if files.len() >= SNAPSHOT_MAX_FILES {
            break;
        }

        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for e in entries.flatten() {
            let ft = e.file_type();
            if ft.as_ref().map(|t| t.is_symlink()).unwrap_or(false) {
                continue;
            }
            let name = e.file_name().to_string_lossy().into_owned();
            let is_dir = ft.map(|t| t.is_dir()).unwrap_or(false);
            let rel_path = if rel_prefix.is_empty() {
                name.clone()
            } else {
                format!("{}/{}", rel_prefix, name)
            };

            if is_dir {
                if SNAPSHOT_IGNORED.iter().any(|&d| d.eq_ignore_ascii_case(&name)) {
                    continue;
                }
                total_dirs += 1;
                if depth == 0 {
                    top_level.push(name.clone());
                }
                let full = dir.join(&name);
                stack.push((full, depth + 1, rel_path));
            } else {
                total_files += 1;
                if depth == 0 {
                    top_level.push(name.clone());
                }
                let full = dir.join(&name);
                let size = std::fs::metadata(&full).map(|m| m.len()).unwrap_or(0);
                let modified = std::fs::metadata(&full)
                    .and_then(|m| m.modified())
                    .ok();
                let modified_iso = modified
                    .and_then(|t| {
                        t.duration_since(std::time::UNIX_EPOCH)
                            .ok()
                            .and_then(|d| {
                                Utc.timestamp_opt(d.as_secs() as i64, 0)
                                    .single()
                                    .map(|dt| dt.to_rfc3339())
                            })
                    })
                    .unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string());

                if size <= SNAPSHOT_MAX_FILE_BYTES && files.len() < SNAPSHOT_MAX_FILES {
                    files.push(SnapshotFileEntry {
                        path: rel_path.replace('\\', "/"),
                        size_bytes: size,
                        modified_at: modified_iso,
                    });
                }
            }
        }
    }

    top_level.sort();

    Ok(WalkSnapshotResult {
        total_files,
        total_dirs,
        files,
        top_level,
    })
}
