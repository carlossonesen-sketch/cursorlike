/**
 * MemoryStore: per-workspace .devassistant/sessions.json.
 */

import { invoke } from "@tauri-apps/api/core";
import type { SessionRecord } from "../types";
import type { FileSnapshot } from "../patch/PatchEngine";
import { pathsFromPatch } from "../patch/PatchEngine";

const SESSIONS_FILE = ".devassistant/sessions.json";

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(16);
}

export class MemoryStore {
  constructor(private workspaceRoot: string) {}

  private _ensureRoot(): string {
    if (this.workspaceRoot == null || this.workspaceRoot === "") {
      console.warn("[MemoryStore] workspace_read_file/write_file blocked: no workspace root.");
      throw new Error("Open a workspace first.");
    }
    return this.workspaceRoot;
  }

  private async readSessions(): Promise<SessionRecord[]> {
    try {
      const workspaceRoot = this._ensureRoot();
      const raw = await invoke<string>("workspace_read_file", {
        workspaceRoot,
        path: SESSIONS_FILE,
      });
      const data = JSON.parse(raw) as SessionRecord[];
      const list = Array.isArray(data) ? data : [];
      for (const r of list) {
        if (!r.status) (r as SessionRecord).status = "applied";
      }
      return list;
    } catch {
      return [];
    }
  }

  private async writeSessions(sessions: SessionRecord[]): Promise<void> {
    const workspaceRoot = this._ensureRoot();
    await invoke("workspace_write_file", {
      workspaceRoot,
      path: SESSIONS_FILE,
      content: JSON.stringify(sessions, null, 2),
    });
  }

  private async ensureDir(): Promise<void> {
    try {
      const workspaceRoot = this._ensureRoot();
      await invoke("workspace_mkdir_all", {
        workspaceRoot,
        path: ".devassistant",
      });
    } catch {
      /* already exists */
    }
  }

  /** Applied session: patch was applied; beforeSnapshots stored for revert. */
  async addSession(
    userPrompt: string,
    selectedContextFiles: string[],
    manifestHash: string | undefined,
    explanation: string,
    patch: string,
    beforeSnapshots: FileSnapshot[]
  ): Promise<SessionRecord> {
    await this.ensureDir();
    const sessions = await this.readSessions();
    const filesChanged = beforeSnapshots.map((s) => ({
      path: s.path,
      beforeHash: hash(s.content),
      afterHash: undefined as string | undefined,
    }));
    const id = `s${Date.now()}`;
    const now = new Date().toISOString();
    const record: SessionRecord = {
      id,
      timestamp: now,
      createdAt: now,
      status: "applied",
      userPrompt,
      selectedContextFiles,
      manifestHash,
      explanation,
      patch,
      filesChanged,
      beforeSnapshots: [...beforeSnapshots],
      checks: [],
    };
    sessions.push(record);
    await this.writeSessions(sessions);
    return record;
  }

  /** Proposed session: patch proposed, not yet saved or applied. */
  async addProposedSession(
    userPrompt: string,
    selectedContextFiles: string[],
    explanation: string,
    patch: string
  ): Promise<SessionRecord> {
    await this.ensureDir();
    const sessions = await this.readSessions();
    const paths = pathsFromPatch(patch);
    const filesChanged = paths.map((path) => ({
      path,
      beforeHash: undefined as string | undefined,
      afterHash: undefined as string | undefined,
    }));
    const id = `s${Date.now()}`;
    const now = new Date().toISOString();
    const record: SessionRecord = {
      id,
      timestamp: now,
      createdAt: now,
      status: "proposed",
      userPrompt,
      selectedContextFiles,
      explanation,
      patch,
      filesChanged,
      checks: [],
    };
    sessions.push(record);
    await this.writeSessions(sessions);
    return record;
  }

  /** Pending session: Save / Run later. No file writes (no patch apply). */
  async addPendingSession(
    userPrompt: string,
    selectedContextFiles: string[],
    manifestHash: string | undefined,
    explanation: string,
    patch: string
  ): Promise<SessionRecord> {
    await this.ensureDir();
    const sessions = await this.readSessions();
    const paths = pathsFromPatch(patch);
    const filesChanged = paths.map((path) => ({
      path,
      beforeHash: undefined as string | undefined,
      afterHash: undefined as string | undefined,
    }));
    const id = `s${Date.now()}`;
    const now = new Date().toISOString();
    const record: SessionRecord = {
      id,
      timestamp: now,
      createdAt: now,
      status: "pending",
      userPrompt,
      selectedContextFiles,
      manifestHash,
      explanation,
      patch,
      filesChanged,
      checks: [],
    };
    sessions.push(record);
    await this.writeSessions(sessions);
    return record;
  }

  async getLastSession(): Promise<SessionRecord | null> {
    const sessions = await this.readSessions();
    return sessions.length > 0 ? sessions[sessions.length - 1]! : null;
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    const sessions = await this.readSessions();
    return sessions.find((s) => s.id === id) ?? null;
  }

  /** Last 20 sessions (oldest-first). */
  async listSessions(): Promise<SessionRecord[]> {
    const all = await this.readSessions();
    return all.slice(-20);
  }

  async updateSessionStatus(id: string, status: SessionRecord["status"]): Promise<void> {
    const sessions = await this.readSessions();
    const i = sessions.findIndex((s) => s.id === id);
    if (i < 0) return;
    sessions[i] = { ...sessions[i]!, status };
    await this.writeSessions(sessions);
  }

  /** Mark a pending session as applied and store beforeSnapshots (timeline Apply). */
  async updateSessionToApplied(
    id: string,
    beforeSnapshots: FileSnapshot[]
  ): Promise<void> {
    const sessions = await this.readSessions();
    const i = sessions.findIndex((s) => s.id === id);
    if (i < 0) return;
    const r = sessions[i]!;
    const filesChanged = beforeSnapshots.map((s) => ({
      path: s.path,
      beforeHash: hash(s.content),
      afterHash: undefined as string | undefined,
    }));
    sessions[i] = {
      ...r,
      status: "applied",
      filesChanged,
      beforeSnapshots: [...beforeSnapshots],
    };
    await this.writeSessions(sessions);
  }
}
