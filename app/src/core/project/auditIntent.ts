import type { LivingBuildPlan, ProjectManifest, ProjectMemory } from "../types";
import type { BuildCheckResult } from "./buildCheck";
import type { StoredBuildFailure } from "./buildRepair";

export type AuditMode = "ProjectAudit" | "CodeAudit" | "FileAudit" | "None";

export interface CodeAuditSourceFile {
  path: string;
  content: string;
}

export function detectAuditMode(prompt: string): AuditMode {
  const text = prompt.toLowerCase();
  if (!/\b(audit|report|health|diagnose)\b/.test(text)) return "None";
  if (/\b(save|write|create)\b.*\baudit[_ -]?report\.md\b|\bsave\s+(?:the\s+)?audit\s+report\b/i.test(prompt)) return "ProjectAudit";
  if (/\b(audit|review|diagnose)\s+(?:src\/|app\/|[\w.-]+\.(?:tsx?|jsx?|json|css|html|md))\b/i.test(prompt)) return "FileAudit";
  if (/\b(audit|review|diagnose)\s+(?:the\s+)?(?:code|codebase|file)\b/i.test(prompt) && !/\bproject|entire|health\b/i.test(prompt)) return "CodeAudit";
  if (/\b(audit|diagnose|health|report)\b.*\b(entire\s+project|whole\s+project|project|project\s+health)\b/i.test(prompt)) return "ProjectAudit";
  if (/\bwhat\s+is\s+the\s+health\s+of\s+this\s+project\b/i.test(prompt)) return "ProjectAudit";
  return "None";
}

export function isAuditSaveRequest(prompt: string): boolean {
  return /\b(save|write|create)\b.*\baudit[_ -]?report\.md\b|\bsave\s+(?:the\s+)?audit\s+report\b/i.test(prompt);
}

function activeMilestone(plan: LivingBuildPlan | null): LivingBuildPlan["milestones"][number] | undefined {
  return plan?.milestones.find((milestone) => milestone.id === plan.currentMilestoneId) ?? plan?.milestones[0];
}

function activeTask(plan: LivingBuildPlan | null): LivingBuildPlan["milestones"][number]["tasks"][number] | undefined {
  const milestone = activeMilestone(plan);
  return milestone?.tasks.find((task) => task.id === plan?.currentTaskId) ??
    milestone?.tasks.find((task) => task.status === "next" || task.status === "doing" || task.status === "todo" || task.status === "blocked");
}

function taskCounts(plan: LivingBuildPlan | null): { complete: number; total: number; blocked: number } {
  const tasks = plan?.milestones.flatMap((milestone) => milestone.tasks) ?? [];
  return {
    complete: tasks.filter((task) => task.status === "done").length,
    total: tasks.length,
    blocked: tasks.filter((task) => task.status === "blocked").length,
  };
}

function percent(complete: number, total: number): number {
  if (!total) return 0;
  return Math.round((complete / total) * 100);
}

function currentBuildPlanProgress(plan: LivingBuildPlan | null): string {
  const counts = taskCounts(plan);
  if (!counts.total) return "Current build plan progress: unknown; no tasks are saved in the living build plan.";
  return `Current build plan progress: ${counts.complete}/${counts.total} tasks complete (${percent(counts.complete, counts.total)}%). This is task completion for the active local build plan only.`;
}

function hasFounderVision(memory: ProjectMemory | null): boolean {
  const text = [
    memory?.fullIdea,
    memory?.summary,
    memory?.architectureNotes?.join(" "),
    memory?.todos?.map((todo) => todo.text).join(" "),
  ].filter(Boolean).join(" ");
  return text.trim().length > 180 || /\b(founder|vision|mvp|customer|startup|platform|operating system)\b/i.test(text);
}

function founderVisionCompletion(memory: ProjectMemory | null, plan: LivingBuildPlan | null): string {
  if (!hasFounderVision(memory)) {
    return "Founder vision completion: unknown; no detailed founder specification is loaded.";
  }
  const counts = taskCounts(plan);
  const taskPercent = percent(counts.complete, counts.total);
  if (taskPercent >= 100 && counts.total <= 25) {
    return "Founder vision completion: low. The saved local build plan may be complete, but it appears to cover scaffold/prototype work rather than the full intended product vision.";
  }
  if (taskPercent >= 60) {
    return "Founder vision completion: partial. Several build-plan tasks are done, but this should not be treated as full product completion.";
  }
  return "Founder vision completion: low. The project is still early relative to the founder specification.";
}

