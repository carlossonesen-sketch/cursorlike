import { useState, useRef, useEffect } from "react";
import { ProposalCard } from "./ProposalCard";
import { RuntimeStatusPanel } from "./RuntimeStatusPanel";
import type {
  PlanAndPatch,
  PlannerOutput,
  ReviewerOutput,
  AgentMode,
  ProjectSnapshot,
} from "../core/types";
import type { ResumeSuggestion } from "../core";
import type { Provider, LocalModelSettings } from "../core";

export type AppState = "idle" | "patchProposed" | "patchApplied";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
}

interface ConversationPaneProps {
  messages: Message[];
  planAndPatch: PlanAndPatch | null;
  plannerOutput: PlannerOutput | null;
  reviewerOutput: ReviewerOutput | null;
  changedFiles: string[];
  appState: AppState;
  applyInProgress: boolean;
  statusLine: string | null;
  workspaceRoot: string | null;
  resume: ResumeSuggestion | null;
  viewingSessionId: string | null;
  agentMode: AgentMode;
  onAgentModeChange: (mode: AgentMode) => void;
  useKnowledgePacks: boolean;
  onUseKnowledgePacksChange: (value: boolean) => void;
  lastRetrievedChunks: { title: string; sourcePath: string; chunkText: string }[];
  projectSnapshot: ProjectSnapshot | null;
  enabledPacks: string[];
  onEnabledPacksChange: (packs: string[]) => void;
  autoPacksEnabled: boolean;
  onAutoPacksEnabledChange: (value: boolean) => void;
  onRefreshSnapshot: () => void;
  provider: Provider;
  onProviderChange: (value: Provider) => void;
  toolRoot: string | null;
  localSettings: LocalModelSettings;
  onLocalSettingsChange: (value: LocalModelSettings) => void;
  onRescanModels: () => void;
  onPickGGUF: () => void;
  onSendChatMessage: (prompt: string) => void;
  onProposePatch: (prompt: string) => void;
  onRunPipeline: (prompt: string) => void;
  onKeep: () => void;
  onRevert: () => void;
  onSaveLater: () => void;
  onViewDiff: () => void;
  showingDiff: boolean;
  pendingEdit: import("../App").PendingEdit | null;
  onApplyPendingEdit: () => void;
  onCancelPendingEdit: () => void;
}

