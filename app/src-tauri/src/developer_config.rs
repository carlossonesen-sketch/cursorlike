use serde::{Deserialize, Serialize};
use crate::ai_credentials::{openai_credential_status, CredentialStatus};
use crate::openai_backend::safe_credential_source_message;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const FRICTION_LIMIT: usize = 200;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentWorkspace {
    pub canonical_path: String,
    pub repository_name: String,
    pub branch: String,
    pub dirty: bool,
    pub last_opened_at: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSettings {
    pub provider: String,
    pub openai_model: String,
    pub local_model_path: String,
}

impl Default for ProviderSettings {
    fn default() -> Self {
        Self {
            provider: "local".into(),
            openai_model: "gpt-5.4".into(),
            local_model_path: String::new(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDiagnostics {
    pub provider: String,
    pub state: String,
    pub model: String,
    pub configured: bool,
    pub credential_available: bool,
    pub local_model_available: bool,
    pub real: bool,
    pub message: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrictionEntry {
    pub id: String,
    pub timestamp: String,
    pub repository_canonical_path: String,
    pub repository_name: String,
    pub branch: String,
    pub area: String,
    pub description: String,
    pub severity: String,
    pub status: String,
    pub notes: Option<String>,
}

fn config_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("developer");
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join(name))
}

fn read_json<T: serde::de::DeserializeOwned>(path: &PathBuf) -> Result<T, String> {
    let text = std::fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&text).map_err(|error| error.to_string())
}

fn write_json<T: Serialize>(path: &PathBuf, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("tmp");
    std::fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    if path.exists() {
        std::fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    std::fs::rename(&temporary, path).map_err(|error| error.to_string())
}

fn friction_path(app: &AppHandle) -> Result<PathBuf, String> {
    config_path(app, "friction-log.json")
}

fn validate_friction(entry: &mut FrictionEntry) -> Result<(), String> {
    let canonical = std::fs::canonicalize(&entry.repository_canonical_path)
        .map_err(|error| format!("Friction repository path is unavailable: {error}"))?;
    if !canonical.is_dir() {
        return Err("Friction repository path must be a directory.".into());
    }
    entry.repository_canonical_path = canonical.to_string_lossy().into_owned();
    if entry.id.trim().is_empty() || entry.timestamp.trim().is_empty()
        || entry.repository_name.trim().is_empty() || entry.description.trim().is_empty()
        || entry.description.len() > 500 || entry.notes.as_deref().unwrap_or("").len() > 2_000
    {
        return Err("Friction entry has missing or oversized metadata.".into());
    }
    if !matches!(entry.area.as_str(), "Workspace" | "File browser" | "Editor" | "AI context"
        | "Provider" | "Patch review" | "Commands" | "Tests" | "Session persistence"
        | "Performance" | "Other")
        || !matches!(entry.severity.as_str(), "Minor" | "Moderate" | "Blocking")
        || !matches!(entry.status.as_str(), "Open" | "Resolved" | "Deferred")
    {
        return Err("Friction area, severity, or status is unsupported.".into());
    }
    Ok(())
}

#[tauri::command]
pub fn developer_list_friction(app: AppHandle) -> Result<Vec<FrictionEntry>, String> {
    let path = friction_path(&app)?;
    if !path.exists() { return Ok(Vec::new()); }
    read_json(&path)
}

#[tauri::command]
pub fn developer_save_friction(app: AppHandle, mut entry: FrictionEntry) -> Result<Vec<FrictionEntry>, String> {
    validate_friction(&mut entry)?;
    let path = friction_path(&app)?;
    let mut entries: Vec<FrictionEntry> = if path.exists() { read_json(&path).unwrap_or_default() } else { Vec::new() };
    entries.retain(|existing| existing.id != entry.id);
    entries.insert(0, entry);
    entries.truncate(FRICTION_LIMIT);
    write_json(&path, &entries)?;
    Ok(entries)
}

#[tauri::command]
pub fn developer_remove_friction(app: AppHandle, id: String) -> Result<Vec<FrictionEntry>, String> {
    let path = friction_path(&app)?;
    let mut entries: Vec<FrictionEntry> = if path.exists() { read_json(&path).unwrap_or_default() } else { Vec::new() };
    entries.retain(|entry| entry.id != id);
    write_json(&path, &entries)?;
    Ok(entries)
}

fn session_path(app: &AppHandle, workspace_path: &str) -> Result<PathBuf, String> {
    let canonical = std::fs::canonicalize(workspace_path).map_err(|error| error.to_string())?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    canonical.to_string_lossy().to_lowercase().hash(&mut hasher);
    config_path(app, &format!("session-{:016x}.json", hasher.finish()))
}

#[tauri::command]
pub fn developer_read_session(
    app: AppHandle,
    workspace_path: String,
) -> Result<Option<serde_json::Value>, String> {
    let path = session_path(&app, &workspace_path)?;
    if !path.exists() {
        return Ok(None);
    }
    read_json(&path).map(Some)
}

#[tauri::command]
pub fn developer_write_session(
    app: AppHandle,
    workspace_path: String,
    session: serde_json::Value,
) -> Result<(), String> {
    write_json(&session_path(&app, &workspace_path)?, &session)
}

#[tauri::command]
pub fn developer_recent_workspaces(app: AppHandle) -> Result<Vec<RecentWorkspace>, String> {
    let path = config_path(&app, "recent-workspaces.json")?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    read_json(&path)
}

#[tauri::command]
pub fn developer_record_recent_workspace(
    app: AppHandle,
    workspace: RecentWorkspace,
) -> Result<Vec<RecentWorkspace>, String> {
    let path = config_path(&app, "recent-workspaces.json")?;
    let mut values: Vec<RecentWorkspace> = if path.exists() {
        read_json(&path).unwrap_or_default()
    } else {
        Vec::new()
    };
    values.retain(|item| !item.canonical_path.eq_ignore_ascii_case(&workspace.canonical_path));
    values.insert(0, workspace);
    values.truncate(20);
    write_json(&path, &values)?;
    Ok(values)
}

#[tauri::command]
pub fn developer_remove_recent_workspace(
    app: AppHandle,
    canonical_path: String,
) -> Result<Vec<RecentWorkspace>, String> {
    let path = config_path(&app, "recent-workspaces.json")?;
    let mut values: Vec<RecentWorkspace> = if path.exists() {
        read_json(&path).unwrap_or_default()
    } else {
        Vec::new()
    };
    values.retain(|item| !item.canonical_path.eq_ignore_ascii_case(&canonical_path));
    write_json(&path, &values)?;
    Ok(values)
}

#[tauri::command]
pub fn developer_get_provider_settings(app: AppHandle) -> Result<ProviderSettings, String> {
    let path = config_path(&app, "provider-settings.json")?;
    if !path.exists() {
        return Ok(ProviderSettings::default());
    }
    read_json(&path)
}

#[tauri::command]
pub fn developer_set_provider_settings(
    app: AppHandle,
    settings: ProviderSettings,
) -> Result<(), String> {
    if !matches!(settings.provider.as_str(), "local" | "openai" | "mock") {
        return Err("Unsupported provider.".into());
    }
    write_json(&config_path(&app, "provider-settings.json")?, &settings)
}

#[tauri::command]
pub fn developer_provider_diagnostics(
    app: AppHandle,
) -> Result<ProviderDiagnostics, String> {
    let settings = developer_get_provider_settings(app)?;
    let credential_status = openai_credential_status();
    let credential_available = matches!(credential_status, CredentialStatus::Available(_));
    let local_model_available = !settings.local_model_path.trim().is_empty()
        && std::path::Path::new(&settings.local_model_path).is_file();
    let (state, configured, real, message) = match settings.provider.as_str() {
        "openai" => match credential_status {
            CredentialStatus::Available(source) => (
                "available",
                !settings.openai_model.trim().is_empty(),
                true,
                safe_credential_source_message(source),
            ),
            CredentialStatus::Unavailable => (
                "unavailable",
                false,
                false,
                "No shared backend credential is available.",
            ),
            CredentialStatus::AccessError => (
                "error",
                false,
                false,
                "Shared backend credential access failed.",
            ),
        },
        "local" => (
            if local_model_available { "available" } else { "unavailable" },
            local_model_available,
            local_model_available,
            if local_model_available {
                "Configured local model file is available."
            } else {
                "Configured local model file is unavailable."
            },
        ),
        _ => ("mock", true, false, "Mock provider is explicitly selected and cannot apply changes."),
    };
    Ok(ProviderDiagnostics {
        provider: settings.provider,
        state: state.into(),
        model: settings.openai_model,
        configured,
        credential_available,
        local_model_available,
        real,
        message: message.into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(root: &std::path::Path) -> FrictionEntry {
        FrictionEntry {
            id: "friction-1".into(),
            timestamp: "2026-07-25T00:00:00Z".into(),
            repository_canonical_path: root.to_string_lossy().into_owned(),
            repository_name: "sample".into(),
            branch: "main".into(),
            area: "Commands".into(),
            description: "Validation output was difficult to scan.".into(),
            severity: "Moderate".into(),
            status: "Open".into(),
            notes: Some("Metadata only.".into()),
        }
    }

    #[test]
    fn friction_metadata_is_bounded_and_enumerated() {
        let root = std::env::temp_dir();
        let mut valid = entry(&root);
        assert!(validate_friction(&mut valid).is_ok());
        let mut invalid = entry(&root);
        invalid.area = "Selected code".into();
        assert!(validate_friction(&mut invalid).is_err());
        let mut oversized = entry(&root);
        oversized.notes = Some("x".repeat(2_001));
        assert!(validate_friction(&mut oversized).is_err());
    }
}