function developmentPhase(milestoneName: string | undefined, counts: { complete: number; total: number }): string {
  const name = milestoneName?.toLowerCase() ?? "";
  if (name.includes("scaffold") && counts.total > 0 && counts.complete === counts.total) return "Foundation Complete";
  if (name.includes("scaffold") || name.includes("foundation")) return "Foundation";
  if (name.includes("core")) return "Core Experience";
  if (name.includes("integration")) return "Integrations";
  if (name.includes("test") || name.includes("validation")) return "Testing";
  if (name.includes("polish") || name.includes("reliability")) return "Polish";
  return milestoneName || "Foundation";
}

function estimatedRemainingTime(plan: LivingBuildPlan | null): string {
  const counts = taskCounts(plan);
  const remaining = Math.max(0, counts.total - counts.complete);
  if (!counts.total) return "Unknown until a living build plan exists.";
  if (remaining === 0) return "0 days for the current build-plan task list; choose the next milestone or expand the plan.";
  if (remaining <= 3) return "1-3 days for the current engineering task list.";
  if (remaining <= 10) return "1-2 weeks for the current engineering task list.";
  return "Several weeks for the current engineering task list.";
}

function founderMvpPercent(memory: ProjectMemory | null, plan: LivingBuildPlan | null): number {
  if (!hasFounderVision(memory)) return 0;
  const counts = taskCounts(plan);
  const taskPercent = percent(counts.complete, counts.total);
  if (taskPercent >= 100 && counts.total <= 25) return 18;
  if (taskPercent >= 75) return 45;
  if (taskPercent >= 40) return 28;
  return 12;
}

function founderMvpStatus(mvpPercent: number): string {
  if (mvpPercent >= 85) return "MVP Candidate";
  if (mvpPercent >= 70) return "Public Beta";
  if (mvpPercent >= 55) return "Private Beta";
  if (mvpPercent >= 40) return "Founder Alpha";
  if (mvpPercent >= 20) return "Internal Alpha";
  if (mvpPercent > 0) return "Prototype";
  return "Planning";
}

function founderMvpFeatures(memory: ProjectMemory | null, plan: LivingBuildPlan | null): {
  completed: string;
  inProgress: string;
  remaining: string;
} {
  const completedSteps = plan?.completedSteps.map((step) => step.completed).filter(Boolean).slice(-5) ?? [];
  const completedTasks = plan?.milestones
    .flatMap((milestone) => milestone.tasks)
    .filter((task) => task.status === "done")
    .map((task) => task.title)
    .slice(-5) ?? [];
  const task = activeTask(plan);
  const remainingTodos = (memory?.todos ?? [])
    .filter((todo) => todo.status !== "done")
    .map((todo) => todo.text)
    .slice(0, 5) ?? [];
  return {
    completed: [...completedSteps, ...completedTasks].slice(0, 5).join("; ") || "No founder-MVP features are confirmed complete yet.",
    inProgress: task?.title || "No active feature task selected.",
    remaining: remainingTodos.join("; ") || "Founder workflow validation, testing, onboarding, persistence, and release hardening still need confirmation against the full MVP definition.",
  };
}

function mvpReadiness(input: {
  projectMemory: ProjectMemory | null;
  livingBuildPlan: LivingBuildPlan | null;
  latestBuildResult: BuildCheckResult | null;
  manifest: ProjectManifest | null;
}): string {
  const counts = taskCounts(input.livingBuildPlan);
  const taskPercent = percent(counts.complete, counts.total);
  const hasTests = input.manifest?.fileList.some((file) => /\.(test|spec)\.(tsx?|jsx?)$/i.test(file)) ?? false;
  const buildPassing = input.latestBuildResult?.exitCode === 0;
  if (!buildPassing) return "MVP readiness: not ready. Build health is not verified as passing.";
  if (taskPercent >= 100 && hasFounderVision(input.projectMemory) && counts.total <= 25) {
    return "MVP readiness: scaffold/prototype only. The scaffold plan may be complete, but the broader MVP still needs feature validation, tests, and founder acceptance.";
  }
  if (taskPercent >= 80 && hasTests) return "MVP readiness: MVP candidate. Validate the real founder workflow before treating it as releasable.";
  if (taskPercent >= 50) return "MVP readiness: prototype. Core work exists, but it is not yet a real MVP.";
  return "MVP readiness: not ready. Continue core feature implementation and verification.";
}

