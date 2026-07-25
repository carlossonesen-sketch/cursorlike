/** Shared types for NF core. */

export interface DirEntry {
  name: string;
  is_dir: boolean;
}

export interface FileTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileTreeNode[];
}

export interface ProjectManifest {
  projectTypes: string[];
  configFiles: string[];
  lockfiles: string[];
  fileList: string[];
  dependencyIndicators: Record<string, string[]>;
}

export type ProjectLifecycleStage =
  | "idea"
  | "planning"
  | "buildingMvp"
  | "testing"
  | "polishing"
  | "demoReady"
  | "production"
  | "scaling"
  | "maintenance";

export interface KnownProject {
  id: string;
  name: string;
  aliases: string[];
  path: string;
  summary: string;
  lastOpenedAt?: string;
  archived?: boolean;
}

export interface GlobalMemory {
  schemaVersion: 1;
  updatedAt: string;
  defaultProjectsFolder: string;
  projects: KnownProject[];
}

export interface ProjectCommands {
  dev?: string;
  build?: string;
  test?: string;
  lint?: string;
  format?: string;
}

export interface DecisionNote {
  id: string;
  date: string;
  decision: string;
  reason?: string;
}

export interface ImportantFile {
  path: string;
  reason: string;
}

export interface GeneratedFile {
  path: string;
  createdAt: string;
  reason: string;
}

export interface ProjectTodoItem {
  id: string;
  text: string;
  status: "todo" | "doing" | "done" | "blocked";
}

export interface KnownIssue {
  id: string;
  title: string;
  status: "open" | "blocked" | "resolved";
  notes?: string;
}

export interface WorkSummary {
  id: string;
  date: string;
  completed: string;
  filesChanged: string[];
  worksNow: string[];
  stillNeedsWork: string[];
  nextRecommendedStep: string;
}

export interface ResumeState {
  status: "active" | "paused";
  activeMilestoneId?: string;
  activeTaskId?: string;
  lastWorkedAt?: string;
  resumePrompt?: string;
}

export interface ProjectMemory {
  schemaVersion: 1;
  projectId: string;
  name: string;
  aliases: string[];
  path: string;
  createdAt: string;
  updatedAt: string;
  status: "planning" | "active" | "paused" | "complete" | "archived";
  lifecycleStage: ProjectLifecycleStage;
  fullIdea: string;
  summary: string;
  techStack: string[];
  architectureNotes: string[];
  decisions: DecisionNote[];
  importantFiles: ImportantFile[];
  generatedFiles: GeneratedFile[];
  commands: ProjectCommands;
  todos: ProjectTodoItem[];
  knownIssues: KnownIssue[];
  recentWork: WorkSummary[];
  resumeState: ResumeState;
}

export type TaskKind = "planning" | "scaffold" | "implementation";

export interface BuildTask {
  id: string;
  title: string;
  description?: string;
  kind?: TaskKind;
  status: "todo" | "next" | "doing" | "done" | "blocked";
  completedAt?: string;
  filesExpected?: string[];
}

export interface BuildMilestone {
  id: string;
  name: string;
  goal: string;
  status: "planned" | "active" | "paused" | "done";
  tasks: BuildTask[];
}

export interface CompletedStep {
  id: string;
  completedAt: string;
  milestoneId: string;
  taskId?: string;
  completed: string;
  filesChanged: string[];
  worksNow: string[];
  stillNeedsWork: string[];
  nextRecommendedStep: string;
}

export interface PausedState {
  isPaused: boolean;
  pausedAt?: string;
  reason?: string;
  resumePrompt?: string;
}

export interface LivingBuildPlan {
  schemaVersion: 1;
  projectId: string;
  mvpDefinition: string;
  milestones: BuildMilestone[];
  currentMilestoneId: string;
  currentTaskId?: string;
  completedSteps: CompletedStep[];
  nextRecommendedStep: string;
  progressSummary: string;
  timelineEstimate?: string;
  pausedState: PausedState;
}

export interface FounderManifest {
  schemaVersion: 1;
  projectId: string;
  vision: string;
  mission: string;
  targetCustomer: string;
  problem: string;
  mvpDefinition: string;
  successMetric: string;
  notInV1: string[];
  futureRoadmap: string[];
  updatedAt: string;
}

