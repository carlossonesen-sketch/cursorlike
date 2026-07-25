import { invoke } from "@tauri-apps/api/core";
import { createDeveloperSessionState, type DeveloperSessionState } from "./developerState";

const DEVELOPER_SESSION_PATH = ".devassistant/developer-session.json";

export async function readDeveloperSession(workspaceRoot: string): Promise<DeveloperSessionState> {
  try {
    const raw = await invoke<string>("workspace_read_file", {
      workspaceRoot,
      path: DEVELOPER_SESSION_PATH,
    });
    const parsed = JSON.parse(raw) as DeveloperSessionState;
    return parsed?.schemaVersion === 1 ? parsed : createDeveloperSessionState();
  } catch {
    return createDeveloperSessionState();
  }
}

export async function writeDeveloperSession(
  workspaceRoot: string,
  state: DeveloperSessionState
): Promise<void> {
  await invoke("workspace_mkdir_all", { workspaceRoot, path: ".devassistant" });
  await invoke("workspace_write_file", {
    workspaceRoot,
    path: DEVELOPER_SESSION_PATH,
    content: JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2),
  });
}
