//! Safe file download into global models dir only (Windows: curl then PowerShell fallback).

use std::path::{Path, PathBuf};
use std::process::Command;

fn global_models_dir() -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        let local = std::env::var("LOCALAPPDATA").map_err(|_| "LOCALAPPDATA not set".to_string())?;
        Ok(PathBuf::from(local)
            .join("DevAssistantCursorLite")
            .join("tools")
            .join("models"))
    }
    #[cfg(not(windows))]
    {
        let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
        Ok(PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("DevAssistantCursorLite")
            .join("tools")
            .join("models"))
    }
}

/// Ensure dest_path is under the global models dir. Creates parent dirs. Returns canonicalized dest PathBuf.
fn validate_dest_under_global(dest_path: &str) -> Result<PathBuf, String> {
    let allowed = global_models_dir()?;
    std::fs::create_dir_all(&allowed).map_err(|e| format!("Create global models dir: {}", e))?;
    let allowed_canon = allowed.canonicalize().map_err(|e| format!("Global models dir invalid: {}", e))?;
    let dest_raw = PathBuf::from(dest_path.trim());
    let dest_canon = if dest_raw.exists() {
        dest_raw.canonicalize().map_err(|e| e.to_string())?
    } else {
        let parent = dest_raw.parent().ok_or("Invalid dest path (no parent)")?;
        let fname = dest_raw.file_name().ok_or("Invalid dest path (no filename)")?;
        std::fs::create_dir_all(parent).map_err(|e| format!("Create dir: {}", e))?;
        let p_canon = parent.canonicalize().map_err(|e| e.to_string())?;
        p_canon.join(fname)
    };
    if !dest_canon.starts_with(&allowed_canon) {
        return Err(format!(
            "Destination must be under global models dir: {}",
            allowed_canon.display()
        ));
    }
    Ok(dest_canon)
}

/// Download url to dest_path. dest_path must be under global models dir.
/// Uses curl.exe on Windows with resume if file exists; fallback PowerShell.
#[tauri::command]
pub async fn download_file(url: String, dest_path: String) -> Result<(), String> {
    let dest = validate_dest_under_global(&dest_path)?;
    let url_owned = url.trim().to_string();
    if url_owned.is_empty() {
        return Err("URL is empty".to_string());
    }
    let result = tokio::task::spawn_blocking(move || run_download(&url_owned, &dest)).await;
    match result {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => Err(e),
        Err(e) => Err(format!("Task join error: {}", e)),
    }
}

fn run_download(url: &str, dest: &Path) -> Result<(), String> {
    let parent = dest.parent().ok_or("No parent dir")?;
    std::fs::create_dir_all(parent).map_err(|e| format!("Create dir: {}", e))?;
    let dest_str = dest.to_string_lossy();
    let use_resume = dest.exists();

    #[cfg(windows)]
    {
        let curl = which_curl();
        if let Some(curl) = curl {
            let mut cmd = Command::new(&curl);
            cmd.arg("-L")
                .arg("--fail")
                .arg("--retry")
                .arg("3")
                .arg("--retry-delay")
                .arg("2")
                .arg("-o")
                .arg(dest.to_str().unwrap_or(&dest_str))
                .arg(url);
            if use_resume {
                cmd.arg("-C").arg("-");
            }
            let output = cmd.output().map_err(|e| format!("curl spawn: {}", e))?;
            if output.status.success() {
                return Ok(());
            }
            let stderr = String::from_utf8_lossy(&output.stderr);
            let tail = stderr.chars().rev().take(500).collect::<String>().chars().rev().collect::<String>();
            return Err(format!(
                "curl failed (code {:?}): {}",
                output.status.code(),
                tail.trim()
            ));
        }
        return run_download_powershell(url, dest);
    }

    #[cfg(not(windows))]
    {
        let curl = which_curl();
        if let Some(curl) = curl {
            let mut cmd = Command::new(&curl);
            cmd.arg("-L")
                .arg("--fail")
                .arg("--retry")
                .arg("3")
                .arg("--retry-delay")
                .arg("2")
                .arg("-o")
                .arg(dest.to_str().unwrap_or(&dest_str))
                .arg(url);
            if use_resume {
                cmd.arg("-C").arg("-");
            }
            let output = cmd.output().map_err(|e| format!("curl spawn: {}", e))?;
            if output.status.success() {
                return Ok(());
            }
            let stderr = String::from_utf8_lossy(&output.stderr);
            let tail = stderr.chars().rev().take(500).collect::<String>().chars().rev().collect::<String>();
            return Err(format!(
                "curl failed (code {:?}): {}",
                output.status.code(),
                tail.trim()
            ));
        }
        Err("curl not found; install curl or use another method".to_string())
    }
}

#[cfg(windows)]
fn run_download_powershell(url: &str, dest: &Path) -> Result<(), String> {
    let dest_esc = dest.to_string_lossy().replace('\\', "\\\\");
    let script = format!(
        "Invoke-WebRequest -Uri '{}' -OutFile '{}' -UseBasicParsing",
        url.replace('\'', "''"),
        dest_esc
    );
    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .output()
        .map_err(|e| format!("PowerShell spawn: {}", e))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let tail = stderr.chars().rev().take(500).collect::<String>().chars().rev().collect::<String>();
    Err(format!(
        "PowerShell download failed (code {:?}): {}",
        output.status.code(),
        tail.trim()
    ))
}

fn which_curl() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        Command::new("curl.exe")
            .arg("--version")
            .output()
            .ok()
            .and_then(|o| if o.status.success() { Some(PathBuf::from("curl.exe")) } else { None })
    }
    #[cfg(not(windows))]
    {
        Command::new("curl")
            .arg("--version")
            .output()
            .ok()
            .and_then(|o| if o.status.success() { Some(PathBuf::from("curl")) } else { None })
    }
}