function productVisionPercent(mvpPercent: number): number {
  if (mvpPercent >= 85) return 30;
  if (mvpPercent >= 40) return 14;
  if (mvpPercent > 0) return 6;
  return 0;
}

function currentProductStage(visionPercent: number): string {
  if (visionPercent >= 75) return "Platform";
  if (visionPercent >= 55) return "Enterprise";
  if (visionPercent >= 35) return "V2";
  if (visionPercent >= 20) return "V1";
  if (visionPercent >= 8) return "MVP";
  return "Prototype";
}

function longTermVision(memory: ProjectMemory | null): string {
  const text = memory?.fullIdea?.trim() || memory?.summary?.trim() || "";
  if (!text) return "No long-term founder vision is saved yet.";
  return text.length > 220 ? `${text.slice(0, 217)}...` : text;
}

function qualityMetrics(input: {
  latestBuildResult: BuildCheckResult | null;
  latestFailure: StoredBuildFailure | null;
  manifest: ProjectManifest | null;
}): {
  testingCoverage: string;
  documentation: string;
  criticalBugs: string;
  technicalDebt: string;
  architectureHealth: string;
  confidenceScore: string;
} {
  const files = input.manifest?.fileList ?? [];
  const sourceCount = files.filter((file) => /\.(tsx?|jsx?)$/i.test(file)).length;
  const testCount = files.filter((file) => /\.(test|spec)\.(tsx?|jsx?)$/i.test(file)).length;
  const docCount = files.filter((file) => /(^|\/)(readme|docs\/|documentation)/i.test(file)).length;
  const testingPercent = sourceCount ? Math.min(100, Math.round((testCount / sourceCount) * 100)) : 0;
  const buildPassing = input.latestBuildResult?.exitCode === 0;
  const confidence = buildPassing ? Math.max(45, Math.min(82, 55 + testingPercent)) : Math.max(20, Math.min(50, 35 + testingPercent));
  return {
    testingCoverage: `Testing coverage: ${testingPercent}% estimated by test/source file ratio (${testCount}/${sourceCount || 0}).`,
    documentation: `Documentation: ${docCount > 0 ? "present" : "thin or not detected"}.`,
    criticalBugs: `Known critical bugs: ${input.latestFailure ? input.latestFailure.errorLines.slice(0, 3).join("; ") || "latest build failure recorded" : "none recorded in the latest build state"}.`,
    technicalDebt: "Technical debt: keep patch scope small, remove stale proposals, and add regressions around repaired build failures.",
    architectureHealth: buildPassing ? "Architecture health: workable for the current phase; keep structure simple until the core flow is stable." : "Architecture health: blocked by build health; fix compile/runtime failures before adding structure.",
    confidenceScore: `Confidence score: ${confidence}%.`,
  };
}

function launchProgress(input: {
  latestBuildResult: BuildCheckResult | null;
  latestFailure: StoredBuildFailure | null;
  manifest: ProjectManifest | null;
}): {
  buildStability: string;
  qaStatus: string;
  analytics: string;
  authentication: string;
  payments: string;
  monitoring: string;
  legal: string;
  deployment: string;
  readiness: string;
} {
  const files = input.manifest?.fileList ?? [];
  const has = (pattern: RegExp) => files.some((file) => pattern.test(file));
  const risks: string[] = [];
  if (input.latestFailure || input.latestBuildResult?.exitCode !== 0) risks.push("build status is failing or not verified");
  const hasTests = input.manifest?.fileList.some((file) => /\.(test|spec)\.(tsx?|jsx?)$/i.test(file)) ?? false;
  if (!hasTests) risks.push("no test files detected");
  if (!(input.manifest?.configFiles.length ?? 0)) risks.push("configuration files are not clearly detected");
  const readiness = risks.length
    ? `Launch readiness: Not Ready (0%). Blockers/risks: ${risks.join("; ")}.`
    : "Launch readiness: Internal Testing (20%). Build structure is present, but release packaging, QA, onboarding, and deployment checks still need review.";
  return {
    buildStability: `Build stability: ${input.latestBuildResult?.exitCode === 0 ? "passing" : "failing or unverified"}.`,
    qaStatus: `QA status: ${hasTests ? "basic automated tests detected" : "not ready; no tests detected"}.`,
    analytics: `Analytics: ${has(/analytics|posthog|segment|amplitude|mixpanel/i) ? "detected" : "not detected"}.`,
    authentication: `Authentication: ${has(/auth|login|session|supabase|firebase/i) ? "detected" : "not detected"}.`,
    payments: `Payments: ${has(/stripe|payment|checkout|billing/i) ? "detected" : "not detected"}.`,
    monitoring: `Monitoring: ${has(/sentry|monitor|log|observability/i) ? "detected" : "not detected"}.`,
    legal: `Legal: ${has(/privacy|terms|legal/i) ? "detected" : "not detected"}.`,
    deployment: `Deployment: ${has(/dockerfile|vercel|netlify|fly\.toml|render\.yaml|deployment/i) ? "detected" : "not detected"}.`,
    readiness,
  };
}

