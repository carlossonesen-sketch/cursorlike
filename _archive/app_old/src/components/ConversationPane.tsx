import { useState, useRef, useEffect } from "react";
import { ProposalCard } from "./ProposalCard";
import { PrerequisitesPanel } from "./PrerequisitesPanel";
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
  hasLlamaAtToolRoot: boolean;
  runtimeHealthStatus: "ok" | "missing_runtime" | "missing_model" | null;
  providerFallbackMessage: string | null;
  downloadLog: string | null;
  downloadInProgress: boolean;
  onInitializeTools: () => Promise<void>;
  onOpenToolsFolder: () => Promise<void>;
  onDownloadRecommendedModel: () => Promise<void>;
  onRecheckRuntime: () => Promise<void>;
  onRetryLocalProvider: () => Promise<void>;
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
  multiFileProposal: import("../core").MultiFileProposal | null;
  includedFilePaths: Record<string, boolean>;
  onToggleIncludedFile: (path: string) => void;
  onApplyMultiFileSelected: () => void;
  onCancelMultiFileProposal: () => void;
  verificationResults: import("../core").VerificationResult | null;
  lastApplySnapshot: import("../App").ApplySnapshot | null;
  onRevertFromSnapshot: () => void;
  onAutoFixVerification: () => void;
  missingPrereqs: import("../core").MissingPrereqResult[];
  recommendedPrereqs: import("../core").RecommendedPrereqResult[];
  recommendedReasoning: Record<string, string>;
  installLog: string | null;
  installInProgress: boolean;
  includeRecommendations: boolean;
  onIncludeRecommendationsChange: (include: boolean) => void;
  onCopyPrereqCommand: (p: import("../core").Prereq) => void;
  onInstallPrereq: (prereqId: string) => void;
  onOpenPrereqLink: (p: import("../core").Prereq) => void;
  onInstallAllSafe: () => void;
  onInstallAllAdvanced: () => void;
  onRecheckPrereqs: () => void;
  devMode: import("../core/types").DevMode;
  onDevModeChange: (mode: import("../core/types").DevMode) => void;
  proposalStack: import("../App").ProposalEntry[];
  activeProposalId: string | null;
  activeProposalStatus: "proposed" | "pending" | "applied" | "reverted" | "discarded" | "superseded" | null;
  onReviewProposal: (id: string) => void;
  onDiscardProposal: (id: string) => void;
  lastFileChoiceCandidates: string[] | null;
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
  agentMode: _agentMode,
  onAgentModeChange: _onAgentModeChange,
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
  onProviderChange: _onProviderChange,
  toolRoot,
  hasLlamaAtToolRoot,
  runtimeHealthStatus,
  providerFallbackMessage,
  downloadLog,
  downloadInProgress,
  onInitializeTools,
  onOpenToolsFolder,
  onDownloadRecommendedModel,
  onRecheckRuntime,
  onRetryLocalProvider,
  localSettings,
  onLocalSettingsChange,
  onRescanModels,
  onPickGGUF,
  onSendChatMessage,
  onProposePatch: _onProposePatch,
  onRunPipeline: _onRunPipeline,
  onKeep,
  onRevert,
  onSaveLater,
  onViewDiff,
  showingDiff,
  pendingEdit,
  onApplyPendingEdit,
  onCancelPendingEdit,
  multiFileProposal,
  includedFilePaths,
  onToggleIncludedFile: _onToggleIncludedFile,
  onApplyMultiFileSelected,
  onCancelMultiFileProposal,
  verificationResults,
  lastApplySnapshot,
  onRevertFromSnapshot,
  onAutoFixVerification,
  missingPrereqs,
  recommendedPrereqs,
  recommendedReasoning,
  installLog,
  installInProgress,
  includeRecommendations,
  onIncludeRecommendationsChange,
  onCopyPrereqCommand,
  onInstallPrereq,
  onOpenPrereqLink,
  onInstallAllSafe,
  onInstallAllAdvanced,
  onRecheckPrereqs,
  devMode,
  onDevModeChange,
  proposalStack,
  activeProposalId,
  activeProposalStatus,
  onReviewProposal,
  onDiscardProposal,
  lastFileChoiceCandidates,
}: ConversationPaneProps) {
  const canApplyActive = activeProposalStatus === "pending";
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
      {proposalStack.length > 0 && (
        <div className="proposal-stack-panel">
          <strong>Proposal Stack</strong>
          <ul className="proposal-stack-list">
            {[...proposalStack].sort((a, b) => b.createdAt - a.createdAt).map((entry) => (
              <li
                key={entry.id}
                className={entry.id === activeProposalId ? "proposal-stack-item active" : "proposal-stack-item"}
              >
                <span className="proposal-stack-label">
                  {entry.type === "single" ? "Single" : "Multi"} — {entry.fileCount} file(s)
                </span>
                <span className={`proposal-stack-badge status-${entry.status}`}>{entry.status}</span>
                <div className="proposal-stack-actions">
                  <button type="button" className="btn small" onClick={() => onReviewProposal(entry.id)}>
                    Review
                  </button>
                  <button type="button" className="btn small" onClick={() => onDiscardProposal(entry.id)}>
                    Discard
                  </button>
                </div>
              </li>
            ))}
          </ul>
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
        {lastFileChoiceCandidates && lastFileChoiceCandidates.length > 0 && (
          <div className="message assistant file-choice-block">
            <strong>Pick a file</strong>
            <div className="file-choice-options">
              {lastFileChoiceCandidates.map((path, i) => (
                <button
                  key={path}
                  type="button"
                  className="btn file-choice-btn"
                  onClick={() => onSendChatMessage(String(i + 1))}
                >
                  {i + 1}. {path}
                </button>
              ))}
            </div>
          </div>
        )}
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
            <p className="muted">
              {pendingEdit.files.length} file(s). Review diff in panel, then Apply or Cancel.
            </p>
            {pendingEdit.summary && (
              <div className="change-summary">
                <span className="change-summary-badge">
                  Summary (grounded){pendingEdit.summary.confidence ? ` — Confidence: ${pendingEdit.summary.confidence.charAt(0).toUpperCase() + pendingEdit.summary.confidence.slice(1)}` : " in proposed changes"}
                </span>
                <strong className="change-summary-title">{pendingEdit.summary.title}</strong>
                <div className="change-summary-section">
                  <span className="change-summary-label">What changed:</span>
                  <ul>{pendingEdit.summary.whatChanged.map((b, i) => <li key={i}>{b}</li>)}</ul>
                </div>
                <div className="change-summary-section">
                  <span className="change-summary-label">Behavior after:</span>
                  <ul>{pendingEdit.summary.behaviorAfter.map((b, i) => <li key={i}>{b}</li>)}</ul>
                </div>
                <div className="change-summary-files">
                  {pendingEdit.summary.files.map((f, i) => (
                    <div key={i} className="change-summary-file"><code>{f.path}</code>: {f.change}</div>
                  ))}
                </div>
                {pendingEdit.summary.risks?.length ? (
                  <div className="change-summary-section">
                    <span className="change-summary-label">Risks:</span>
                    <ul>{pendingEdit.summary.risks.map((b, i) => <li key={i}>{b}</li>)}</ul>
                  </div>
                ) : null}
              </div>
            )}
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
        {multiFileProposal && (
          <div className="message assistant">
            <strong>Multi-file proposal</strong>
            <p className="muted">
              {multiFileProposal.files.length} file(s). Review in panel, select files to include, then Apply Selected.
            </p>
            {multiFileProposal.summary ? (
              <div className="change-summary">
                <span className="change-summary-badge">
                  Summary (grounded){multiFileProposal.summary.confidence ? ` — Confidence: ${multiFileProposal.summary.confidence.charAt(0).toUpperCase() + multiFileProposal.summary.confidence.slice(1)}` : " in proposed changes"}
                </span>
                <strong className="change-summary-title">{multiFileProposal.summary.title}</strong>
                <div className="change-summary-section">
                  <span className="change-summary-label">What changed:</span>
                  <ul>{multiFileProposal.summary.whatChanged.map((b, i) => <li key={i}>{b}</li>)}</ul>
                </div>
                <div className="change-summary-section">
                  <span className="change-summary-label">Behavior after:</span>
                  <ul>{multiFileProposal.summary.behaviorAfter.map((b, i) => <li key={i}>{b}</li>)}</ul>
                </div>
                <div className="change-summary-files">
                  {multiFileProposal.summary.files.map((f, i) => (
                    <div key={i} className="change-summary-file"><code>{f.path}</code>: {f.change}</div>
                  ))}
                </div>
                {multiFileProposal.summary.risks?.length ? (
                  <div className="change-summary-section">
                    <span className="change-summary-label">Risks:</span>
                    <ul>{multiFileProposal.summary.risks.map((b, i) => <li key={i}>{b}</li>)}</ul>
                  </div>
                ) : null}
              </div>
            ) : multiFileProposal.plan.length > 0 ? (
              <ul className="proposal-plan">
                {multiFileProposal.plan.map((bullet, i) => (
                  <li key={i}>{bullet}</li>
                ))}
              </ul>
            ) : null}
            <div className="plan-actions">
              <button
                type="button"
                className="btn primary"
                onClick={onApplyMultiFileSelected}
                disabled={!canApplyActive || multiFileProposal.files.filter((f) => includedFilePaths[f.path] !== false).length === 0}
              >
                Apply Selected
              </button>
              <button type="button" className="btn" onClick={onCancelMultiFileProposal} disabled={!canApplyActive}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {(missingPrereqs.length > 0 || recommendedPrereqs.length > 0) && (
          <PrerequisitesPanel
            missingPrereqs={missingPrereqs}
            recommendedPrereqs={recommendedPrereqs}
            recommendedReasoning={recommendedReasoning}
            installLog={installLog}
            installInProgress={installInProgress}
            includeRecommendations={includeRecommendations}
            onIncludeRecommendationsChange={onIncludeRecommendationsChange}
            onCopyCommand={onCopyPrereqCommand}
            onInstall={onInstallPrereq}
            onOpenLink={onOpenPrereqLink}
            onInstallAllSafe={onInstallAllSafe}
            onInstallAllAdvanced={onInstallAllAdvanced}
            onRecheck={onRecheckPrereqs}
          />
        )}
        {verificationResults && (
          <div className="message assistant verification-results">
            <strong>Verification results</strong>
            <div className="verification-stages">
              {verificationResults.stages.map((s, _i) => (
                <details key={s.name} className={s.passed ? "passed" : "failed"}>
                  <summary>
                    {s.passed ? "✓" : "✗"} {s.name} ({s.command})
                  </summary>
                  <pre className="verification-log">
                    {s.stdout || "(no stdout)"}
                    {s.stderr ? `\n--- stderr ---\n${s.stderr}` : ""}
                  </pre>
                </details>
              ))}
            </div>
            {!verificationResults.allPassed && lastApplySnapshot && (
              <div className="plan-actions">
                <button type="button" className="btn primary" onClick={onAutoFixVerification}>
                  Auto-fix (max 3 attempts)
                </button>
                <button type="button" className="btn" onClick={onRevertFromSnapshot}>
                  Revert last apply
                </button>
              </div>
            )}
          </div>
        )}
        {lastApplySnapshot && (!verificationResults || verificationResults.allPassed) && (
          <div className="message assistant">
            <strong>Last apply</strong>
            <p className="muted">
              {lastApplySnapshot.changes.length} file(s) were changed. You can revert to restore the previous state.
            </p>
            <div className="plan-actions">
              <button type="button" className="btn" onClick={onRevertFromSnapshot}>
                Revert last apply
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
          {providerFallbackMessage && (
            <div className="message assistant provider-fallback-msg">
              <p>{providerFallbackMessage}</p>
              <button type="button" className="btn primary" onClick={onRetryLocalProvider}>
                Retry local provider
              </button>
            </div>
          )}
          {(provider === "local" || providerFallbackMessage) && (
            <>
              {workspaceRoot && (runtimeHealthStatus === "missing_runtime" || runtimeHealthStatus === "missing_model" || (!toolRoot || !hasLlamaAtToolRoot) || (toolRoot && hasLlamaAtToolRoot && !localSettings.ggufPath?.trim())) && (
                <div className="local-error-msg runtime-health-banner">
                  <p>
                    {!toolRoot
                      ? "Could not find tools folder."
                      : runtimeHealthStatus === "missing_runtime"
                        ? "Place llama-server.exe under toolRoot/runtime/llama to use the local model."
                        : runtimeHealthStatus === "missing_model" || (hasLlamaAtToolRoot && !localSettings.ggufPath?.trim())
                          ? "No GGUF model found. Add a .gguf to toolRoot/models or download one below."
                          : "Place llama-server.exe under toolRoot/runtime/llama to use the local model."}
                  </p>
                  <div className="runtime-health-actions">
                    <button type="button" className="btn" onClick={onInitializeTools}>
                      Initialize Tools
                    </button>
                    <button type="button" className="btn" onClick={onOpenToolsFolder}>
                      Open tools folder
                    </button>
                    <button type="button" className="btn primary" onClick={onDownloadRecommendedModel} disabled={downloadInProgress}>
                      {downloadInProgress ? "Downloading…" : "Download recommended model (Qwen2.5 7B Q4_K_M)"}
                    </button>
                    <button type="button" className="btn" onClick={onRescanModels}>
                      Rescan models
                    </button>
                    <button type="button" className="btn" onClick={onRecheckRuntime}>
                      I already installed it
                    </button>
                  </div>
                  <p className="local-init-hint">
                    Tools folder: %LOCALAPPDATA%\DevAssistantCursorLite\tools. Add llama-server.exe to runtime\llama and a .gguf to models.
                  </p>
                  {downloadLog && (
                    <pre className="download-log">{downloadLog}</pre>
                  )}
                </div>
              )}
              {toolRoot && hasLlamaAtToolRoot && !localSettings.ggufPath?.trim() && runtimeHealthStatus !== "missing_runtime" && runtimeHealthStatus !== "missing_model" && (
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
                            onChange={(e) => onLocalSettingsChange({ ...localSettings, context_length: Number(e.target.value) || 32768 })} />
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
        <div className="dev-mode-toggle">
          <span className="dev-mode-label">Mode:</span>
          <div className="dev-mode-buttons" role="group" aria-label="Dev mode">
            <button
              type="button"
              className={devMode === "fast" ? "active" : ""}
              onClick={() => onDevModeChange("fast")}
              title="Apply without verification"
            >
              Fast Dev
            </button>
            <button
              type="button"
              className={devMode === "safe" ? "active" : ""}
              onClick={() => onDevModeChange("safe")}
              title="Verify automatically after Apply"
            >
              Safe Dev
            </button>
          </div>
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
          disabled={!workspaceRoot || (provider === "local" && (!toolRoot || !hasLlamaAtToolRoot || !localSettings.ggufPath?.trim()))}
          onClick={handleSendChat}
        >
          Send
        </button>
      </div>
    </div>
  );
}