export interface ActionLogEntry {
  ts: string;
  projectId: string;
  action:
    | "create_project"
    | "write_file"
    | "apply_patch"
    | "revert_patch"
    | "run_command"
    | "update_memory"
    | "pause"
    | "resume";
  summary: string;
  files?: string[];
  command?: string;
  runId?: string;
  exitCode?: number;
  durationMs?: number;
  approved?: boolean;
}

export interface NewProjectPlanPreview {
  mvpDefinition: string;
  milestones: BuildMilestone[];
  nextRecommendedStep: string;
  suggestedCommands: ProjectCommands;
  inferredStack: string[];
  status: "draft" | "approved" | "needsRevision";
  fullSpecSummary?: FullProjectSpecExtraction;
}

export interface NewProjectStarterFile {
  path: string;
  content: string;
  reason: string;
}

export interface NewProjectFilePreview {
  targetPath: string;
  foldersToCreate: string[];
  filesToCreate: NewProjectStarterFile[];
  keyStarterFiles: NewProjectStarterFile[];
}

export interface ExistingProjectImportEvaluation {
  projectName: string;
  path: string;
  detectedStack: string[];
  likelyAppType: string;
  detectedCommands: ProjectCommands;
  detectedDocs: string[];
  summary: string;
  missingInformation: string[];
  suggestedQuestions: string[];
  projectMemoryDraft: ProjectMemory;
  livingBuildPlanDraft: LivingBuildPlan;
  projectBlueprintDraft?: ProjectBlueprint;
}

export type IntakeConfidenceLevel = "low" | "medium" | "high";

export interface IntakeAnswer {
  key: string;
  label: string;
  value: string;
  source: "user" | "inferred" | "default";
  confidence: IntakeConfidenceLevel;
}

export interface IntakeQuestion {
  key: string;
  question: string;
  whyItMatters: string;
  recommendedDefault: string;
  blocksBuild: boolean;
}

export interface IntakeDefault {
  key: string;
  label: string;
  value: string;
  reason: string;
}

export interface DiscoveryIntake {
  userRequest: string;
  understoodSummary: string;
  inferredAnswers: IntakeAnswer[];
  unansweredQuestions: IntakeQuestion[];
  recommendedDefaults: IntakeDefault[];
  userConfirmedAnswers: IntakeAnswer[];
  assumptions: string[];
  confidenceLevel: IntakeConfidenceLevel;
  decisionsRequiringLaterConfirmation: string[];
  canContinue: boolean;
}

export type BlueprintSectionStatus = "empty" | "draft" | "ready" | "needsReview";

export type BlueprintSource =
  | "newProject"
  | "existingProject"
  | "featureRequest"
  | "bugReport"
  | "refactorRequest";

export interface BlueprintSection<T> {
  status: BlueprintSectionStatus;
  updatedAt?: string;
  data: T;
}

export interface ProjectIdentity {
  projectId: string;
  source: BlueprintSource;
  name?: string;
  slug?: string;
  path?: string;
}

export interface ProductBrief {
  summary: string;
  productType: string;
  platform: string;
  mvpFeatures: string[];
  targetUsers: string[];
  launchTarget: string;
}

export interface FullProjectSpecExtraction {
  projectName?: string;
  savePath?: string;
  classification?: ProjectClassificationType;
  requiredPlanner?: RequiredPlanner;
  launchType?: string;
  accountUserModel?: string;
  mvpFeatures: string[];
  postMvpFeatures: string[];
  awsDomainRequirements: string[];
  aiPlaceholders: string[];
  milestones: string[];
  nonGoals: string[];
  approvalGates: string[];
  uiSummary: string;
  confidenceLevel: IntakeConfidenceLevel;
}

export type ProjectClassificationType =
  | "Website Platform / Website Builder"
  | "Business Website"
  | "SaaS"
  | "Mobile App"
  | "Desktop App"
  | "API / Backend Service"
  | "AI Agent"
  | "Developer Tool"
  | "Marketplace"
  | "Ecommerce"
  | "Internal Business Tool"
  | "Generic Software App";

export type RequiredPlanner =
  | "websitePlatformPlanner"
  | "businessWebsitePlanner"
  | "saasPlanner"
  | "mobileAppPlanner"
  | "desktopAppPlanner"
  | "backendServicePlanner"
  | "aiAgentPlanner"
  | "developerToolPlanner"
  | "marketplacePlanner"
  | "ecommercePlanner"
  | "internalToolPlanner"
  | "generalSoftwarePlanner";

