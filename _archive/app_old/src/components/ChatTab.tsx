import { useState } from "react";
import type { FileTreeNode } from "../core/types";

interface ChatTabProps {
  workspaceRoot: string | null;
  planAndPatch: { explanation: string; patch: string } | null;
  selectedPaths: string[];
  fileTree: FileTreeNode[];
  onSelectFiles: () => void;
  onProposePatch: (prompt: string) => void;
  onSelectPathsChange: (paths: string[]) => void;
}

export function ChatTab({
  workspaceRoot,
  planAndPatch,
  selectedPaths,
  fileTree,
  onSelectFiles,
  onProposePatch,
  onSelectPathsChange,
}: ChatTabProps) {
  const [prompt, setPrompt] = useState("");
  const [history] = useState<{ role: "user" | "assistant"; text: string }[]>([]);

  const toggleFile = (path: string) => {
    const next = selectedPaths.includes(path)
      ? selectedPaths.filter((p) => p !== path)
      : [...selectedPaths, path];
    onSelectPathsChange(next);
  };

  const walk = (nodes: FileTreeNode[], base = "") => {
    const out: React.ReactNode[] = [];
    for (const n of nodes) {
      const path = base ? `${base}/${n.name}` : n.name;
      if (n.isDir) {
        out.push(
          <div key={path} className="tree-folder">
            <span className="tree-label">📁 {n.name}</span>
            <div className="tree-children">{walk(n.children ?? [], path)}</div>
          </div>
        );
      } else {
        const sel = selectedPaths.includes(path);
        out.push(
          <label key={path} className="tree-file">
            <input
              type="checkbox"
              checked={sel}
              onChange={() => toggleFile(path)}
            />
            <span className="tree-label">📄 {n.name}</span>
          </label>
        );
      }
    }
    return out;
  };

  return (
    <div className="chat-tab">
      <div className="chat-history">
        {history.length === 0 && !planAndPatch && (
          <p className="muted">Open a workspace, select files, then describe your change and click Propose Patch.</p>
        )}
        {planAndPatch && (
          <div className="message assistant">
            <strong>Proposal</strong>
            <p>{planAndPatch.explanation}</p>
            <p className="muted">Switch to Changes to review diff and apply.</p>
          </div>
        )}
      </div>
      <div className="chat-input-row">
        <div className="file-tree-picker">
          <button type="button" className="btn secondary" onClick={onSelectFiles}>
            Select files
          </button>
          {fileTree.length > 0 && (
            <div className="tree-wrap">
              {walk(fileTree)}
            </div>
          )}
          {selectedPaths.length > 0 && (
            <p className="muted">Selected: {selectedPaths.join(", ")}</p>
          )}
        </div>
        <div className="prompt-row">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe your change in plain English…"
            rows={3}
            disabled={!workspaceRoot}
          />
          <button
            type="button"
            className="btn primary"
            disabled={!workspaceRoot}
            onClick={() => onProposePatch(prompt.trim() || "(no prompt)")}
          >
            Propose Patch
          </button>
        </div>
      </div>
    </div>
  );
}