function latestBuildSummary(latestBuildResult: BuildCheckResult | null, latestFailure: StoredBuildFailure | null): string {
  if (latestBuildResult) {
    return [
      `Latest command: ${latestBuildResult.command}`,
      `CWD: ${latestBuildResult.workingDirectory}`,
      `Exit code: ${latestBuildResult.exitCode}`,
      latestBuildResult.exitCode === 0 ? "Build status: passing." : "Build status: failing.",
    ].join("\n");
  }
  if (latestFailure) {
    return [
      `Latest command: ${latestFailure.command}`,
      `CWD: ${latestFailure.cwd}`,
      `Exit code: ${latestFailure.exitCode}`,
      latestFailure.errorLines.length ? `Errors:\n${latestFailure.errorLines.join("\n")}` : "Errors: no parsed TypeScript errors.",
    ].join("\n");
  }
  return "No build check has been recorded in this session.";
}

function riskyFiles(manifest: ProjectManifest | null): string {
  const files = manifest?.fileList ?? [];
  const risky = files.filter((file) =>
    /src\/main\.(tsx?|jsx?)$|src\/App\.(tsx?|jsx?)$|package\.json|tsconfig.*\.json|vite\.config\./i.test(file)
  ).slice(0, 8);
  return risky.length ? risky.join(", ") : "No specific risky files identified from the manifest.";
}

export function selectCodeAuditFiles(manifest: ProjectManifest | null): string[] {
  const files = manifest?.fileList ?? [];
  const sourceFiles = files.filter((file) => /\.(tsx?|jsx?|css|html)$/i.test(file));
  const preferred = sourceFiles.filter((file) =>
    /src\/main\.(tsx?|jsx?)$|src\/App\.(tsx?|jsx?)$|src\/index\.(tsx?|jsx?)$/i.test(file)
  );
  return [...new Set([...preferred, ...sourceFiles])].slice(0, 6);
}

