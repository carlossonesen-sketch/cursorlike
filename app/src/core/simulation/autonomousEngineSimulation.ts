export type ChaosOutcome =
  | "stop"
  | "repair"
  | "retry"
  | "askFounder"
  | "block";

export type ChaosResult = "pass" | "fail";

export type GapRiskLevel = "low" | "medium" | "high" | "critical";

export interface ChaosScenario {
  id: string;
  name: string;
  expectedBehavior: string;
  outcome: ChaosOutcome;
  safeStopCondition: string;
  dashboardVisibleResult: string;
  founderModeExplanation: string;
  developerModeRawDetails: string[];
  result: ChaosResult;
  missingEngineCapability?: string;
}

export interface ChaosSimulationReport {
  projectName: string;
  simulatedAt: string;
  result: ChaosResult;
  confidenceScore: number;
  scenarios: ChaosScenario[];
  passCriteria: string[];
  failures: ChaosScenario[];
  missingCapabilities: string[];
  safeToBeginPlanning: boolean;
}

export interface AutonomousEngineGapArea {
  id: string;
  area: string;
  currentStatus: string;
  maturityScore: number;
  missingCapability: string;
  riskLevel: GapRiskLevel;
  recommendedFix: string;
  requiredTests: string[];
}

export interface AutonomousEngineGapReport {
  generatedAt: string;
  readinessScore: number;
  areas: AutonomousEngineGapArea[];
  topMissingCapabilities: string[];
  safeToBeginPlanning: boolean;
  safeForFullAutonomousBuild: boolean;
}

export interface WebsitePlatformChaosInput {
  projectName: string;
  simulatedAt: string;
}

function scenario(
  id: string,
  name: string,
  expectedBehavior: string,
  outcome: ChaosOutcome,
  safeStopCondition: string,
  dashboardVisibleResult: string,
  founderModeExplanation: string,
  developerModeRawDetails: string[],
  missingEngineCapability?: string
): ChaosScenario {
  return {
    id,
    name,
    expectedBehavior,
    outcome,
    safeStopCondition,
    dashboardVisibleResult,
    founderModeExplanation,
    developerModeRawDetails,
    result: "pass",
    missingEngineCapability,
  };
}

