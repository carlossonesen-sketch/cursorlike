use crate::developer_agent::{
    apply_preview, patch_blocks, preview_patch, revert_snapshots, AgentFileSnapshot,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

pub struct DeveloperChangeStore {
    patches: Mutex<HashMap<String, StoredPatch>>,
}

impl Default for DeveloperChangeStore {
    fn default() -> Self {
        Self::load_from(&metadata_path())
    }
}

impl DeveloperChangeStore {
    fn load_from(path: &std::path::Path) -> Self {
        let mut patches = HashMap::new();
        if let Ok(bytes) = std::fs::read(path) {
            if let Ok(groups) = serde_json::from_slice::<Vec<PersistedPatch>>(&bytes) {
                for group in groups {
                    let mut records = group.records;
                    for record in &mut records {
                        if matches!(record.status.as_str(), "pendingApproval" | "proposed") {
                            record.status = "stale".into();
                            for hunk in &mut record.hunks { hunk.status = "stale".into(); }
                        }
                    }
                    patches.insert(group.patch_id.clone(), StoredPatch {
                        workspace: group.workspace, source: group.source, task_id: group.task_id,
                        patch_id: group.patch_id, patch: String::new(), records, snapshots: group.snapshots,
                    });
                }
            }
        }
        Self { patches: Mutex::new(patches) }
    }
}

pub(crate) fn record_agent_patch(
    store: &DeveloperChangeStore,
    workspace: &str,
    source: &str,
    task_id: &str,
    patch_id: &str,
    patch: &str,
    status: &str,
) -> Result<(), String> {
    let mut records = records_for(workspace, source, Some(task_id), patch_id, patch)?;
    for record in &mut records {
        record.status = status.into();
        for hunk in &mut record.hunks { hunk.status = status.into(); }
    }
    let mut patches = store.patches.lock().map_err(|_| "Change store is unavailable.")?;
    if let Some(existing) = patches.get_mut(patch_id) {
        for record in &mut existing.records {
            record.status = status.into();
            for hunk in &mut record.hunks { hunk.status = status.into(); }
            record.updated_at = Utc::now().to_rfc3339();
        }
    } else {
        patches.insert(patch_id.into(), StoredPatch {
            workspace: workspace.into(), source: source.into(), task_id: Some(task_id.into()),
            patch_id: patch_id.into(), patch: patch.into(), records, snapshots: Vec::new(),
        });
    }
    persist_metadata(&patches)?;
    Ok(())
}

pub(crate) fn mark_task_reverted(
    store: &DeveloperChangeStore, task_id: &str
) -> Result<(), String> {
    let mut patches = store.patches.lock().map_err(|_| "Change store is unavailable.")?;
    for patch in patches.values_mut().filter(|patch| patch.task_id.as_deref() == Some(task_id)) {
        for record in &mut patch.records {
            record.status = "reverted".into();
            for hunk in &mut record.hunks { hunk.status = "reverted".into(); }
            record.updated_at = Utc::now().to_rfc3339();
        }
    }
    persist_metadata(&patches)?;
    Ok(())
}

struct StoredPatch {
    workspace: String,
    source: String,
    task_id: Option<String>,
    patch_id: String,
    patch: String,
    records: Vec<DeveloperChangeRecord>,
    snapshots: Vec<AgentFileSnapshot>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeveloperChangeHunk {
    pub hunk_id: String,
    pub patch_id: String,
    pub file_path: String,
    pub original_range: String,
    pub replacement_range: String,
    pub preview: String,
    pub selected: bool,
    pub status: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeveloperChangeRecord {
    pub change_id: String,
    pub patch_id: String,
    pub task_id: Option<String>,
    pub source: String,
    pub workspace: String,
    pub file_path: String,
    pub operation: String,
    pub original_hash: String,
    pub current_hash: String,
    pub base_snapshot_reference: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub hunks: Vec<DeveloperChangeHunk>,
}

#[derive(Deserialize, Serialize)]
struct PersistedPatch {
    workspace: String,
    source: String,
    task_id: Option<String>,
    patch_id: String,
    records: Vec<DeveloperChangeRecord>,
    snapshots: Vec<AgentFileSnapshot>,
}

fn metadata_path() -> PathBuf {
    std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("NeverFinished").join("developer-changes.json")
}

fn persist_metadata(patches: &HashMap<String, StoredPatch>) -> Result<(), String> {
    let groups: Vec<_> = patches.values().map(|patch| PersistedPatch {
        workspace: patch.workspace.clone(), source: patch.source.clone(),
        task_id: patch.task_id.clone(), patch_id: patch.patch_id.clone(),
        records: patch.records.clone(),
        snapshots: patch.snapshots.clone(),
    }).collect();
    let path = metadata_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temporary = path.with_extension("tmp");
    std::fs::write(&temporary, serde_json::to_vec(&groups).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    if path.exists() { std::fs::remove_file(&path).map_err(|error| error.to_string())?; }
    std::fs::rename(temporary, path).map_err(|error| error.to_string())
}

fn stable_hash(value: &str) -> String {
    let mut hash = 1469598103934665603u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(1099511628211);
    }
    format!("{hash:016x}")
}

fn records_for(
    workspace: &str,
    source: &str,
    task_id: Option<&str>,
    patch_id: &str,
    patch: &str,
) -> Result<Vec<DeveloperChangeRecord>, String> {
    let files = preview_patch(workspace, patch, 100, 20_000)?;
    let now = Utc::now().to_rfc3339();
    Ok(files.into_iter().enumerate().map(|(file_index, file)| {
        let block = patch_blocks(patch).get(file_index).cloned().unwrap_or_default();
        let mut hunks = Vec::new();
        let lines: Vec<&str> = block.lines().collect();
        for (ordinal, index) in lines.iter().enumerate().filter_map(|(index, line)| line.starts_with("@@ ").then_some((index, index))) {
            let header = lines[index];
            let end = lines[index + 1..].iter().position(|line| line.starts_with("@@ ")).map(|offset| index + 1 + offset).unwrap_or(lines.len());
            let raw_preview = lines[index + 1..end].join("\n");
            let preview: String = raw_preview.chars().take(4_096).collect();
            let mut parts = header.split_whitespace();
            let old = parts.nth(1).unwrap_or("-0,0").into();
            let new = parts.next().unwrap_or("+0,0").into();
            hunks.push(DeveloperChangeHunk {
                hunk_id: format!("{patch_id}:{}:{}", file.path, ordinal),
                patch_id: patch_id.into(), file_path: file.path.clone(),
                original_range: old, replacement_range: new, preview,
                selected: true, status: "pending".into(),
            });
        }
        DeveloperChangeRecord {
            change_id: format!("{patch_id}:{}", file.path),
            patch_id: patch_id.into(), task_id: task_id.map(str::to_string),
            source: source.into(), workspace: workspace.into(), file_path: file.path.clone(),
            operation: if !file.existed { "create" } else if file.delete { "delete" } else { "modify" }.into(),
            original_hash: stable_hash(&file.old_content),
            current_hash: stable_hash(&file.new_content),
            base_snapshot_reference: format!("{patch_id}:snapshot:{file_index}"),
            status: "pendingApproval".into(), created_at: now.clone(), updated_at: now.clone(), hunks,
        }
    }).collect())
}

#[tauri::command]
pub fn developer_changes_propose(
    workspace_root: String,
    source: String,
    task_id: Option<String>,
    patch_id: String,
    patch: String,
    store: State<'_, DeveloperChangeStore>,
) -> Result<Vec<DeveloperChangeRecord>, String> {
    if !matches!(source.as_str(), "manual" | "agent" | "auto" | "external") {
        return Err("Unknown change source.".into());
    }
    let records = records_for(&workspace_root, &source, task_id.as_deref(), &patch_id, &patch)?;
    let mut patches = store.patches.lock().map_err(|_| "Change store is unavailable.")?;
    if let Some(existing) = patches.get(&patch_id) {
        return Ok(existing.records.clone());
    }
    patches.insert(patch_id.clone(), StoredPatch {
        workspace: workspace_root, source, task_id, patch_id, patch,
        records: records.clone(), snapshots: Vec::new(),
    });
    persist_metadata(&patches)?;
    Ok(records)
}

#[tauri::command]
pub fn developer_changes_apply(
    patch_id: String,
    approved: bool,
    selected_patch: Option<String>,
    store: State<'_, DeveloperChangeStore>,
) -> Result<Vec<DeveloperChangeRecord>, String> {
    if !approved { return Err("Change application requires explicit approval.".into()); }
    let mut patches = store.patches.lock().map_err(|_| "Change store is unavailable.")?;
    let stored = patches.get_mut(&patch_id).ok_or("Patch record was not found.")?;
    let patch = selected_patch.filter(|value| !value.trim().is_empty()).unwrap_or_else(|| stored.patch.clone());
    let preview = match preview_patch(&stored.workspace, &patch, 100, 20_000) {
        Ok(preview) => preview,
        Err(error) => {
            for record in &mut stored.records {
                record.status = "stale".into();
                for hunk in &mut record.hunks { hunk.status = "stale".into(); }
                record.updated_at = Utc::now().to_rfc3339();
            }
            persist_metadata(&patches)?;
            return Err(error);
        }
    };
    stored.snapshots = apply_preview(&stored.workspace, &preview)?;
    let applied: std::collections::HashSet<String> = preview.iter().map(|file| file.path.clone()).collect();
    let now = Utc::now().to_rfc3339();
    for record in &mut stored.records {
        if applied.contains(&record.file_path) {
            let mut applied_hunks = 0usize;
            for hunk in &mut record.hunks {
                let selected = patch.contains(&format!(
                    "@@ {} {} @@", hunk.original_range, hunk.replacement_range
                ));
                hunk.selected = selected;
                if selected {
                    hunk.status = "applied".into();
                    applied_hunks += 1;
                }
            }
            record.status = if applied_hunks == record.hunks.len() {
                "applied"
            } else {
                "partiallyApplied"
            }.into();
        } else {
            record.status = "partiallyApplied".into();
        }
        record.updated_at = now.clone();
    }
    let records = stored.records.clone();
    persist_metadata(&patches)?;
    Ok(records)
}

#[tauri::command]
pub fn developer_changes_reject(
    patch_id: String,
    store: State<'_, DeveloperChangeStore>,
) -> Result<Vec<DeveloperChangeRecord>, String> {
    let mut patches = store.patches.lock().map_err(|_| "Change store is unavailable.")?;
    let stored = patches.get_mut(&patch_id).ok_or("Patch record was not found.")?;
    for record in &mut stored.records {
        record.status = "rejected".into();
        for hunk in &mut record.hunks { hunk.status = "rejected".into(); }
        record.updated_at = Utc::now().to_rfc3339();
    }
    let records = stored.records.clone();
    persist_metadata(&patches)?;
    Ok(records)
}

#[tauri::command]
pub fn developer_changes_revert(
    patch_id: String,
    approved: bool,
    store: State<'_, DeveloperChangeStore>,
) -> Result<Vec<DeveloperChangeRecord>, String> {
    if !approved { return Err("Change revert requires explicit approval.".into()); }
    let mut patches = store.patches.lock().map_err(|_| "Change store is unavailable.")?;
    let stored = patches.get_mut(&patch_id).ok_or("Patch record was not found.")?;
    revert_snapshots(&stored.workspace, &stored.snapshots)?;
    for record in &mut stored.records {
        record.status = "reverted".into();
        for hunk in &mut record.hunks { hunk.status = "reverted".into(); }
        record.updated_at = Utc::now().to_rfc3339();
    }
    let records = stored.records.clone();
    persist_metadata(&patches)?;
    Ok(records)
}

#[tauri::command]
pub fn developer_changes_list(
    workspace_root: String,
    store: State<'_, DeveloperChangeStore>,
) -> Result<Vec<DeveloperChangeRecord>, String> {
    let patches = store.patches.lock().map_err(|_| "Change store is unavailable.")?;
    let mut records: Vec<_> = patches.values()
        .filter(|patch| patch.workspace == workspace_root)
        .flat_map(|patch| patch.records.clone()).collect();
    records.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.change_id.cmp(&b.change_id)));
    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static ID: AtomicUsize = AtomicUsize::new(0);

    fn workspace() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "nf-changes-{}-{}", std::process::id(), ID.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src/app.ts"), "export const value = 1;\n").unwrap();
        root
    }

    #[test]
    fn mixed_sources_share_records_without_duplicates_and_hide_snapshots() {
        let root = workspace().canonicalize().unwrap().to_string_lossy().into_owned();
        let patch = "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,1 +1,1 @@\n-export const value = 1;\n+export const value = 2;\n";
        let store = DeveloperChangeStore { patches: Mutex::new(HashMap::new()) };
        for (source, task, id) in [
            ("manual", "manual-task", "manual-patch"),
            ("agent", "agent-task", "agent-patch"),
            ("auto", "auto-task", "auto-patch"),
        ] {
            let records = records_for(&root, source, Some(task), id, patch).unwrap();
            store.patches.lock().unwrap().entry(id.into()).or_insert(StoredPatch {
                workspace: root.clone(), source: source.into(), task_id: Some(task.into()),
                patch_id: id.into(), patch: patch.into(), records, snapshots: Vec::new(),
            });
        }
        let patches = store.patches.lock().unwrap();
        assert_eq!(patches.len(), 3);
        let records: Vec<_> = patches.values().flat_map(|patch| patch.records.clone()).collect();
        assert_eq!(records.len(), 3);
        assert!(records.iter().all(|record| record.hunks.len() == 1));
        let serialized = serde_json::to_string(&records).unwrap();
        assert!(!serialized.to_ascii_lowercase().contains("api_key"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn restart_restores_metadata_and_marks_pending_patch_stale() {
        let root = workspace().canonicalize().unwrap().to_string_lossy().into_owned();
        let patch = "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,1 +1,1 @@\n-export const value = 1;\n+export const value = 2;\n";
        let mut pending = records_for(&root, "agent", Some("task"), "pending", patch).unwrap();
        pending[0].status = "pendingApproval".into();
        let mut applied = records_for(&root, "auto", Some("task"), "applied", patch).unwrap();
        applied[0].status = "applied".into();
        let groups = vec![
            PersistedPatch {
                workspace: root.clone(), source: "agent".into(), task_id: Some("task".into()),
                patch_id: "pending".into(), records: pending,
                snapshots: vec![AgentFileSnapshot { path: "src/app.ts".into(), content: "export const value = 1;\n".into(), existed: true }],
            },
            PersistedPatch {
                workspace: root.clone(), source: "auto".into(), task_id: Some("task".into()),
                patch_id: "applied".into(), records: applied, snapshots: Vec::new(),
            },
        ];
        let path = std::env::temp_dir().join(format!("nf-change-restart-{}.json", std::process::id()));
        std::fs::write(&path, serde_json::to_vec(&groups).unwrap()).unwrap();
        let restored = DeveloperChangeStore::load_from(&path);
        let patches = restored.patches.lock().unwrap();
        assert_eq!(patches["pending"].records[0].status, "stale");
        assert_eq!(patches["pending"].records[0].hunks[0].status, "stale");
        assert_eq!(patches["pending"].snapshots.len(), 1);
        assert_eq!(patches["applied"].records[0].status, "applied");
        let serialized = serde_json::to_string(&groups).unwrap();
        assert!(!serialized.to_ascii_lowercase().contains("api_key"));
        drop(patches);
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn external_change_makes_pending_patch_stale() {
        let root_path = workspace();
        let root = root_path.canonicalize().unwrap().to_string_lossy().into_owned();
        let patch = "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,1 +1,1 @@\n-export const value = 1;\n+export const value = 2;\n";
        let preview = preview_patch(&root, patch, 10, 100).unwrap();
        std::fs::write(root_path.join("src/app.ts"), "export const value = 99;\n").unwrap();
        assert!(apply_preview(&root, &preview).unwrap_err().contains("External change"));
        std::fs::remove_dir_all(root_path).unwrap();
    }
}
