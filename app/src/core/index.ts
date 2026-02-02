export * from "./types";
export { WorkspaceService } from "./workspace/WorkspaceService";
export { getRequestedFileHint, readProjectFile, extractFileMentions, hasEditIntent, hasDiffRequest, routeMessage, hasFileEditIntent } from "./workspace/readProjectFile";
export { routeUserMessage, impliesMultiFile, classifyFileActionIntent, applySimpleEdit, generateSimpleEdit, generateFileEdit, isSimpleEditPatternMatched, generateMultiFileProposal, parseMultiFileProposal, generateProposalSummary, validateAndFixSummary, buildFileListFromGroundTruth, buildProposalGroundTruth } from "./intent";
export type { GenerateFileEditOptions, GenerateFileEditResult, MultiFileProposal, ProposedFileChange, GenerateSummaryInputSingle, GenerateSummaryInputMulti, GenerateSummaryInputGrounded, ValidateSummaryOptions, ProposalGroundTruth, ProposalFileLike, FileGroundTruth } from "./intent";
export { runVerificationChecks } from "./verify/runChecks";
export type { VerificationResult, CheckStage } from "./verify/runChecks";
export {
  detectMissingPrereqs,
  getVerifyProfile,
  getPrereqById,
  pickVerifyProfileFromSignals,
  pickDefaultVerifyProfile,
  checkRecommendedPrereqs,
  isCommandAvailable,
  CORE_PREREQS,
  RECOMMENDED_CLIS,
  VERIFY_PROFILES,
} from "../lib/prereqs/prereqDetector";
export type {
  Prereq,
  VerifyProfile,
  InstallMethod,
  MissingPrereqResult,
  RecommendedPrereqResult,
} from "../lib/prereqs/prereqDetector";
export {
  detectProjectSignals,
  getRecommendations,
} from "../lib/prereqs/recommendationEngine";
export type {
  ProjectSignals,
  RecommendedItem,
  RecommendationsResult,
} from "../lib/prereqs/recommendationEngine";
export type { ReadProjectFileResult } from "./workspace/readProjectFile";
export { ProjectInspector } from "./inspect/ProjectInspector";
export { ProjectDetector } from "./project/ProjectDetector";
export type { ProjectDetectorResult } from "./project/ProjectDetector";
export { readProjectSnapshot, writeProjectSnapshot } from "./project/projectSnapshot";
export { detectProjectRoot, inferDetectedType } from "./project/projectRoot";
export type { ProjectRootResult, DetectedType } from "./project/projectRoot";
export { getDefaultEnabledPackIds } from "./knowledge/autoEnablePacks";
export type { ProjectInfo } from "./knowledge/autoEnablePacks";
export {
  generateSnapshotData,
  writeProjectSnapshotFile,
  getSnapshotOutputPath,
  shouldIgnorePathSegment,
} from "./project/snapshot";
export type { ProjectSnapshotJson, SnapshotFileEntry } from "./project/snapshot";
export { readWorkspaceSettings, writeWorkspaceSettings } from "./project/workspaceSettings";
export { ContextBuilder } from "./context/ContextBuilder";
export {
  MockModelProvider,
  setModelProvider,
  getModelProvider,
  generatePlanAndPatch,
  generateChatResponse,
} from "./model/ModelGateway";
export type { IModelProvider } from "./model/ModelGateway";
export { LocalModelProvider } from "./model/LocalModelProvider";
export {
  runPipeline,
  defaultPlanner,
  defaultCoder,
  defaultReviewer,
  MockPlannerAgent,
  CoderAgent,
  MockReviewerAgent,
  LocalPlannerAgent,
  LocalReviewerAgent,
} from "./agents";
export type { PipelineResult, PipelineOverrides, IPlannerAgent, ICoderAgent, IReviewerAgent } from "./agents";
export {
  findToolRoot,
  scanModelsForGGUF,
  toolRootExists,
  resolveModelPath,
  runtimeStart,
  runtimeStatus,
  runtimeStop,
  runtimeGenerate,
  ensureLocalRuntime,
  DEFAULT_LOCAL_SETTINGS,
  LLAMA_SERVER_REL,
} from "./runtime/runtimeApi";
export type {
  Provider,
  LocalModelSettings,
  RuntimeStartResult,
  RuntimeStatusResult,
  GenerateOptions,
} from "./runtime/runtimeApi";
export { PatchEngine } from "./patch/PatchEngine";
export type { ApplyResult, FileSnapshot } from "./patch/PatchEngine";
export { MemoryStore } from "./memory/MemoryStore";
export { resumeSuggestion } from "./memory/resumeSuggestion";
export type { ResumeSuggestion } from "./memory/resumeSuggestion";
export { KnowledgeStore } from "./knowledge/KnowledgeStore";