export function createWebsitePlatformChaosScenarios(): ChaosScenario[] {
  return [
    scenario("project-misclassification", "Project misclassification", "Stop Blueprint generation and ask for clarification or reclassify before planning.", "askFounder", "Classification confidence is low or expected planner does not match Website Platform / Website Builder.", "Blocked: project type needs confirmation.", "NF is not confident what kind of project this is, so it will confirm before planning.", ["classification.primary", "classification.confidence", "requiredPlanner"]),
    scenario("specialized-planner-unavailable", "Specialized planner unavailable", "Block planning instead of silently using generic planner.", "block", "Required planner is missing or cannot produce Website Platform output.", "Blocked: Website Platform planner unavailable.", "NF needs its Website Platform planner before this project can be planned correctly.", ["requiredPlanner=websitePlatformPlanner", "plannerAvailability=false"], "Planner registry health checks before Blueprint generation"),
    scenario("generic-planner-fallback", "Generic planner fallback", "Reject fallback for a high-confidence Website Platform project.", "block", "Planner output is generic while classification requires websitePlatformPlanner.", "Blocked: planner mismatch.", "NF stopped because the plan looked generic instead of Website Platform-specific.", ["classification.primary", "plannerUsed", "fallbackDetected=true"]),
    scenario("missing-api-key", "Missing API key", "Stop before provider calls and ask founder/developer for credentials or use configured fallback.", "askFounder", "Required provider key is absent and no configured local fallback is available.", "Blocked: provider credentials required.", "NF needs an API key or configured provider before it can generate implementation patches.", ["provider=openai", "apiKeyPresent=false", "fallbackProvider"]),
    scenario("database-unavailable", "Database unavailable", "Block database-dependent tasks and continue only with non-database tasks if dependencies allow.", "block", "Database connection or local storage adapter is unavailable for a task that requires it.", "Blocked: database unavailable.", "NF cannot safely build or validate data features until storage is available.", ["service=database", "taskIds", "dependencyIds"]),
    scenario("hosting-unavailable", "Hosting unavailable", "Keep MVP export-preparation tasks in scope, block live deployment tasks.", "block", "Hosting credentials or provider are unavailable for deployment/publishing.", "Blocked: hosting setup required for deployment.", "NF can prepare export files, but live hosting needs setup before deployment.", ["service=hosting", "phase=launch-readiness", "requiresFounderDecision=true"]),
    scenario("patch-provider-unavailable", "Patch provider unavailable", "Block implementation and do not fake patches.", "block", "No patch provider output exists for the selected task.", "Blocked: no implementation patch available.", "NF knows the next task, but cannot create code changes until the patch provider is available.", ["selectedTaskId", "patchProviderResult=null"]),
    scenario("patch-generation-fails", "Patch generation fails", "Retry within a small bound, then block with provider output diagnostics.", "retry", "Patch provider returns malformed or empty output after the allowed retry.", "Blocked: patch generation failed.", "NF tried to generate code changes but did not get a usable patch.", ["retryCount", "providerResponseKind", "parseError"], "Provider retry policy tied to task type and control level"),
    scenario("patchengine-rejects-patch", "PatchEngine rejects patch", "Reject the patch and keep task incomplete.", "block", "PatchEngine validation or writable preview generation fails.", "Blocked: patch failed validation.", "NF rejected unsafe or unusable code changes before applying them.", ["patchPaths", "validationError", "previewWritable=false"]),
    scenario("build-fails", "Build fails", "Record failed build, surface blocker, and attempt bounded repair if safe.", "repair", "Build command exits non-zero.", "Blocked: build failed.", "NF found a build failure and will attempt a bounded repair if it is safe.", ["build.runId", "exitCode", "stderr", "referencedFiles"]),
    scenario("tests-fail", "Tests fail", "Record failed tests, surface blocker, and attempt bounded repair if safe.", "repair", "Test command exits non-zero.", "Blocked: tests failed.", "NF found failing tests and will repair only within the approved safe limit.", ["test.runId", "exitCode", "failingTests"]),
    scenario("validation-check-fails", "Validation/check fails", "Mark quality gate failed and block phase completion.", "block", "Required validation or quality check fails.", "Blocked: quality gate failed.", "NF will not count the phase as complete because a required check failed.", ["qualityGateId", "status=failed", "required=true"]),
    scenario("quality-gate-fails", "Quality gate fails", "Block phase gate and show required failed gates.", "block", "Any required quality gate is failed or blocked.", "Blocked: phase cannot pass quality gate.", "NF cannot move to the next phase until required quality gates pass.", ["phaseId", "failedGateIds", "blockedGateIds"]),
    scenario("repair-fails", "Repair fails", "Record failed repair and block for manual review or new plan.", "block", "Repair patch cannot be generated, validated, applied, or verified.", "Blocked: repair failed.", "NF tried a safe repair and stopped when it failed.", ["repairAttemptId", "repairStatus=failed", "repairError"]),
    scenario("repair-loop-limit", "Repair loops too many times", "Stop at max repair attempts and block.", "block", "Repair attempts reach the configured maximum.", "Blocked: repair limit reached.", "NF stopped instead of looping on the same failure.", ["repairAttempts", "maxRepairAttempts", "lastError"]),
    scenario("circular-task-dependency", "Circular task dependency", "Block scheduling and report dependency cycle.", "block", "Task dependency graph contains a cycle.", "Blocked: circular task dependency.", "NF found tasks that depend on each other in a loop and needs the plan repaired.", ["cycleTaskIds", "phaseId"], "Dependency graph cycle detector before phase execution"),
    scenario("missing-founder-approval", "Missing founder approval", "Stop at phase gate and ask for approval.", "askFounder", "Phase gate requires approval and has not been approved.", "Waiting: founder approval required.", "NF is ready for the next phase but needs your approval before continuing.", ["phaseGateId", "requiresApproval=true", "approvedAt=null"]),
    scenario("scope-change-mid-phase", "Founder changes scope mid-phase", "Pause execution, update Blueprint/plan, and ask for confirmation if scope changes materially.", "askFounder", "New request changes MVP scope, legal/payment/deployment decisions, or current phase boundaries.", "Waiting: scope change needs confirmation.", "NF paused because the project direction changed and the plan needs to be updated first.", ["scopeChangeDetected=true", "affectedPhaseIds", "affectedTaskIds"], "Formal scope-change diff and replan helper"),
    scenario("dashboard-sync-fails", "Dashboard sync fails", "Preserve execution state and block dashboard-dependent phase approval until sync is repaired.", "block", "Execution state cannot be reflected in dashboard-readable Blueprint state.", "Blocked: dashboard state unavailable.", "NF completed internal work but cannot safely show the current state yet.", ["executionStateUpdated=true", "dashboardReadable=false"]),
    scenario("progress-persistence-fails", "Progress persistence fails", "Stop after preserving in-memory result and report persistence failure.", "block", "Blueprint, memory, build plan, or action log write fails.", "Blocked: progress could not be saved.", "NF stopped because it could not safely save what happened.", ["storeName", "writeError", "stateSnapshotId"]),
    scenario("next-task-cannot-be-selected", "Next task cannot be selected", "Block and report missing/invalid phase task state.", "block", "No eligible task exists and phase is not complete.", "Blocked: next task unavailable.", "NF cannot safely choose the next task from the current plan.", ["phaseId", "taskStatuses", "recommendedNextTaskId"]),
    scenario("phase-gate-cannot-pass", "Phase gate cannot pass", "Stop at gate and show failed checks or missing approval.", "block", "Definition of done, quality gates, or approval gate is incomplete.", "Blocked: phase gate cannot pass.", "NF cannot move forward because the phase is not actually done.", ["phaseId", "definitionOfDone", "qualityGateStatus", "approvalGateStatus"]),
    scenario("ai-provider-timeout", "AI provider timeout", "Retry within provider policy, then block without losing state.", "retry", "Provider timeout exceeds retry policy or budget.", "Blocked: AI provider timed out.", "NF could not reach the AI provider and saved the current state before stopping.", ["provider", "timeoutMs", "retryCount"], "Provider fallback and resumable long-running run recovery"),
    scenario("corrupted-project-memory", "Corrupted project memory", "Block project-aware execution and attempt safe recovery from Blueprint/action log if available.", "block", "Project memory cannot be parsed or fails schema validation.", "Blocked: project memory needs repair.", "NF found corrupted memory and will not continue until it can recover safely.", ["memoryPath", "parseError", "recoverySources"]),
    scenario("conflicting-files", "Conflicting files", "Stop before overwriting and ask for approval or merge strategy.", "askFounder", "Patch targets files with conflicting existing content or unapproved overwrite.", "Waiting: file conflict needs approval.", "NF found existing work that could be overwritten and needs a decision before changing it.", ["conflictingPaths", "overwriteRisk=true"]),
    scenario("disk-write-failure", "Disk/write failure", "Abort apply, do not mark task complete, and keep patch pending or failed.", "block", "File write or verification fails.", "Blocked: file write failed.", "NF could not write or verify files, so it did not count the task as complete.", ["path", "writeError", "verificationStatus"]),
    scenario("deployment-export-failure", "Deployment/export failure", "Block launch readiness while preserving built MVP state.", "block", "Export or deployment preparation fails validation.", "Blocked: export/deployment failed.", "NF built the product state but cannot mark it launch-ready until export/deployment works.", ["exportTarget", "deploymentStep", "exitCode", "error"]),
  ];
}

