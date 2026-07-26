import { invoke } from "@tauri-apps/api/core";
import { createDeveloperSessionState, type DeveloperSessionState } from "./developerState";

export async function readDeveloperSession(workspaceRoot: string): Promise<DeveloperSessionState> {
  try {
    const value = await invoke<unknown>("developer_read_session", {
      workspacePath: workspaceRoot,
    });
    if (!value) return createDeveloperSessionState();
    const parsed = value as Omit<DeveloperSessionState, "schemaVersion"> & {
      schemaVersion?: number;
      selectedRangeContexts?: DeveloperSessionState["selectedRangeContexts"];
      editorDrafts?: DeveloperSessionState["editorDrafts"];
    };
    if (parsed?.schemaVersion === 1 || parsed?.schemaVersion === 2) {
      return {
        ...createDeveloperSessionState(),
        ...parsed,
        schemaVersion: 2,
        selectedRangeContexts: parsed.selectedRangeContexts ?? [],
        editorDrafts: parsed.editorDrafts ?? {},
      };
    }
    return createDeveloperSessionState();
  } catch {
    return createDeveloperSessionState();
  }
}

export async function writeDeveloperSession(
  workspaceRoot: string,
  state: DeveloperSessionState
): Promise<void> {
  await invoke("developer_write_session", {
    workspacePath: workspaceRoot,
    session: { ...state, updatedAt: new Date().toISOString() },
  });
}
