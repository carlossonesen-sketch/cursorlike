import { useState, useRef, useEffect } from "react";
import { ProposalCard } from "./ProposalCard";
import { ModelsPanel } from "./ModelsPanel";
import { DiscoveryIntakeCard } from "./DiscoveryIntakeCard";
import { AppErrorBoundary } from "./AppErrorBoundary";
import type {
  DiscoveryIntake,
  PlanAndPatch,
  FounderManifest,
  LivingBuildPlan,
  ExistingProjectImportEvaluation,
  BuildProgressApplySummary,
  NewProjectFilePreview,
  NewProjectPlanPreview,
  PlannerOutput,
  ProjectBlueprint,
  ProjectMemory,
  ReviewerOutput,
  AgentMode,
  ProjectSnapshot,
} from "../core/types";
import type { ProjectCreationState } from "../core/projectCreation/projectCreationState";
import { buildFounderCreationSummary, currentCreationNarration } from "../core/projectCreation/projectCreationNarration";
import { projectNameRequestMessage } from "../core/projectCreation/projectIdentity";
import type { PhaseExecutionNarration } from "../core/phase/phaseExecutionController";
import type { ChangeApprovalPresentation } from "../core/phase/changeApprovalController";
import type { PhaseGatePresentation } from "../core/phase/phaseGateController";
import type { ResumeSuggestion } from "../core";
import type { Provider, LocalModelSettings, ModelRolePaths } from "../core";
import { getResolvedToolRoot, getGlobalModelsDir } from "../core";

export type AppState = "idle" | "patchProposed" | "patchApplied";
const STALE_PLANNING_STEP = /\b(review and approve|preview the initial files|before anything is written|generate .*build plan|approve this plan)\b/i;
const NEW_PROJECT_IDEA_DISPLAY_LIMIT = 1200;
const CHAT_MESSAGE_DISPLAY_LIMIT = 4000;

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
  developerMode?: boolean;
  changedFiles: string[];
  appState: AppState;
  applyInProgress: boolean;
  statusLine: string | null;
  workspaceRoot: string | null;
  projectMemory: ProjectMemory | null;
  livingBuildPlan: LivingBuildPlan | null;
  founderManifest: FounderManifest | null;
  projectCreationState: ProjectCreationState | null;
  creationBlueprint: ProjectBlueprint | null;
  discoveryIntake: DiscoveryIntake | null;
  newProjectPlanPreview: NewProjectPlanPreview | null;
  newProjectFilePreview: NewProjectFilePreview | null;
  importEvaluation: ExistingProjectImportEvaluation | null;
  buildProgressSummary: BuildProgressApplySummary | null;
  canStartFoundationPhase: boolean;
  phaseExecutionNarration: PhaseExecutionNarration | null;
  phaseExecutionRunning: boolean;
  changeApprovalPresentation: ChangeApprovalPresentation | null;
  phaseGatePresentation: PhaseGatePresentation | null;
  onStartFoundationPhase: () => void;
  onApprovePendingChange: () => void;
  onRejectPendingChange: () => void;
  onExplainPendingChange: () => void;
  onApprovePhaseAndContinue: (overrideBlockers?: boolean) => void;
  onHoldPhase: () => void;
  onRevisePhasePlan: () => void;
  onGenerateNewProjectPlan: () => void;
  onContinueDiscoveryIntake: () => void;
  onApplyProjectName: (projectName: string) => void;
  onApproveNewProjectPlan: () => void;
  onReviseNewProjectPlan: () => void;
  onCancelNewProjectPlan: () => void;
  onBackToNewProjectPlan: () => void;
  onCreateNewProjectFiles: () => void;
  onApproveImportEvaluation: () => void;
  onAnswerImportQuestions: () => void;
  onCancelImportEvaluation: () => void;
  onContinueBuildProgress: () => void;
  onPauseBuildProgress: () => void;
  onViewBuildPlan: () => void;
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
  modelRoles?: ModelRolePaths;
  onModelRolesChange?: (roles: ModelRolePaths) => void;
  onSendChatMessage: (prompt: string, messageId?: string) => void;
  onProposePatch: (prompt: string) => void;
  onRunPipeline: (prompt: string) => void;
  onKeep: () => void;
  onRevert: () => void;
  onSaveLater: () => void;
  onViewDiff: () => void;
  showingDiff: boolean;
}