export function ConversationPane({
  messages,
  planAndPatch,
  plannerOutput,
  reviewerOutput,
  changedFiles,
  appState,
  applyInProgress,
  statusLine,
  workspaceRoot,
  resume,
  viewingSessionId,
  agentMode,
  onAgentModeChange,
  useKnowledgePacks,
  onUseKnowledgePacksChange,
  lastRetrievedChunks,
  projectSnapshot,
  enabledPacks,
  onEnabledPacksChange,
  autoPacksEnabled,
  onAutoPacksEnabledChange,
  onRefreshSnapshot,
  provider,
  onProviderChange,
  toolRoot,
  localSettings,
  onLocalSettingsChange,
  onRescanModels,
  onPickGGUF,
  onSendChatMessage,
  onProposePatch,
  onRunPipeline,
  onKeep,
  onRevert,
  onSaveLater,
  onViewDiff,
  showingDiff,
  pendingEdit,
  onApplyPendingEdit,
  onCancelPendingEdit,
}: ConversationPaneProps) {
  const [prompt, setPrompt] = useState("");
  const [knowledgeExpanded, setKnowledgeExpanded] = useState(false);
  const [expandedChunkIndices, setExpandedChunkIndices] = useState<Set<number>>(new Set());
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const CHUNK_PREVIEW_LEN = 300;

  const toggleChunkPreview = (i: number) => {
    setExpandedChunkIndices((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const handleSendChat = () => {
    const t = prompt.trim() || "(no prompt)";
    if (!t || !workspaceRoot) return;
    onSendChatMessage(t);
    setPrompt("");
  };

  const handlePropose = () => {
    const t = prompt.trim() || "(no prompt)";
    if (!t || !workspaceRoot) return;
    onProposePatch(t);
    setPrompt("");
  };

  const handlePipeline = () => {
    const t = prompt.trim() || "(no prompt)";
    if (!t || !workspaceRoot) return;
    onRunPipeline(t);
    setPrompt("");
  };

  const handleAutoPacksChange = (checked: boolean) => {
    onAutoPacksEnabledChange(checked);
    if (checked && projectSnapshot) {
      onEnabledPacksChange(projectSnapshot.recommendedPacks);
    }
  };

  const togglePack = (pack: string) => {
    const next = enabledPacks.includes(pack)
      ? enabledPacks.filter((p) => p !== pack)
      : [...enabledPacks, pack];
    onEnabledPacksChange(next);
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, planAndPatch, plannerOutput, reviewerOutput, pendingEdit]);

  useEffect(() => {
    setExpandedChunkIndices(new Set());
  }, [lastRetrievedChunks]);

  return (
    <div className="conversation-pane">
      {provider === "local" && (
        <div className="runtime-status-wrap">
          <RuntimeStatusPanel workspaceRoot={workspaceRoot} />
        </div>
      )}
      <div className="conversation-stream" ref={scrollRef}>
        {resume && messages.length === 0 && !planAndPatch && (
          <div className="resume-block message assistant">
            <strong>Where we left off</strong>
            <p>Last time you did: {resume.lastDid}</p>
            <p className="muted">Next suggested step: {resume.nextStep}</p>
          </div>
        )}
        {messages.length === 0 && !planAndPatch && !resume && (
          <p className="muted placeholder">
            {workspaceRoot
              ? "Describe what you want or mention a file (e.g. README, src/App.tsx)."
              : "Open a workspace first."}
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`message ${m.role}`}>
            <strong>{m.role === "user" ? "You" : "Assistant"}</strong>
            <p>{m.text}</p>
          </div>
        ))}
        {plannerOutput && (
          <div className="message assistant pipeline-block">
            <strong>Planner</strong>
            <p>{plannerOutput.plan}</p>
            <p className="muted">Target files: {plannerOutput.targetFiles.join(", ") || "(none)"}</p>
          </div>
        )}
        {planAndPatch && plannerOutput && (
          <div className="message assistant pipeline-block">
            <strong>Coder</strong>
            <p>{planAndPatch.explanation}</p>
          </div>
        )}
        {reviewerOutput && (
          <div className="message assistant pipeline-block">
            <strong>Reviewer</strong>
            <p>{reviewerOutput.reviewNotes}</p>
            <p className="muted">Recommended checks: {reviewerOutput.recommendedChecks.join(", ")}</p>
          </div>
        )}
        {pendingEdit && (
          <div className="message assistant">
            <strong>Edit plan</strong>
            <pre className="plan-text">{pendingEdit.planText}</pre>
            <div className="plan-actions">
              <button type="button" className="btn primary" onClick={onApplyPendingEdit}>
                Apply
              </button>
              <button type="button" className="btn" onClick={onCancelPendingEdit}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {planAndPatch && (
          <div className="message assistant">
            <strong>{viewingSessionId ? "Viewing session" : "Proposal"}</strong>
            <ProposalCard
              plan={planAndPatch}
              changedFiles={changedFiles}
              appState={appState}
              applyInProgress={applyInProgress}
              viewingSessionId={viewingSessionId}
              onKeep={onKeep}
              onRevert={onRevert}
              onSaveLater={onSaveLater}
              onViewDiff={onViewDiff}
              showingDiff={showingDiff}
            />
          </div>
        )}
      </div>
      {statusLine && (
        <div className="status-line" role="status">
          {statusLine}
        </div>
      )}
      {lastRetrievedChunks.length > 0 && (
        <div className="retrieved-knowledge">
          <button
            type="button"
            className="retrieved-knowledge-header"
            onClick={() => setKnowledgeExpanded((e) => !e)}
            aria-expanded={knowledgeExpanded}
          >
            Retrieved Knowledge ({lastRetrievedChunks.length})
          </button>
          {knowledgeExpanded && (
            <ul className="retrieved-knowledge-list">
              {lastRetrievedChunks.map((c, i) => {
                const isExpanded = expandedChunkIndices.has(i);
                const preview =
                  c.chunkText.length <= CHUNK_PREVIEW_LEN
                    ? c.chunkText
                    : c.chunkText.slice(0, CHUNK_PREVIEW_LEN) + "…";
                return (
                  <li key={`${c.sourcePath}-${i}`} className="retrieved-chunk-item">
                    <span className="retrieved-title">{c.title}</span>
                    <span className="retrieved-path muted">{c.sourcePath}</span>
                    <button
                      type="button"
                      className="chunk-preview-toggle"
                      onClick={() => toggleChunkPreview(i)}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? "Hide preview" : "Show preview"}
                    </button>
                    {isExpanded && (
                      <pre className="chunk-preview-text">{preview}</pre>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      <div className="conversation-input">
        <div className="model-settings">
          {provider === "local" && (
            <>
              {!toolRoot && workspaceRoot && (
                <p className="local-error-msg">
                  Could not find runtime/llama/llama-server.exe. Expected under toolRoot/runtime/llama.
                </p>
              )}
              {toolRoot && !localSettings.ggufPath?.trim() && (
                <p className="local-no-gguf-msg">
                  Drop a .gguf into <code>{toolRoot.replace(/\\/g, "/").replace(/\/+$/, "")}/models</code>
                </p>
              )}
            </>
          )}
        </div>
        <div className="advanced-section">
          <button
            type="button"
            className="btn-link advanced-toggle"
            onClick={() => setAdvancedExpanded((v) => !v)}
            aria-expanded={advancedExpanded}
          >
            {advancedExpanded ? "Hide Advanced" : "Advanced ▸"}
          </button>
          {advancedExpanded && workspaceRoot && (
            <div className="advanced-content">
              {toolRoot != null && (
                <div className="project-snapshot-row">
                  <span className="project-snapshot-label">toolRoot:</span>
                  <span className="project-snapshot-value" title={toolRoot}>{toolRoot}</span>
                </div>
              )}
              <div className="project-snapshot-row">
                <span className="project-snapshot-label">Provider (internal):</span>
                <span className="project-snapshot-value">{provider}</span>
              </div>
              {provider === "local" && (
                <div className="local-advanced-block local-settings">
                  {localSettings.ggufPath?.trim() ? (
                    <>
                      <div className="project-snapshot-row">
                        <span className="project-snapshot-label">Model:</span>
                        <span className="project-snapshot-value" title={localSettings.ggufPath}>
                          {localSettings.ggufPath.replace(/^.*[/\\]/, "")} — {localSettings.ggufPath}
                        </span>
                      </div>
                      <div className="project-snapshot-actions">
                        <button type="button" className="btn secondary" onClick={onRescanModels}>
                          Rescan models
                        </button>
                        <button type="button" className="btn secondary" onClick={onPickGGUF}>
                          Override model…
                        </button>
                      </div>
                      <div className="local-params">
                        <label title="Temperature"><span>Temp</span>
                          <input type="number" min={0} max={2} step={0.1} value={localSettings.temperature}
                            onChange={(e) => onLocalSettingsChange({ ...localSettings, temperature: Number(e.target.value) || 0.7 })} />
                        </label>
                        <label title="Top P"><span>Top P</span>
                          <input type="number" min={0} max={1} step={0.05} value={localSettings.top_p}
                            onChange={(e) => onLocalSettingsChange({ ...localSettings, top_p: Number(e.target.value) || 0.9 })} />
                        </label>
                        <label title="Max tokens"><span>Max</span>
                          <input type="number" min={256} max={8192} step={256} value={localSettings.max_tokens}
                            onChange={(e) => onLocalSettingsChange({ ...localSettings, max_tokens: Number(e.target.value) || 2048 })} />
                        </label>
                        <label title="Context length"><span>Ctx</span>
                          <input type="number" min={512} max={32768} step={512} value={localSettings.context_length}
                            onChange={(e) => onLocalSettingsChange({ ...localSettings, context_length: Number(e.target.value) || 4096 })} />
                        </label>
                      </div>
                    </>
                  ) : (
                    <div className="project-snapshot-actions">
                      <button type="button" className="btn secondary" onClick={onRescanModels}>
                        Rescan models
                      </button>
                      <button type="button" className="btn secondary" onClick={onPickGGUF}>
                        Browse .gguf…
                      </button>
                    </div>
                  )}
                </div>
              )}
              <div className="project-snapshot-block">
                <div className="project-snapshot-row">
                  <span className="project-snapshot-label">Project:</span>
                  <span className="project-snapshot-value">
                    {projectSnapshot?.detectedTypes?.length ? projectSnapshot.detectedTypes.join(", ") : "(none)"}
                  </span>
                </div>
                <div className="project-snapshot-row">
                  <span className="project-snapshot-label">Packs enabled:</span>
                  <span className="project-snapshot-value">{enabledPacks.length ? enabledPacks.join(", ") : "(none)"}</span>
                </div>
                {projectSnapshot?.recommendedPacks?.length ? (
                  <div className="project-snapshot-packs">
                    {projectSnapshot.recommendedPacks.map((pack) => (
                      <label key={pack} className="pack-toggle">
                        <input type="checkbox" checked={enabledPacks.includes(pack)} onChange={() => togglePack(pack)} />
                        {pack}
                      </label>
                    ))}
                  </div>
                ) : null}
                {(projectSnapshot?.detectedCommands?.build || projectSnapshot?.detectedCommands?.test ||
                  projectSnapshot?.detectedCommands?.lint || projectSnapshot?.detectedCommands?.dev) && (
                  <div className="project-snapshot-row project-snapshot-commands">
                    <span className="project-snapshot-label">Commands:</span>
                    <span className="project-snapshot-value">
                      {[projectSnapshot?.detectedCommands?.build && `build=${projectSnapshot.detectedCommands.build}`,
                        projectSnapshot?.detectedCommands?.test && `test=${projectSnapshot.detectedCommands.test}`,
                        projectSnapshot?.detectedCommands?.lint && `lint=${projectSnapshot.detectedCommands.lint}`,
                        projectSnapshot?.detectedCommands?.dev && `dev=${projectSnapshot.detectedCommands.dev}`]
                        .filter(Boolean).join("; ")}
                    </span>
                  </div>
                )}
                <div className="project-snapshot-actions">
                  <label className="auto-packs-toggle">
                    <input type="checkbox" checked={autoPacksEnabled} onChange={(e) => handleAutoPacksChange(e.target.checked)} />
                    Auto-enable packs
                  </label>
                  <button type="button" className="btn secondary btn-refresh" onClick={onRefreshSnapshot} title="Re-run detector and rebuild snapshot">
                    Refresh
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        <label className="knowledge-toggle">
          <input
            type="checkbox"
            checked={useKnowledgePacks}
            onChange={(e) => onUseKnowledgePacksChange(e.target.checked)}
          />
          Use Knowledge Packs
        </label>
        <div className="input-row">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendChat();
              }
            }}
            placeholder="Describe what you want or mention a file…"
            rows={2}
            disabled={!workspaceRoot}
          />
        </div>
        <button
          type="button"
          className="btn primary"
          disabled={!workspaceRoot || (provider === "local" && (!toolRoot || !localSettings.ggufPath?.trim()))}
          onClick={handleSendChat}
        >
          Send
        </button>
      </div>
    </div>
  );
}
