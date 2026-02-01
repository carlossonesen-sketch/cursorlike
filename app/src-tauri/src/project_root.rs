//! Project root detection: walk upward from start path, find first directory
//! containing project signals (.git, package.json, Cargo.toml, etc.).

use std::path::Path;

const SIGNALS: &[&str] = &[
    ".git",
    "package.json",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "Cargo.toml",
    "pyproject.toml",
    "requirements.txt",
    "go.mod",
    "composer.json",
];

fn collect_signals(dir: &Path) -> Vec<String> {
    let mut found = Vec::new();
    for sig in SIGNALS {
        let p = dir.join(sig);
        if p.exists() {
            if p.is_dir() {
                found.push(sig.to_string());
            } else if std::fs::metadata(&p).map(|m| m.is_file()).unwrap_or(false) {
                found.push(sig.to_string());
            }
        }
    }
    found
}

/// Walk upward from start_path until we find a directory with a signal,
/// or reach filesystem root.
#[tauri::command]
pub fn detect_project_root(start_path: String) -> Result<DetectResult, String> {
    let start = Path::new(&start_path.trim());
    let mut current = if start.is_dir() {
        start.canonicalize().map_err(|e| e.to_string())?
    } else if let Some(parent) = start.parent() {
        parent.canonicalize().map_err(|e| e.to_string())?
    } else {
        return Err("Invalid start path".into());
    };

    loop {
        let signals = collect_signals(&current);
        if !signals.is_empty() {
            let root_str = current.to_string_lossy().replace('\\', "/");
            return Ok(DetectResult {
                root_path: root_str,
                signals_found: signals,
            });
        }
        if let Some(parent) = current.parent() {
            if parent == current {
                break;
            }
            let parent_canon = parent.canonicalize().unwrap_or_else(|_| parent.to_path_buf());
            if parent_canon == current {
                break;
            }
            current = parent_canon;
        } else {
            break;
        }
    }

    let root_str = current.to_string_lossy().replace('\\', "/");
    Ok(DetectResult {
        root_path: root_str,
        signals_found: Vec::new(),
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectResult {
    pub root_path: String,
    pub signals_found: Vec<String>,
}