function displayLongText(value: string, maxLength = NEW_PROJECT_IDEA_DISPLAY_LIMIT): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trim()}... (${normalized.length - maxLength} more characters hidden in the UI; full text is preserved for planning.)`;
}

export function ConversationPane({
  messages,
  planAndPatch,
  plannerOutput,
  reviewerOutput,
  developerMode = false,
  changedFiles,
  appState,
  applyInProgress,
  statusLine,
  workspaceRoot,
  projectMemory,
  livingBuildPlan,
  founderManifest,
  projectCreationState,
  creationBlueprint,
  discoveryIntake,
  newProjectPlanPreview,
  newProjectFilePreview,
  importEvaluation,
  buildProgressSummary,
  canStartFoundationPhase,
  phaseExecutionNarration,
  phaseExecutionRunning,
  changeApprovalPresentation,
  phaseGatePresentation,
  onStartFoundationPhase,
  onApprovePendingChange,
  onRejectPendingChange,
  onExplainPendingChange,
  onApprovePhaseAndContinue,
  onHoldPhase,
  onRevisePhasePlan,
  onGenerateNewProjectPlan,
  onContinueDiscoveryIntake,
  onApplyProjectName,
  onApproveNewProjectPlan,
  onReviseNewProjectPlan,
  onCancelNewProjectPlan,
  onBackToNewProjectPlan,
  onCreateNewProjectFiles,
  onApproveImportEvaluation,
  onAnswerImportQuestions,
  onCancelImportEvaluation,
  onContinueBuildProgress,
  onPauseBuildProgress,
  onViewBuildPlan,
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
  localSettings,
  onLocalSettingsChange,
  onRescanModels,
  onPickGGUF,
  modelRoles,
  onModelRolesChange,
  onSendChatMessage,
  onProposePatch: _onProposePatch,
  onRunPipeline: _onRunPipeline,
  onKeep,
  onRevert,
  onSaveLater,
  onViewDiff,
  showingDiff,
}: ConversationPaneProps) {
  const [prompt, setPrompt] = useState("");
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [knowledgeExpanded, setKnowledgeExpanded] = useState(false);
  const [expandedChunkIndices, setExpandedChunkIndices] = useState<Set<number>>(new Set());
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const [runtimeToolRootError, setRuntimeToolRootError] = useState<string | null>(null);
  const [expectedExePath, setExpectedExePath] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (provider !== "local" || !workspaceRoot) {
      setRuntimeToolRootError(null);
      return;
    }
    getResolvedToolRoot(toolRoot ?? null)
      .then(() => setRuntimeToolRootError(null))
      .catch((e) => setRuntimeToolRootError(String(e)));
    getGlobalModelsDir()
      .then((dir) => setExpectedExePath(dir.replace(/\/models\/?$/, "") + "/runtime/llama/llama-server.exe"))
      .catch(() => setExpectedExePath(null));
  }, [provider, workspaceRoot, toolRoot]);

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
    if (!t) return;
    const messageId = `u-${Date.now()}`;
    onSendChatMessage(t, messageId);
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
  }, [messages, planAndPatch, plannerOutput, reviewerOutput]);

  useEffect(() => {
    setExpandedChunkIndices(new Set());
  }, [lastRetrievedChunks]);

  const workspaceName = workspaceRoot?.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "Project";
  const projectName = projectMemory?.name?.trim() || founderManifest?.projectId?.trim() || workspaceName;
  const activeMilestone = livingBuildPlan?.milestones.find((milestone) => milestone.id === livingBuildPlan.currentMilestoneId);
  const activeTask = activeMilestone?.tasks.find((task) => task.id === livingBuildPlan?.currentTaskId);
  const currentMilestone = activeMilestone?.name || livingBuildPlan?.currentMilestoneId || "";
  const rawNextRecommendedStep = livingBuildPlan?.nextRecommendedStep?.trim() || projectMemory?.resumeState.resumePrompt?.trim() || "";
  const nextRecommendedStep = rawNextRecommendedStep && !STALE_PLANNING_STEP.test(rawNextRecommendedStep)
    ? rawNextRecommendedStep
    : activeTask?.title || (projectMemory?.generatedFiles?.length ? "Run build check or continue the first working interaction." : "");
  const detectedStack = projectMemory?.techStack?.length ? projectMemory.techStack.join(", ") : "";
  const formatCommands = (commands: { dev?: string; build?: string; test?: string; lint?: string }) =>
    [commands.dev && `dev: ${commands.dev}`,
      commands.build && `build: ${commands.build}`,
      commands.test && `test: ${commands.test}`,
      commands.lint && `lint: ${commands.lint}`]
      .filter(Boolean)
      .join("; ");

  return (
    <div className="conversation-pane">
      <div className="conversation-stream" ref={scrollRef}>
        {workspaceRoot && (
          <div className="project-resume-card">
            <div className="project-resume-card-header">
              <strong>{projectName}</strong>
              <span title={workspaceRoot}>{workspaceRoot}</span>
            </div>
            {(currentMilestone || nextRecommendedStep) && (
              <div className="project-resume-card-body">
                {detectedStack && (
                  <p><span>Stack</span>{detectedStack}</p>
                )}
                {currentMilestone && (
                  <p><span>Milestone</span>{currentMilestone}</p>
                )}
                {nextRecommendedStep && (
                  <p><span>Next</span>{nextRecommendedStep}</p>
                )}
              </div>
            )}
            {canStartFoundationPhase && (
              <div className="new-project-card-actions">
                <button
                  type="button"
                  className="btn primary"
                  onClick={onStartFoundationPhase}
                  disabled={phaseExecutionRunning}
                >
                  {phaseExecutionRunning ? "Building..." : "Start Foundation Phase"}
                </button>
              </div>
            )}
            {phaseExecutionNarration && (
              <div className="project-resume-card-body">
                <p><span>Build status</span>{phaseExecutionNarration.founderSummary}</p>
                {developerMode && phaseExecutionNarration.developerDetails.map((detail) => (
                  <p key={detail}><span>Detail</span>{detail}</p>
                ))}
              </div>
            )}
            {changeApprovalPresentation?.isPending && (
              <div className="project-resume-card-body change-approval-card">
                <p><span>File change</span>{changeApprovalPresentation.headline}</p>
                <p><span>What will change</span>{changeApprovalPresentation.whatWillChange}</p>
                <p><span>Task</span>{changeApprovalPresentation.taskTitle}</p>
                {developerMode && changeApprovalPresentation.developerDetails.map((detail) => (
                  <p key={detail}><span>Detail</span>{detail}</p>
                ))}
                <div className="new-project-card-actions">
                  <button
                    type="button"
                    className="btn primary"
                    onClick={onApprovePendingChange}
                    disabled={phaseExecutionRunning}
                  >
                    {phaseExecutionRunning ? "Applying..." : "Approve Change"}
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={onRejectPendingChange}
                    disabled={phaseExecutionRunning}
                  >
                    Reject Change
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={onExplainPendingChange}
                    disabled={phaseExecutionRunning}
                  >
                    Explain Change
                  </button>
                </div>
              </div>
            )}
            {phaseGatePresentation?.isPending && !changeApprovalPresentation?.isPending && (
              <div className="project-resume-card-body phase-gate-card">
                <p><span>Phase gate</span>{phaseGatePresentation.currentPhaseName} ({phaseGatePresentation.status})</p>
                <p><span>Completed</span>{phaseGatePresentation.completed.join(", ")}</p>
                {phaseGatePresentation.checks.length > 0 && (
                  <p><span>Checks</span>{phaseGatePresentation.checks.join("; ")}</p>
                )}
                {phaseGatePresentation.qualityGates.length > 0 && (
                  <p><span>Quality gates</span>{phaseGatePresentation.qualityGates.map((gate) => `${gate.title}: ${gate.status}`).join("; ")}</p>
                )}
                {phaseGatePresentation.blockers.length > 0 ? (
                  <p><span>Blockers</span>{phaseGatePresentation.blockers.join("; ")}</p>
                ) : (
                  <p><span>Blockers</span>None</p>
                )}
                {phaseGatePresentation.nextPhaseName && (
                  <p><span>Next phase</span>{phaseGatePresentation.nextPhaseName}</p>
                )}
                <p><span>Decision</span>{phaseGatePresentation.decisionPrompt}</p>
                <p><span>Next action</span>{phaseGatePresentation.recommendedNextAction}</p>
                {developerMode && phaseGatePresentation.developerDetails.map((detail) => (
                  <p key={detail}><span>Detail</span>{detail}</p>
                ))}
                <div className="new-project-card-actions">
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => onApprovePhaseAndContinue(false)}
                    disabled={!phaseGatePresentation.canApprove || phaseExecutionRunning}
                  >
                    {phaseExecutionRunning ? "Continuing..." : "Approve Phase and Continue"}
                  </button>
                  {phaseGatePresentation.canApproveWithOverride && (
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => onApprovePhaseAndContinue(true)}
                      disabled={phaseExecutionRunning}
                      title={phaseGatePresentation.overrideWarning ?? undefined}
                    >
                      Approve with Override
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={onHoldPhase}
                    disabled={phaseExecutionRunning}
                  >
                    Hold Phase
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={onRevisePhasePlan}
                    disabled={phaseExecutionRunning}
                  >
                    Revise Plan
                  </button>
                </div>
                {phaseGatePresentation.overrideWarning && (
                  <p><span>Override warning</span>{phaseGatePresentation.overrideWarning}</p>
                )}
              </div>
            )}
          </div>
        )}
        <AppErrorBoundary>
        {projectCreationState && (
          <div className="new-project-card">
            <div className="new-project-card-header">
              <strong>Create New Project</strong>
              <span>{currentCreationNarration(projectCreationState, {
                hasBlueprint: !!creationBlueprint,
                hasPlanPreview: !!newProjectPlanPreview,
                hasFilePreview: !!newProjectFilePreview,
              })}</span>
            </div>
            <div className="new-project-card-body">
              {!developerMode ? (
                <>
                  {(() => {
                    const founderSummary = buildFounderCreationSummary(projectCreationState);
                    return (
                      <>
                        <p><span>What NF understood</span>{founderSummary.understood}</p>
                        <p><span>What NF will build first</span>{founderSummary.buildFirst}</p>
                        <p><span>What comes later</span>{founderSummary.later}</p>
                        <p><span>What I need from you</span>{founderSummary.needFromYou}</p>
                        <p><span>Next</span>{founderSummary.nextAction}</p>
                      </>
                    );
                  })()}
                </>
              ) : (
                <>
                  <p><span>Name</span>{projectCreationState.needsProjectName ? "Needs a project name" : projectCreationState.projectName}</p>
                  <p><span>Save path</span><code>{projectCreationState.savePath}</code></p>
                  <p><span>Planner</span>{projectCreationState.lockedPlanner}</p>
                  <p><span>Classification</span>{projectCreationState.classification.primaryClassification}</p>
                  <p><span>Idea</span>{displayLongText(projectCreationState.fullFounderPrompt)}</p>
                </>
              )}
              {developerMode && creationBlueprint?.architectureReview.data && (
                <p><span>Architecture Review</span>{creationBlueprint.architectureReview.data.status}</p>
              )}
              {developerMode && creationBlueprint?.phaseBuildPlan.data && (
                <p><span>Phase Build Plan</span>{creationBlueprint.phaseBuildPlan.data.phases.length} phases attached</p>
              )}
              {newProjectPlanPreview?.fullSpecSummary && (
                <>
                  <p><span>Summary</span>{displayLongText(newProjectPlanPreview.fullSpecSummary.uiSummary, 1000)}</p>
                  {developerMode && (
                    <>
                      <p><span>Accounts</span>{newProjectPlanPreview.fullSpecSummary.accountUserModel ?? "Needs confirmation"}</p>
                      <p><span>Infrastructure</span>{newProjectPlanPreview.fullSpecSummary.awsDomainRequirements.length ? newProjectPlanPreview.fullSpecSummary.awsDomainRequirements.join(", ") : "Needs confirmation"}</p>
                    </>
                  )}
                </>
              )}
              {developerMode && !newProjectPlanPreview && (
                <p><span>Next</span>Generate MVP definition and living build plan.</p>
              )}
              {projectCreationState.needsProjectName && (
                <div className="new-project-name-form">
                  <p className="new-project-name-required"><span>Name needed</span>{projectNameRequestMessage()}</p>
                  <label className="new-project-name-field">
                    <span>Project name</span>
                    <input
                      type="text"
                      value={projectNameDraft}
                      onChange={(event) => setProjectNameDraft(event.target.value)}
                      placeholder="NF Web Developer"
                      aria-label="Project name"
                    />
                  </label>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={!projectNameDraft.trim()}
                    onClick={() => {
                      const nextName = projectNameDraft.trim();
                      if (!nextName) return;
                      onApplyProjectName(nextName);
                      setProjectNameDraft("");
                    }}
                  >
                    Set project name
                  </button>
                </div>
              )}
            </div>
            {discoveryIntake && !newProjectPlanPreview && (
              <DiscoveryIntakeCard
                intake={discoveryIntake}
                developerMode={developerMode}
                needsProjectName={projectCreationState.needsProjectName}
                projectName={projectCreationState.projectName}
                onContinueWithDefaults={onContinueDiscoveryIntake}
              />
            )}
            {!newProjectPlanPreview && !discoveryIntake && (
              <div className="new-project-card-actions">
                <button type="button" className="btn primary" onClick={onGenerateNewProjectPlan}>
                  Generate Build Plan
                </button>
                <button type="button" className="btn secondary" onClick={onCancelNewProjectPlan}>
                  Cancel
                </button>
              </div>
            )}
            {!newProjectPlanPreview && discoveryIntake && (
              <div className="new-project-card-actions">
                <button type="button" className="btn secondary" onClick={onCancelNewProjectPlan}>
                  Cancel
                </button>
              </div>
            )}
            {newProjectPlanPreview && (
              <div className="new-project-plan-preview">
                <div className="new-project-plan-status">
                  <strong>Build Plan</strong>
                  <span>{newProjectPlanPreview.status === "approved" ? "Approved" : newProjectPlanPreview.status === "needsRevision" ? "Needs revision" : "Draft"}</span>
                </div>
                <p className="new-project-mvp">{newProjectPlanPreview.mvpDefinition}</p>
                {newProjectPlanPreview.inferredStack.length > 0 && (
                  <p className="new-project-stack">
                    <span>Stack</span>{newProjectPlanPreview.inferredStack.join(", ")}
                  </p>
                )}
                <ol className="new-project-milestones">
                  {newProjectPlanPreview.milestones.map((milestone) => (
                    <li key={milestone.id}>
                      <strong>{milestone.name}</strong>
                      <span>{milestone.goal}</span>
                      {milestone.tasks.length > 0 && (
                        <ul>
                          {milestone.tasks.map((task) => (
                            <li key={task.id}>{task.title}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ol>
                <div className="new-project-card-body">
                  <p><span>Next</span>{newProjectPlanPreview.nextRecommendedStep}</p>
                  {(newProjectPlanPreview.suggestedCommands.dev || newProjectPlanPreview.suggestedCommands.build || newProjectPlanPreview.suggestedCommands.test) && (
                    <p>
                      <span>Commands</span>
                      {[newProjectPlanPreview.suggestedCommands.dev && `dev: ${newProjectPlanPreview.suggestedCommands.dev}`,
                        newProjectPlanPreview.suggestedCommands.build && `build: ${newProjectPlanPreview.suggestedCommands.build}`,
                        newProjectPlanPreview.suggestedCommands.test && `test: ${newProjectPlanPreview.suggestedCommands.test}`]
                        .filter(Boolean).join("; ")}
                    </p>
                  )}
                </div>
                {!newProjectFilePreview && (
                <div className="new-project-card-actions">
                  <button type="button" className="btn primary" onClick={onApproveNewProjectPlan}>
                    Approve plan
                  </button>
                  <button type="button" className="btn secondary" onClick={onReviseNewProjectPlan}>
                    Revise plan
                  </button>
                  <button type="button" className="btn secondary" onClick={onCancelNewProjectPlan}>
                    Cancel
                  </button>
                </div>
                )}
              </div>
            )}
            {newProjectFilePreview && (
              <div className="new-project-file-preview">
                <div className="new-project-plan-status">
                  <strong>File Creation Preview</strong>
                  <span>Not written</span>
                </div>
                <div className="new-project-card-body">
                  <p><span>Target</span><code>{newProjectFilePreview.targetPath}</code></p>
                  <p><span>Folders</span>{newProjectFilePreview.foldersToCreate.length ? newProjectFilePreview.foldersToCreate.join(", ") : "(none)"}</p>
                  <p><span>Files</span>{newProjectFilePreview.filesToCreate.map((file) => file.path).join(", ")}</p>
                </div>
                <div className="starter-file-previews">
                  {newProjectFilePreview.keyStarterFiles.map((file) => (
                    <div key={file.path} className="starter-file-preview">
                      <div>
                        <strong>{file.path}</strong>
                        <span>{file.reason}</span>
                      </div>
                      <pre>{file.content.slice(0, 700)}</pre>
                    </div>
                  ))}
                </div>
                <div className="new-project-card-actions">
                  <button type="button" className="btn primary" onClick={onCreateNewProjectFiles}>
                    Create project files
                  </button>
                  <button type="button" className="btn secondary" onClick={onBackToNewProjectPlan}>
                    Back to plan
                  </button>
                  <button type="button" className="btn secondary" onClick={onCancelNewProjectPlan}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        </AppErrorBoundary>
        {importEvaluation && (
          <div className="import-project-card">
            <div className="import-project-card-header">
              <strong>Import Existing Project</strong>
              <span>Evaluation only</span>
            </div>
            <div className="import-project-card-body">
              <p><span>Name</span>{importEvaluation.projectName}</p>
              <p><span>Path</span><code>{importEvaluation.path}</code></p>
              <p><span>Stack</span>{importEvaluation.detectedStack.length ? importEvaluation.detectedStack.join(", ") : "Needs confirmation"}</p>
              <p><span>Type</span>{importEvaluation.likelyAppType}</p>
              <p><span>Commands</span>{formatCommands(importEvaluation.detectedCommands) || "Needs confirmation"}</p>
              <p><span>Docs</span>{importEvaluation.detectedDocs.length ? importEvaluation.detectedDocs.join(", ") : "None detected"}</p>
              <p><span>Summary</span>{importEvaluation.summary}</p>
            </div>
            <div className="import-project-plan-preview">
              <div className="new-project-plan-status">
                <strong>Memory and Build Plan Draft</strong>
                <span>Not written</span>
              </div>
              <p className="new-project-mvp">{importEvaluation.livingBuildPlanDraft.mvpDefinition}</p>
              <div className="import-project-card-body">
                <p><span>Milestone</span>{importEvaluation.livingBuildPlanDraft.milestones.find((milestone) => milestone.id === importEvaluation.livingBuildPlanDraft.currentMilestoneId)?.name ?? importEvaluation.livingBuildPlanDraft.currentMilestoneId}</p>
                <p><span>Next</span>{importEvaluation.livingBuildPlanDraft.nextRecommendedStep}</p>
                <p><span>Timeline</span>{importEvaluation.livingBuildPlanDraft.timelineEstimate ?? "Needs confirmation"}</p>
                <p><span>Files</span>{importEvaluation.projectMemoryDraft.importantFiles.length ? importEvaluation.projectMemoryDraft.importantFiles.map((file) => file.path).slice(0, 8).join(", ") : "Needs confirmation"}</p>
              </div>
              {importEvaluation.missingInformation.length > 0 && (
                <div className="import-project-questions">
                  <strong>Missing information</strong>
                  <ul>
                    {importEvaluation.missingInformation.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  {importEvaluation.suggestedQuestions.length > 0 && (
                    <>
                      <strong>Suggested questions</strong>
                      <ul>
                        {importEvaluation.suggestedQuestions.map((question) => (
                          <li key={question}>{question}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="import-project-card-actions">
              <button type="button" className="btn primary" onClick={onApproveImportEvaluation}>
                Approve Import
              </button>
              <button type="button" className="btn secondary" onClick={onAnswerImportQuestions}>
                Answer Questions
              </button>
              <button type="button" className="btn secondary" onClick={onCancelImportEvaluation}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {buildProgressSummary && (
          <div className="build-progress-card">
            <div className="build-progress-card-header">
              <strong>Build Progress Updated</strong>
              <span>{buildProgressSummary.completedTaskName ? "Task completed" : "Contributes toward task"}</span>
            </div>
            <div className="build-progress-card-body">
              <p>
                <span>Completed</span>
                {buildProgressSummary.completedTaskName ?? `This contributes toward ${buildProgressSummary.contributedToward ?? "the current task"}.`}
              </p>
              <p>
                <span>Files</span>
                {buildProgressSummary.filesChanged.length ? buildProgressSummary.filesChanged.join(", ") : "(none)"}
              </p>
              <p>
                <span>Progress</span>
                {buildProgressSummary.milestoneName}: {buildProgressSummary.completedTasks} / {buildProgressSummary.totalTasks} tasks complete
              </p>
              <p>
                <span>Next</span>
                {buildProgressSummary.nextRecommendedStep}
              </p>
            </div>
            <div className="build-progress-card-actions">
              <button type="button" className="btn primary" onClick={onContinueBuildProgress}>
                Continue
              </button>
              <button type="button" className="btn secondary" onClick={onPauseBuildProgress}>
                Pause
              </button>
              <button type="button" className="btn secondary" onClick={onViewBuildPlan}>
                View Build Plan
              </button>
            </div>
          </div>
        )}
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
            <p>{displayLongText(m.text, CHAT_MESSAGE_DISPLAY_LIMIT)}</p>
          </div>
        ))}
        {developerMode && plannerOutput && (
          <div className="message assistant pipeline-block">
            <strong>Planner</strong>
            <p>{plannerOutput.plan}</p>
            <p className="muted">Target files: {plannerOutput.targetFiles.join(", ") || "(none)"}</p>
          </div>
        )}
        {developerMode && planAndPatch && plannerOutput && (
          <div className="message assistant pipeline-block">
            <strong>Coder</strong>
            <p>{planAndPatch.explanation}</p>
          </div>
        )}
        {developerMode && reviewerOutput && (
          <div className="message assistant pipeline-block">
            <strong>Reviewer</strong>
            <p>{reviewerOutput.reviewNotes}</p>
            <p className="muted">Recommended checks: {reviewerOutput.recommendedChecks.join(", ")}</p>
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
      {developerMode && lastRetrievedChunks.length > 0 && (
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
              {runtimeToolRootError && (
                <div className="local-error-msg">
                  <p>{runtimeToolRootError}</p>
                  {expectedExePath && (
                    <p>Put <code>llama-server.exe</code> at: <code title={expectedExePath}>{expectedExePath}</code></p>
                  )}
                </div>
              )}
              {toolRoot && !localSettings.ggufPath?.trim() && !runtimeToolRootError && (
                <p className="local-no-gguf-msg">
                  Drop a .gguf into <code>{toolRoot.replace(/\\/g, "/").replace(/\/+$/, "")}/models</code>
                </p>
              )}
            </>
          )}
        </div>
        {(provider === "local" || developerMode) && (
        <div className="advanced-section">
          <button
            type="button"
            className="btn-link advanced-toggle"
            onClick={() => setAdvancedExpanded((v) => !v)}
            aria-expanded={advancedExpanded}
          >
            {advancedExpanded ? "Hide Settings" : "Settings >"}
          </button>
          {advancedExpanded && workspaceRoot && (
            <div className="advanced-content">
              {developerMode && onModelRolesChange && (
                <ModelsPanel
                  workspaceRoot={workspaceRoot}
                  modelRoles={modelRoles}
                  onModelRolesChange={onModelRolesChange}
                />
              )}
              {developerMode && toolRoot != null && (
                <div className="project-snapshot-row">
                  <span className="project-snapshot-label">toolRoot:</span>
                  <span className="project-snapshot-value" title={toolRoot}>{toolRoot}</span>
                </div>
              )}
              {developerMode && (
                <div className="project-snapshot-row">
                  <span className="project-snapshot-label">Provider (internal):</span>
                  <span className="project-snapshot-value">{provider}</span>
                </div>
              )}
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
              {developerMode && (
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
              )}
            </div>
          )}
        </div>
        )}
        {developerMode && (
        <label className="knowledge-toggle">
          <input
            type="checkbox"
            checked={useKnowledgePacks}
            onChange={(e) => onUseKnowledgePacksChange(e.target.checked)}
          />
          Use Knowledge Packs
        </label>
        )}
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
            disabled={false}
          />
        </div>
        <button
          type="button"
          className="btn primary"
          disabled={provider === "local" && workspaceRoot !== null && (!toolRoot || !localSettings.ggufPath?.trim())}
          onClick={handleSendChat}
        >
          Send
        </button>
      </div>
    </div>
  );
}