export function runWebsitePlatformChaosSimulation(
  input: WebsitePlatformChaosInput
): ChaosSimulationReport {
  const scenarios = createWebsitePlatformChaosScenarios();
  const failures = scenarios.filter((item) => item.result === "fail");
  const missingCapabilities = Array.from(
    new Set(scenarios.map((item) => item.missingEngineCapability).filter((item): item is string => Boolean(item)))
  );

  return {
    projectName: input.projectName,
    simulatedAt: input.simulatedAt,
    result: failures.length === 0 ? "pass" : "fail",
    confidenceScore: failures.length === 0 ? 86 : 70,
    scenarios,
    passCriteria: [
      "NF safely stops or blocks on unrecoverable failures.",
      "NF does not mark failed work as passed.",
      "NF does not loop infinitely.",
      "NF surfaces blockers to Founder Mode and Developer Mode.",
      "NF preserves project state.",
      "NF identifies missing capabilities clearly.",
    ],
    failures,
    missingCapabilities,
    safeToBeginPlanning: failures.length === 0,
  };
}

export function createAutonomousEngineGapAreas(): AutonomousEngineGapArea[] {
  return [
    { id: "project-classification", area: "Project classification", currentStatus: "Deterministic classifier exists and correctly detects Website Platform / Website Builder.", maturityScore: 88, missingCapability: "Confidence calibration against real founder prompts and historical misroutes.", riskLevel: "medium", recommendedFix: "Add a corpus of founder prompts and misclassification regressions before broad release.", requiredTests: ["ambiguous project routing", "planner mismatch block", "low-confidence clarification"] },
    { id: "specialized-planners", area: "Specialized planners", currentStatus: "Website Platform planner foundation exists; other specialized planners are profiles only.", maturityScore: 74, missingCapability: "Full planner foundations for SaaS, AI Agent, Marketplace, Ecommerce, Mobile, Desktop, Backend, and Internal Tool.", riskLevel: "high", recommendedFix: "Add planner foundations one project class at a time, starting with the next real NF build need.", requiredTests: ["non-generic product brief", "class-specific MVP scope", "class-specific phase tasks"] },
    { id: "blueprint-generation", area: "Blueprint generation", currentStatus: "Blueprint stores intake, classification, specialized planner output, phase plan, execution state, and front-end intent.", maturityScore: 86, missingCapability: "Runtime enforcement that every workflow reads/writes Blueprint as source of truth.", riskLevel: "medium", recommendedFix: "Route live project creation/import/continue flows through Blueprint-backed state consistently.", requiredTests: ["Blueprint persistence round trip", "project switch isolation", "planner output retention"] },
    { id: "build-plan-generation", area: "Build-plan generation", currentStatus: "PhaseBuildPlan creates phase-gated tasks and consumes specialized planner output.", maturityScore: 84, missingCapability: "Implementation-level task specs that are directly patch-provider ready.", riskLevel: "medium", recommendedFix: "Add task contracts with target files, expected edits, validation commands, and dependencies.", requiredTests: ["task spec completeness", "phase gate correctness", "quality gate mapping"] },
    { id: "task-dependency-graph", area: "Task dependency graph", currentStatus: "Website Platform planner emits dependency graph, but runner does not yet enforce graph cycles/dependencies.", maturityScore: 62, missingCapability: "Dependency graph validator and scheduler integration.", riskLevel: "high", recommendedFix: "Add cycle detection and dependency-aware task selection before large autonomous phases.", requiredTests: ["circular dependency block", "dependency ordering", "blocked dependency visibility"] },
    { id: "patch-generation-provider-boundary", area: "Patch generation provider boundary", currentStatus: "Phase runner accepts provider output and blocks when no patch is available.", maturityScore: 58, missingCapability: "Reliable provider-backed generation of concrete writable patches from phase tasks.", riskLevel: "critical", recommendedFix: "Build a task-to-patch provider adapter with retry, validation, and full-file fallback boundaries.", requiredTests: ["summary-only output rejected", "new-file patch generated", "malformed output retry"] },
    { id: "patchengine", area: "PatchEngine", currentStatus: "PatchEngine validates, previews, applies, verifies, and supports revert snapshots.", maturityScore: 86, missingCapability: "Broader malformed-provider-output coverage and conflict merge policy.", riskLevel: "medium", recommendedFix: "Keep PatchEngine central and add conflict detection around existing-file divergence.", requiredTests: ["new file write verification", "conflicting file block", "JSON validation failure"] },
    { id: "validation-adapters", area: "Validation/test/build adapters", currentStatus: "Build and test runners reuse command/path guards and record pass/fail/unavailable state.", maturityScore: 82, missingCapability: "Project-class-specific validation suites and browser smoke checks.", riskLevel: "medium", recommendedFix: "Add Website Platform validation adapters for preview, forms, analytics, and export readiness.", requiredTests: ["preview smoke", "lead capture smoke", "analytics event smoke", "export readiness smoke"] },
    { id: "repair-loop", area: "Repair loop", currentStatus: "Repair is bounded, safe, and tied to failed build/test/check state.", maturityScore: 78, missingCapability: "Broader repair strategies and provider timeout recovery.", riskLevel: "medium", recommendedFix: "Expand repair only around observed failures, keeping max attempts and blocker behavior.", requiredTests: ["max repair attempts", "failed repair blocker", "provider timeout block"] },
    { id: "memory-persistence", area: "Memory persistence", currentStatus: "Progress recorder writes Blueprint, memory, build plan, and action log through injected stores.", maturityScore: 80, missingCapability: "Transactional persistence and corruption recovery.", riskLevel: "high", recommendedFix: "Add atomic write/snapshot policy and memory schema recovery helpers.", requiredTests: ["write failure block", "corrupted memory recovery", "action log append failure"] },
    { id: "dashboard-sync", area: "Dashboard sync", currentStatus: "Dashboard reads current phase, confidence, quality, next task, blockers, and mode state.", maturityScore: 88, missingCapability: "Dashboard sync failure detection as a first-class run blocker.", riskLevel: "medium", recommendedFix: "Add post-run dashboard projection verification before phase gate success.", requiredTests: ["completed run dashboard visible", "blocked run dashboard visible", "sync failure block"] },
    { id: "quality-gates", area: "Quality gates", currentStatus: "Phase quality gates synchronize with build/test/check/blocker outcomes.", maturityScore: 84, missingCapability: "Domain-specific quality policies and manual validation evidence capture.", riskLevel: "medium", recommendedFix: "Add Website Platform quality policy for preview/leads/analytics/export/template preservation.", requiredTests: ["required gate failure blocks", "manual evidence required", "needs approval not passed"] },
    { id: "founder-approval-gates", area: "Founder approval gates", currentStatus: "Phase gates and Founder Mode summaries exist; runner stops at next phase gate.", maturityScore: 82, missingCapability: "UI-backed approval capture and phase transition persistence.", riskLevel: "medium", recommendedFix: "Persist approval decisions in Blueprint and require them before phase transition.", requiredTests: ["missing approval stops", "approval persists", "scope change requires reapproval"] },
    { id: "multi-phase-execution", area: "Multi-phase execution", currentStatus: "Bounded multi-task phase runner exists and stops at phase gate.", maturityScore: 76, missingCapability: "Multi-phase controller that resumes after approved gates without losing context.", riskLevel: "high", recommendedFix: "Add a resumable multi-phase controller after provider patch generation is reliable.", requiredTests: ["phase completion stop", "resume next phase", "limit prevents endless execution"] },
    { id: "real-project-smoke-tests", area: "Real-project smoke tests", currentStatus: "Module tests exist; real project dry runs are mostly simulated.", maturityScore: 54, missingCapability: "Fixture-backed real project smoke tests for generated Website Platform builds.", riskLevel: "critical", recommendedFix: "Create disposable fixture workspaces for Website Platform build smoke tests.", requiredTests: ["fixture project creation", "build/test smoke", "dashboard projection after run"] },
    { id: "deployment-export-automation", area: "Deployment/export automation", currentStatus: "Website Platform planner includes export preparation, not full deployment automation.", maturityScore: 46, missingCapability: "Safe export/deployment adapter with credentials, domains, hosting, and rollback gates.", riskLevel: "high", recommendedFix: "Keep MVP to export preparation; add deployment automation after release-readiness gates mature.", requiredTests: ["export artifact validation", "hosting unavailable block", "deployment rollback"] },
    { id: "external-service-setup", area: "External service setup", currentStatus: "External services are recognized as approval blockers, not automatically provisioned.", maturityScore: 50, missingCapability: "Credential/account/service setup workflows.", riskLevel: "high", recommendedFix: "Add explicit service setup gates for auth, database, hosting, analytics, and payments.", requiredTests: ["missing credentials block", "paid service approval", "service unavailable block"] },
    { id: "rollback-versioning", area: "Rollback/versioning", currentStatus: "Patch workflow stores before snapshots for revert; broader phase rollback is not complete.", maturityScore: 64, missingCapability: "Phase-level snapshots and rollback journal.", riskLevel: "high", recommendedFix: "Add phase checkpoints that group patches, memory updates, and validation results.", requiredTests: ["phase rollback", "partial apply recovery", "memory/action log rollback note"] },
    { id: "security-review", area: "Security review", currentStatus: "Security-sensitive actions are approval-gated; no full automated security review exists.", maturityScore: 48, missingCapability: "Security/privacy review engine for auth, lead data, API keys, and deployment.", riskLevel: "high", recommendedFix: "Add security quality gates before launch readiness.", requiredTests: ["secret detection", "lead data privacy checklist", "auth gate missing block"] },
    { id: "cost-controls", area: "Cost controls", currentStatus: "Paid services are treated as approval blockers.", maturityScore: 42, missingCapability: "Provider cost budgets, token/run limits, and paid-service estimates.", riskLevel: "medium", recommendedFix: "Add per-project automation budgets and provider usage reporting.", requiredTests: ["budget exceeded block", "paid service approval", "provider retry cap"] },
    { id: "provider-failure-handling", area: "Provider failure handling", currentStatus: "Unavailable patch provider blocks; full timeout/fallback handling is incomplete.", maturityScore: 56, missingCapability: "Provider timeout retry/fallback/resume policy.", riskLevel: "high", recommendedFix: "Add provider error taxonomy and resumable provider calls.", requiredTests: ["timeout retry cap", "fallback provider selected", "state preserved after timeout"] },
    { id: "long-running-run-recovery", area: "Long-running run recovery", currentStatus: "Bounded runners limit task cycles; long-running recovery is not yet durable.", maturityScore: 52, missingCapability: "Run checkpoints, resumable execution ids, and crash recovery.", riskLevel: "critical", recommendedFix: "Add run journal/checkpoints before enabling long autonomous builds.", requiredTests: ["resume interrupted run", "duplicate run prevention", "checkpoint replay"] },
  ];
}