export interface PlannerProfile {
  id: RequiredPlanner;
  label: string;
  understands: string[];
  planningFocus: string[];
}

export interface ProjectClassificationResult {
  primaryClassification: ProjectClassificationType;
  secondaryClassifications: ProjectClassificationType[];
  confidence: IntakeConfidenceLevel;
  reasoning: string[];
  requiredPlanner: RequiredPlanner;
  missingClarificationQuestions: string[];
  founderSummary: string;
  developerDetails: string[];
  plannerProfile: PlannerProfile;
}

export interface BlueprintDecision {
  id: string;
  text: string;
  status: "pending" | "approved" | "rejected" | "deferred";
  reason?: string;
  key?: string;
  label?: string;
  value?: string;
  source?: IntakeAnswer["source"];
  confidence?: IntakeConfidenceLevel;
}

export interface BlueprintBuildHistoryEntry {
  id: string;
  timestamp: string;
  summary: string;
  source: string;
}

export interface FrontEndRouteIntent {
  path: string;
  label: string;
  purpose: string;
  sourceFeatureKeys: string[];
}

export interface FrontEndComponentIntent {
  name: string;
  purpose: string;
  componentType: "page" | "layout" | "navigation" | "form" | "display" | "feedback" | "shared";
  supportsRoutes: string[];
  sourceFeatureKeys: string[];
}

export interface FrontEndInteractionStateIntent {
  target: string;
  states: string[];
  reason: string;
}

export interface FrontEndValidationNeed {
  id: string;
  label: string;
  reason: string;
  required: boolean;
}

export interface FrontEndGenerationIntent {
  appType: string;
  targetPlatform: string;
  founderSummary: string;
  pagesOrScreens: string[];
  routes: FrontEndRouteIntent[];
  components: FrontEndComponentIntent[];
  layoutStylePreferences: string[];
  userFlows: string[];
  responsiveNeeds: string[];
  interactionStates: FrontEndInteractionStateIntent[];
  validationNeeds: FrontEndValidationNeed[];
  developerNotes: string[];
}

export type ControlLevel = "manual" | "assisted" | "guided" | "autonomous";

export type ProductMode = "founder" | "developer";

export interface ControlPreferences {
  controlLevel: ControlLevel;
  preferredMode: ProductMode;
  phaseGatesRequireApproval: boolean;
  patchesRequireApproval: boolean;
  allowAutomaticSafePatches: boolean;
  allowAutomaticBuildChecks: boolean;
  allowAutomaticTests: boolean;
  allowAutomaticRepair: boolean;
  stopForSensitiveActions: boolean;
  stopForDestructiveActions: boolean;
}

export interface CurrentProductInventory {
  projectPath?: string;
  filesInspected: string[];
  packageFiles: string[];
  sourceFolders: string[];
  importantFiles: ImportantFile[];
  uiEntryPoints: string[];
  routesOrNavigationHints: string[];
  componentsWidgetsScreens: string[];
  detectedCommands: ProjectCommands;
}

export interface PreservationRules {
  preserveWorkingUi: boolean;
  preserveUserFlows: boolean;
  preserveFolderStructure: boolean;
  preserveBusinessLogic: boolean;
  preserveArchitectureDecisions: boolean;
  requireApprovalForRewrite: boolean;
  defaultChangeMode: "extend" | "replace";
  notes: string[];
}

export interface ExistingProductAssessment {
  projectPath?: string;
  projectType: string;
  frameworks: string[];
  likelyAppType: string;
  inventory: CurrentProductInventory;
  architectureNotes: string[];
  preservationRules: PreservationRules;
  confidenceLevel: IntakeConfidenceLevel;
}

export interface GapAnalysisItem {
  key: string;
  label: string;
  reason: string;
  relatedFiles: string[];
}

export interface GapAnalysis {
  blueprintId: string;
  analyzedAt: string;
  existingItems: GapAnalysisItem[];
  missingMvpFeatures: GapAnalysisItem[];
  partialFeatures: GapAnalysisItem[];
  possibleBlockers: GapAnalysisItem[];
  preservationWarnings: GapAnalysisItem[];
  recommendedNextBuildFocus: string;
  confidenceLevel: IntakeConfidenceLevel;
}