export function inspectSourceFilesForCodeAudit(sourceFiles: CodeAuditSourceFile[]): string[] {
  const findings: string[] = [];
  for (const file of sourceFiles) {
    const lines = file.content.split(/\r?\n/);
    const add = (finding: string) => findings.push(`${file.path}: ${finding}`);
    if (lines.length > 220) add(`large file (${lines.length} lines); review whether UI, state, and domain logic are doing too much in one place.`);
    if (/\binnerHTML\b/.test(file.content)) add("uses innerHTML; verify all inserted content is trusted or replace with safer rendering.");
    if (/\bquerySelector|getElementById\b/.test(file.content)) add("uses direct DOM lookup; check null handling and avoid duplicating React/state ownership.");
    if (/\bas\s+any\b|:\s*any\b|<any>/.test(file.content)) add("uses `any`; tighten types where the value crosses component or API boundaries.");
    if (/\bTODO\b|\bFIXME\b|\bHACK\b/i.test(file.content)) add("contains TODO/FIXME/HACK markers that should be resolved or tracked before release.");
    if (/\bconsole\.(log|warn|error)\b/.test(file.content)) add("contains console logging; decide what should remain in production diagnostics.");
    if (/\bfetch\s*\(/.test(file.content) && !/try\s*{/.test(file.content)) add("uses fetch without obvious local try/catch handling in this file.");
    if (/\buseEffect\s*\(/.test(file.content) && !/return\s*\(\s*\)\s*=>/.test(file.content)) add("uses useEffect without an obvious cleanup; verify subscriptions/timers/listeners cannot leak.");
  }
  return findings.slice(0, 10);
}

export function buildProjectAuditReport(input: {
  workspacePath: string;
  projectMemory: ProjectMemory | null;
  livingBuildPlan: LivingBuildPlan | null;
  manifest: ProjectManifest | null;
  latestBuildResult: BuildCheckResult | null;
  latestFailure: StoredBuildFailure | null;
}): string {
  const milestone = activeMilestone(input.livingBuildPlan);
  const task = activeTask(input.livingBuildPlan);
  const counts = taskCounts(input.livingBuildPlan);
  const developmentPercent = percent(counts.complete, counts.total);
  const mvpPercent = founderMvpPercent(input.projectMemory, input.livingBuildPlan);
  const visionPercent = productVisionPercent(mvpPercent);
  const mvpFeatures = founderMvpFeatures(input.projectMemory, input.livingBuildPlan);
  const quality = qualityMetrics(input);
  const launch = launchProgress(input);
  const blockedTasks = input.livingBuildPlan?.milestones
    .flatMap((item) => item.tasks.map((taskItem) => ({ milestone: item.name, task: taskItem })))
    .filter((entry) => entry.task.status === "blocked") ?? [];
  const latestFailureLines = input.latestFailure?.errorLines.slice(0, 6) ?? [];
  const projectName = input.projectMemory?.name || input.workspacePath.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "Current project";
  const riskLevel = input.latestBuildResult?.exitCode === 0 ? "Medium" : input.latestFailure ? "High" : "Medium";
  const confidence = input.livingBuildPlan ? "72%" : "55%";

  return [
    `Project Audit Report: ${projectName}`,
    `Path: ${input.workspacePath}`,
    "",
    "Development Progress",
    `Development phase: ${developmentPhase(milestone?.name, counts)}`,
    `Current milestone: ${milestone?.name ?? "Not set"}`,
    `Current task: ${task?.title ?? "Not set"}`,
    `Development build plan: ${developmentPercent}% (${counts.complete}/${counts.total} tasks complete). Scope: active engineering build plan only.`,
    currentBuildPlanProgress(input.livingBuildPlan),
    `Estimated remaining time: ${estimatedRemainingTime(input.livingBuildPlan)}`,
    `Build health: ${input.latestBuildResult?.exitCode === 0 ? "Passing" : input.latestFailure || input.latestBuildResult ? "Failing" : "Unknown"}`,
    `Build health details:\n${latestBuildSummary(input.latestBuildResult, input.latestFailure)}`,
    latestFailureLines.length ? `Latest failing errors:\n${latestFailureLines.join("\n")}` : "Latest failing errors: none recorded.",
    `Safe to continue: ${input.latestBuildResult?.exitCode === 0 ? "Yes, build is currently passing." : "Use caution; verify/fix build errors before stacking more changes."}`,
    `Blocked tasks: ${counts.blocked}${blockedTasks.length ? ` (${blockedTasks.map((entry) => `${entry.task.title} in ${entry.milestone}`).join("; ")})` : ""}`,
    "",
    "Founder MVP Progress",
    `Founder MVP progress: ${mvpPercent}%. Scope: founder-intended MVP, not scaffold or task-list completion.`,
    `Completed MVP features: ${mvpFeatures.completed}`,
    `Features in progress: ${mvpFeatures.inProgress}`,
    `Remaining MVP features: ${mvpFeatures.remaining}`,
    `Status: ${founderMvpStatus(mvpPercent)}`,
    mvpReadiness(input),
    "",
    "Product Vision Progress",
    `Vision completion: ${visionPercent}%. Scope: long-term product/company vision.`,
    `Current product stage: ${currentProductStage(visionPercent)}`,
    `Long-term vision: ${longTermVision(input.projectMemory)}`,
    `Next major milestone: ${input.livingBuildPlan?.nextRecommendedStep || task?.title || "Define the next milestone."}`,
    founderVisionCompletion(input.projectMemory, input.livingBuildPlan),
    "",
    "Quality Progress",
    quality.testingCoverage,
    quality.documentation,
    quality.criticalBugs,
    quality.technicalDebt,
    quality.architectureHealth,
    quality.confidenceScore,
    "",
    "Launch Readiness",
    launch.buildStability,
    launch.qaStatus,
    launch.analytics,
    launch.authentication,
    launch.payments,
    launch.monitoring,
    launch.legal,
    launch.deployment,
    launch.readiness,
    "",
    "Architecture Review",
    `Detected project types: ${input.manifest?.projectTypes.join(", ") || "Unknown"}`,
    `Config files: ${input.manifest?.configFiles.join(", ") || "None detected"}`,
    "Architecture fit: keep structure simple until the current milestone is stable; avoid adding broad abstractions before the core flow passes build checks.",
    "Missing structural pieces: confirm tests, error handling, and persistence boundaries as the build plan reaches validation/storage tasks.",
    "Premature complexity warning: avoid adding multi-layer routing or service abstractions until the primary flow is working.",
    "",
    "Roadmap Alignment",
    `Build-plan alignment: ${task ? `Current work should focus on "${task.title}".` : "No actionable task is selected."}`,
    `Next recommended step: ${input.livingBuildPlan?.nextRecommendedStep || task?.title || "Create or repair the living build plan."}`,
    "Order check: finish build-breaking fixes before continuing feature work.",
    "",
    "Technical Debt",
    `Risky files to watch: ${riskyFiles(input.manifest)}`,
    "Code quality issues: review DOM/nullability assumptions, centralize repeated validation, and keep patch scope tied to the current task.",
    "Missing tests: add focused regression tests around build errors, project routing, and current milestone behavior.",
    "Maintainability risks: avoid stale pending patches and ensure every build-fix patch is verified by a fresh build check.",
    "",
    "Code Findings",
    "Code-level findings are included here only as a section of the project audit. A deeper file/code audit should be requested separately with a specific file or \"audit code\".",
    "",
    "Founder Summary",
    `What is going well: development build-plan tracking is ${developmentPercent}% for its own scope, with active milestone/task context preserved.`,
    `Needs attention: ${input.latestFailure ? "latest build failure should be resolved before new feature work." : "keep build status verified after the next patch."}`,
    `Risk level: ${riskLevel}`,
    `Confidence score: ${confidence}`,
    `What to do next: ${input.livingBuildPlan?.nextRecommendedStep || "Run a build check, then continue the current task."}`,
  ].join("\n");
}

export function buildCodeAuditReport(input: {
  workspacePath: string;
  manifest: ProjectManifest | null;
  latestFailure: StoredBuildFailure | null;
  sourceFiles?: CodeAuditSourceFile[];
}): string {
  const risky = riskyFiles(input.manifest);
  const sourceFiles = input.manifest?.fileList.filter((file) => /\.(tsx?|jsx?)$/i.test(file)).slice(0, 12) ?? [];
  const concreteFindings = inspectSourceFilesForCodeAudit(input.sourceFiles ?? []);
  const errorLines = input.latestFailure?.errorLines.slice(0, 6) ?? [];
  return [
    "Code Audit Report",
    `Path: ${input.workspacePath}`,
    "",
    "Code/File Findings",
    `Source files sampled from manifest: ${sourceFiles.length ? sourceFiles.join(", ") : "No source files available in manifest."}`,
    concreteFindings.length
      ? `Concrete file findings:\n${concreteFindings.map((finding) => `- ${finding}`).join("\n")}`
      : "Concrete file findings: no source file contents were available to inspect.",
    `Risky files to inspect first: ${risky}`,
    errorLines.length ? `Current compiler errors:\n${errorLines.join("\n")}` : "Current compiler errors: none recorded in the latest build state.",
    "",
    "Code Quality Risks",
    "- Watch nullability and DOM/query assumptions.",
    "- Keep build-fix patches scoped to the failing file and first compiler error.",
    "- Avoid stacking patches before rerunning the build.",
    "",
    "Maintainability Risks",
    "- Add regression tests around any repaired build failure.",
    "- Keep validation and request parsing centralized as API behavior grows.",
    "- Avoid unrelated package/tsconfig changes unless the build error points there.",
    "",
    "Recommended Next Code Review Step",
    errorLines.length
      ? "Fix the first compiler error, apply the patch, then rerun the build check."
      : "Run a build check, then audit the highest-risk source file if failures appear.",
  ].join("\n");
}