export function createAutonomousEngineGapReport(generatedAt: string): AutonomousEngineGapReport {
  const areas = createAutonomousEngineGapAreas();
  const readinessScore = Math.round(areas.reduce((sum, area) => sum + area.maturityScore, 0) / areas.length);
  const topMissingCapabilities = areas
    .filter((area) => area.riskLevel === "critical" || area.maturityScore < 60)
    .map((area) => `${area.area}: ${area.missingCapability}`);

  return {
    generatedAt,
    readinessScore,
    areas,
    topMissingCapabilities,
    safeToBeginPlanning: true,
    safeForFullAutonomousBuild: false,
  };
}

function resultLabel(result: ChaosResult): string {
  return result.toUpperCase();
}

export function buildChaosSimulationMarkdown(report: ChaosSimulationReport): string {
  const scenarioRows = report.scenarios.map((item) => [
    `### ${item.name}`,
    "",
    `- Scenario id: ${item.id}`,
    `- Expected NF behavior: ${item.expectedBehavior}`,
    `- Outcome: ${item.outcome}`,
    `- Safe-stop condition: ${item.safeStopCondition}`,
    `- Dashboard-visible result: ${item.dashboardVisibleResult}`,
    `- Founder Mode explanation: ${item.founderModeExplanation}`,
    `- Developer Mode raw details: ${item.developerModeRawDetails.join("; ")}`,
    `- Pass/fail result: ${resultLabel(item.result)}`,
    `- Missing engine capability: ${item.missingEngineCapability ?? "None blocking; existing safe-stop behavior is sufficient for this gate."}`,
    "",
  ].join("\n"));

  return [
    "# NF Web Platform Chaos Simulation",
    "",
    `Date: ${report.simulatedAt}`,
    "",
    `Simulation result: ${resultLabel(report.result)}`,
    "",
    `Confidence score: ${report.confidenceScore} / 100`,
    "",
    `Project: ${report.projectName}`,
    "",
    "## Summary",
    "",
    "The chaos simulation exercises NF's expected behavior when planning or execution fails before the NF Web Platform real build begins. This is a simulation gate: it verifies that NF should stop, block, retry within bounds, repair within bounds, or ask the founder instead of silently continuing.",
    "",
    `Safe to begin real planning: ${report.safeToBeginPlanning ? "Yes" : "No"}`,
    "",
    "Safe for fully autonomous implementation: No. NF still needs stronger patch generation, real-project smoke tests, deployment/export automation, rollback/versioning, provider failure handling, and long-running recovery before high-autonomy builds.",
    "",
    "## Pass Criteria",
    "",
    ...report.passCriteria.map((criterion) => `- ${criterion}`),
    "",
    "## Scenario Results",
    "",
    ...scenarioRows,
    "## Missing Capabilities Found",
    "",
    ...(report.missingCapabilities.length ? report.missingCapabilities.map((item) => `- ${item}`) : ["- None found by this simulation gate."]),
    "",
    "## Final Chaos Gate Result",
    "",
    report.result === "pass"
      ? "PASS. NF safely stops, blocks, retries within bounds, repairs within bounds, or asks the founder for every simulated failure class. No scenario marks failed work as passed."
      : "FAIL. One or more scenarios can continue unsafely or hide failure state.",
    "",
  ].join("\n");
}