export type PhaseStatus = "planned" | "approved" | "active" | "complete" | "blocked";

export interface PhaseTask {
  id: string;
  title: string;
  rationale: string;
  sourceGapKeys: string[];
  constraints: string[];
  status: "todo" | "doing" | "done" | "blocked";
}

export interface QualityGate {
  id: string;
  title: string;
  check: string;
  required: boolean;
  status: "pending" | "passed" | "failed" | "blocked";
}

export interface PhaseGate {
  id: string;
  title: string;
  requiresApproval: boolean;
  approvalQuestion: string;
  approvedAt?: string;
}

export interface PhaseBuildPlanPhase {
  id: string;
  title: string;
  goal: string;
  tasks: PhaseTask[];
  definitionOfDone: string[];
  qualityGates: QualityGate[];
  approvalGate: PhaseGate;
  status: PhaseStatus;
}

export interface PhaseBuildPlan {
  schemaVersion: 1;
  blueprintId: string;
  createdAt: string;
  updatedAt: string;
  phases: PhaseBuildPlanPhase[];
  currentPhaseId: string;
  recommendedNextPhaseId: string;
  recommendedNextTaskId?: string;
  preservationSummary: string;
}

export type ArchitectureFindingSeverity = "info" | "recommendation" | "warning" | "critical";

export interface ArchitectureFinding {
  id: string;
  severity: ArchitectureFindingSeverity;
  title: string;
  explanation: string;
  affectedModules: string[];
  suggestedSolution: string;
  canContinue: boolean;
}

export interface ArchitectureApproval {
  id: string;
  question: string;
  reason: string;
  required: boolean;
  approvedAt?: string;
}

export interface ArchitectureReviewReport {
  schemaVersion: 1;
  blueprintId: string;
  reviewedAt: string;
  status: "passed" | "needsReview" | "blocked";
  architectureScore: number;
  findings: ArchitectureFinding[];
  requiredFounderApprovals: ArchitectureApproval[];
  updatedDependencyGraph: PlannerDependency[];
  recommendedImprovements: string[];
  shouldContinueToFoundation: boolean;
}

export type ProjectHealthStatus = "Excellent" | "Good" | "Needs Attention" | "Critical";

export type ProjectHealthCategory =
  | "Planning"
  | "Architecture"
  | "Dependencies"
  | "Implementation"
  | "Testing"
  | "Documentation"
  | "Security"
  | "Performance"
  | "Scalability"
  | "Technical Debt"
  | "Maintainability"
  | "Risk"
  | "Autonomy Readiness"
  | "Overall Project Health";

export interface ProjectHealthCategoryScore {
  category: ProjectHealthCategory;
  score: number;
  status: ProjectHealthStatus;
  summary: string;
  recommendations: string[];
  evidence: string[];
  calculationDetails: string[];
  trend: "improving" | "stable" | "declining" | "unknown";
}

export interface ProjectHealthReport {
  schemaVersion: 1;
  blueprintId: string;
  updatedAt: string;
  overallScore: number;
  overallStatus: ProjectHealthStatus;
  topRisks: string[];
  topStrengths: string[];
  nextRecommendation: string;
  categories: ProjectHealthCategoryScore[];
  history: {
    timestamp: string;
    overallScore: number;
    summary: string;
  }[];
}

export interface PlannerDependency {
  id: string;
  label: string;
  dependsOn: string[];
  reason: string;
}

export interface PlannerMilestone {
  id: string;
  title: string;
  goal: string;
  items: string[];
  deferred?: boolean;
}

export interface SpecializedPlannerOutput {
  planner: RequiredPlanner;
  mvpDefinition: string;
  productBrief: ProductBrief;
  features: string[];
  screens: string[];
  dataModels: string[];
  apis: string[];
  integrations: string[];
  architectureRecommendation: string[];
  designSystem: string[];
  dependencyGraph: PlannerDependency[];
  milestones: PlannerMilestone[];
  phaseTasks: Record<string, PhaseTask[]>;
  qualityGates: Record<string, QualityGate[]>;
  successCriteria: string[];
  deferredFeatures: string[];
  founderSummary: string;
  developerDetails: string[];
  templateSeparationRules?: string[];
  fullSpecExtraction?: FullProjectSpecExtraction;
}

