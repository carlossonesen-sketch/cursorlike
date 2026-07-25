import { invoke } from "@tauri-apps/api/core";
import type { ActionLogEntry } from "../types";

const ACTION_LOG_PATH = ".devassistant/action-log.jsonl";

export async function readActionLog(workspaceRoot: string): Promise<ActionLogEntry[]> {
  try {
    const raw = await invoke<string>("workspace_read_file", {
      workspaceRoot,
      path: ACTION_LOG_PATH,
    });
    return raw
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ActionLogEntry);
  } catch {
    return [];
  }
}

export async function appendActionLogEntry(workspaceRoot: string, entry: ActionLogEntry): Promise<void> {
  await invoke("workspace_mkdir_all", { workspaceRoot, path: ".devassistant" });
  const existing = await readActionLog(workspaceRoot);
  const next = [...existing, entry]
    .map((item) => JSON.stringify(item))
    .join("\n") + "\n";
  await invoke("workspace_write_file", {
    workspaceRoot,
    path: ACTION_LOG_PATH,
    content: next,
  });
}