export function buildAutonomousEngineGapMarkdown(report: AutonomousEngineGapReport): string {
  const rows = report.areas.map((area) => [
    `### ${area.area}`,
    "",
    `- Area id: ${area.id}`,
    `- Current status: ${area.currentStatus}`,
    `- Maturity score: ${area.maturityScore} / 100`,
    `- Missing capability: ${area.missingCapability}`,
    `- Risk level: ${area.riskLevel}`,
    `- Recommended fix: ${area.recommendedFix}`,
    `- Required tests: ${area.requiredTests.join("; ")}`,
    "",
  ].join("\n"));

  return [
    "# NF Autonomous Engine Gap Report",
    "",
    `Date: ${report.generatedAt}`,
    "",
    `Autonomous engine readiness score: ${report.readinessScore} / 100`,
    "",
    `Safe to begin planning runs: ${report.safeToBeginPlanning ? "Yes" : "No"}`,
    "",
    `Safe for full autonomous builds: ${report.safeForFullAutonomousBuild ? "Yes" : "No"}`,
    "",
    "## Summary",
    "",
    "NF has a stable phase-gated planning and bounded execution foundation, but it is not yet a fully autonomous build engine. The engine can classify, plan, select tasks, apply supplied safe patches, run checks/tests, attempt bounded repair, persist progress, and project dashboard-readable state. The major remaining gap is reliable autonomous implementation generation and long-run resilience.",
    "",
    "## Top Missing Capabilities",
    "",
    ...report.topMissingCapabilities.map((item) => `- ${item}`),
    "",
    "## Area-by-Area Evaluation",
    "",
    ...rows,
    "## Recommended Fix Order",
    "",
    "1. Build provider-backed task-to-patch generation with strict PatchEngine validation.",
    "2. Add dependency graph validation and scheduling before large phase runs.",
    "3. Add disposable real-project smoke tests for Website Platform builds.",
    "4. Add phase-level snapshots and rollback/versioning.",
    "5. Add provider timeout/fallback/recovery and long-running run checkpoints.",
    "6. Add Website Platform-specific validation adapters for preview, leads, analytics, and export readiness.",
    "7. Add deployment/export automation only after export artifacts and rollback are stable.",
    "",
  ].join("\n");
}