export type PhaseExecutionCheckStatus = "notRun" | "running" | "passed" | "failed" | "blocked";

export interface PhaseExecutionCheckState {
  status: PhaseExecutionCheckStatus;
  updatedAt?: string;
  summary?: string;
  command?: string;
  exitCode?: number;
}

export interface PhaseRepairAttempt {
  id: string;
  taskId: string;
  attemptedAt: string;
  summary: string;
  status: "attempted" | "succeeded" | "failed" | "blocked";
}

export interface PhaseExecutionHistoryEntry {
  id: string;
  timestamp: string;
  action: string;
  phaseId: string;
  taskId?: string;
  summary: string;
}

export interface PendingChangeApproval {
  id: string;
  phaseId: string;
  taskId: string;
  taskTitle: string;
  summary: string;
  explanation: string;
  filePaths: string[];
  patch: string;
  controlReason: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
  resolvedAt?: string;
}

export interface PhaseExecutionState {
  schemaVersion: 1;
  blueprintId: string;
  phaseBuildPlanId: string;
  currentPhaseId: string;
  currentTaskId?: string;
  completedTaskIds: string[];
  skippedTaskIds: string[];
  blockedTaskIds: string[];
  blockerReason?: string;
  pendingChangeApproval?: PendingChangeApproval | null;
  lastAction: string;
  nextRecommendedAction: string;
  buildStatus: PhaseExecutionCheckState;
  testStatus: PhaseExecutionCheckState;
  checkStatus: PhaseExecutionCheckState;
  repairAttempts: PhaseRepairAttempt[];
  phaseStatus: PhaseStatus;
  confidenceLevel: IntakeConfidenceLevel;
  createdAt: string;
  updatedAt: string;
  history: PhaseExecutionHistoryEntry[];
}

export interface ProjectBlueprint {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  identity: ProjectIdentity;
  discoveryIntake: BlueprintSection<DiscoveryIntake | null>;
  projectClassification: BlueprintSection<ProjectClassificationResult | null>;
  specializedPlannerOutput: BlueprintSection<SpecializedPlannerOutput | null>;
  productBrief: BlueprintSection<ProductBrief | null>;
  vision: BlueprintSection<string>;
  goals: BlueprintSection<string[]>;
  users: BlueprintSection<string[]>;
  features: BlueprintSection<string[]>;
  screens: BlueprintSection<string[]>;
  frontEndGenerationIntent: BlueprintSection<FrontEndGenerationIntent | null>;
  dataModels: BlueprintSection<string[]>;
  apis: BlueprintSection<string[]>;
  integrations: BlueprintSection<string[]>;
  architecture: BlueprintSection<string[]>;
  designSystem: BlueprintSection<string[]>;
  currentProductInventory: BlueprintSection<CurrentProductInventory | null>;
  preservationRules: BlueprintSection<PreservationRules | null>;
  existingProductAssessment: BlueprintSection<ExistingProductAssessment | null>;
  gapAnalysis: BlueprintSection<GapAnalysis | null>;
  architectureReview: BlueprintSection<ArchitectureReviewReport | null>;
  phaseBuildPlan: BlueprintSection<PhaseBuildPlan | null>;
  phaseExecutionState: BlueprintSection<PhaseExecutionState | null>;
  projectHealth: BlueprintSection<ProjectHealthReport | null>;
  qualityState: BlueprintSection<string[]>;
  founderDecisions: BlueprintSection<BlueprintDecision[]>;
  developerPreferences: BlueprintSection<string[]>;
  controlPreferences: BlueprintSection<ControlPreferences>;
  assumptions: BlueprintSection<string[]>;
  confidence: BlueprintSection<IntakeConfidenceLevel>;
  buildHistory: BlueprintSection<BlueprintBuildHistoryEntry[]>;
  lessonsLearned: BlueprintSection<string[]>;
}

export interface BuildProgressApplySummary {
  completedTaskName?: string;
  contributedToward?: string;
  filesChanged: string[];
  milestoneName: string;
  completedTasks: number;
  totalTasks: number;
  nextRecommendedStep: string;
}

export interface NewProjectDraft {
  projectName: string;
  ideaText: string;
  slug: string;
  defaultPath: string;
  createdFrom: "menu" | "prompt";
}

/** Commands inferred from package.json scripts or common tooling defaults. */
export interface DetectedCommands {
  build?: string;
  test?: string;
  lint?: string;
  dev?: string;
}

/** Project snapshot stored at .devassistant/project_snapshot.json */
export interface ProjectSnapshot {
  detectedTypes: string[];
  recommendedPacks: string[];
  enabledPacks: string[];
  importantFiles: string[];
  detectedCommands: DetectedCommands;
  /** ISO timestamp when snapshot was generated */
  generatedAt?: string;
}

/** Model role paths (absolute or toolRoot-relative). Optional; fallback to modelPath for coder/general. */
export interface ModelRolePaths {
  coder?: string;
  general?: string;
  reviewer?: string;
  embeddings?: string;
  reranker?: string;
}

/** Workspace settings stored at .devassistant/settings.json */
export interface WorkspaceSettings {
  autoPacksEnabled: boolean;
  enabledPacks: string[];
  /** Active provider for chat/coding. */
  provider?: "local" | "openai";
  /** OpenAI model name when provider=openai. */
  openaiModel?: string;
  /** ToolRoot-relative path to GGUF (e.g. models/foo.gguf) for provider=local. Legacy; used when modelRoles not set. */
  modelPath?: string;
  /** Port for llama-server (default 11435). */
  port?: number;
  /** Per-role model paths (absolute or relative). When set, overrides modelPath for coder/general. */
  modelRoles?: ModelRolePaths;
}

export interface ModelContext {
  prompt: string;
  selectedFiles: { path: string; content: string }[];
  suggestedFiles?: { path: string; content: string }[];
  manifestSummary?: string;
  projectMemorySummary?: string;
  /** Set when running pipeline; Coder uses plan + targetFiles. */
  plan?: string;
  targetFiles?: string[];
  /** Retrieved knowledge chunks (title + sourcePath + chunkText). */
  knowledgeChunks?: KnowledgeChunkRef[];
  /** When true, chat prompt includes file/project/repo context. When false or unset, chat is plain (user message only). */
  includeFileProjectContext?: boolean;
}

/** One knowledge chunk reference for context (and UI display). */
export interface KnowledgeChunkRef {
  title: string;
  sourcePath: string;
  chunkText: string;
}

export interface PlanAndPatch {
  explanation: string;
  patch: string;
}

/** Planner agent output. NO patch. */
export interface PlannerOutput {
  plan: string;
  targetFiles: string[];
}

/** Reviewer agent output. NO patch. */
export interface ReviewerOutput {
  reviewNotes: string;
  recommendedChecks: string[];
}

export type AgentMode = "Coder" | "Planner" | "Reviewer";

export type SessionStatus = "proposed" | "pending" | "applied" | "reverted";

/** Check step record (Step 3 will populate). */
export interface CheckRecord {
  step: string;
  command: string;
  exitCode: number;
  outputPathRef?: string;
}

export interface TouchedFileRecord {
  path: string;
  beforeHash?: string;
  afterHash?: string;
  beforeContentRef?: string;
}

export interface SessionRecord {
  id: string;
  /** ISO timestamp; use as createdAt for display. */
  timestamp: string;
  createdAt?: string;
  status: SessionStatus;
  userPrompt: string;
  selectedContextFiles: string[];
  manifestHash?: string;
  explanation: string;
  patch: string;
  /** Touched files (paths from patch; hashes when applied). */
  filesChanged: TouchedFileRecord[];
  /** Persisted for applied sessions; used for timeline Revert. */
  beforeSnapshots?: { path: string; content: string }[];
  checks?: CheckRecord[];
}

/** Knowledge index chunk (stored in .devassistant/knowledge_index.json). */
export interface KnowledgeIndexChunk {
  id: string;
  sourcePath: string;
  title: string;
  chunkText: string;
  tags: string[];
  contentHash: string;
  updatedAt: string;
}

/** Knowledge index file shape. */
export interface KnowledgeIndex {
  fileHashes: Record<string, string>;
  chunks: KnowledgeIndexChunk[];
}

/** Retrieved chunk for API (includes score). */
export interface RetrievedChunk {
  title: string;
  sourcePath: string;
  chunkText: string;
  score: number;
}


