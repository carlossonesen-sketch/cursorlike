import type { NewProjectDraft } from "../types";
import { generateLockedPlanningModeResponse } from "./projectCreationWizard";
import {
  createMenuProjectCreationState,
  createProjectCreationState,
  projectCreationStateToDraft,
  updateProjectCreationStateFromPrompt,
  type ProjectCreationState,
} from "./projectCreationState";
import { isUnresolvedProjectName } from "./projectIdentity";
import { extractStructuredProjectFields } from "./structuredFieldExtraction";
import {
  type ActiveProjectContext,
  isEstablishedProjectWorkspace,
  isExplicitCreateNewProjectIntent,
  shouldBlockNewProjectRouting,
} from "../project/activeProjectContext";

export function detectSimpleProjectIdea(prompt: string): boolean {
  const normalized = prompt.trim();
  if (!normalized || normalized.length > 700) return false;
  return (
    /^\s*(?:i\s+(?:want|need)|build\s+me|make\s+me|create|build|make)\b/i.test(normalized) &&
    /\b(app|website|site|store|tracker|crm|chatbot|tool|page|platform|dashboard|generator|manager|landing|e-?commerce)\b/i.test(normalized)
  );
}

export function detectNewProjectIntent(prompt: string): boolean {
  return (
    /\b(create|start|build|creation|make)\b/i.test(prompt) &&
    /\b(new\s+(?:NF\s+)?project|project\s+creation|project\s+(?:called|named)|app\s+called|game\s+called|site\s+called|website\s+called|tool\s+called)\b/i.test(prompt)
  ) || detectNewProjectDetails(prompt) || detectSimpleProjectIdea(prompt);
}

export function createNewProjectDraftFromPrompt(prompt: string, source: "menu" | "prompt"): NewProjectDraft {
  return projectCreationStateToDraft(createProjectCreationStateFromPrompt(prompt, source), source);
}

export function createProjectCreationStateFromPrompt(
  prompt: string,
  source: "menu" | "prompt"
): ProjectCreationState {
  if (source === "menu" && !prompt.trim()) {
    return createMenuProjectCreationState();
  }
  return createProjectCreationState({ founderPrompt: prompt.trim(), source });
}

export function detectNewProjectDetails(prompt: string): boolean {
  return (
    /(?:\*\*)?Project\s+Name(?:\*\*)?\s*:/i.test(prompt) ||
    /(?:\*\*)?Save\s+Path(?:\*\*)?\s*:/i.test(prompt) ||
    /^\s*(?:[-*•]\s*)?(?:Project\s+(?:Name|Type|Purpose)|Save\s+Path)\s*(?::|-)/im.test(prompt)
  );
}

export function parseProjectNameSupply(prompt: string): string | null {
  const trimmed = prompt.trim();
  if (!trimmed) return null;
  const patterns = [
    /^\s*(?:add|set|use)\s+project\s+name\s*(?::|-)?\s+(.+)$/i,
    /^\s*project\s+name\s*:\s*(.+)$/i,
    /^\s*(?:call|name)\s+it\s+(.+)$/i,
    /^\s*(?:the\s+)?name\s+(?:is|should\s+be)\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) {
      const value = match[1].trim().replace(/[.?!]+$/g, "");
      return value.length >= 2 && value.length <= 80 ? value : null;
    }
  }
  return null;
}

export function detectProjectNameSupplyIntent(prompt: string): boolean {
  return parseProjectNameSupply(prompt) !== null;
}

export function applyProjectNameToCreationState(
  existing: ProjectCreationState,
  projectName: string
): ProjectCreationState {
  const trimmed = projectName.trim();
  if (!trimmed) return existing;
  return updateProjectCreationStateFromPrompt(existing, `Project Name: ${trimmed}`);
}

export function detectFounderSpecificationIntent(prompt: string): boolean {
  const normalized = prompt.trim();
  if (!normalized) return false;
  const planningPhrase =
    /\b(full founder vision|founder vision|master build plan|do not write code|phased build plan|mvp scope|expected build plan format|founder owns the vision|never finished owns the execution plan|executive build summary|architecture recommendation|founder action list)\b/i;
  const structuredLines = normalized.split(/\r?\n/).filter((line) => /^\s*(?:#{1,3}\s+|[-*]\s+|\d+[.)]\s+|[A-Z][A-Za-z ]{2,}:)/.test(line)).length;
  return planningPhrase.test(normalized) || (normalized.length > 700 && structuredLines >= 4);
}

const PLANNING_TITLE_BLOCKLIST = /^(full founder vision|founder vision|master build plan|executive build summary|phased build plan|mvp definition|architecture recommendation|founder action list)$/i;

function hasExtractableProjectIdentity(prompt: string, existing: ProjectCreationState | null): boolean {
  const merged = existing ? `${existing.fullFounderPrompt}\n${prompt}` : prompt;
  const fields = extractStructuredProjectFields(merged);
  if (
    !isUnresolvedProjectName(fields.projectName.value) &&
    !PLANNING_TITLE_BLOCKLIST.test(fields.projectName.value.trim())
  ) {
    return true;
  }
  if (existing && !isUnresolvedProjectName(existing.projectName)) return true;
  return /\bwebsite\s+(platform|builder)|industry\s+templates?|layout\s+templates?/i.test(merged) && merged.length > 120;
}

export type NewProjectWorkflowRoute = "project_creation" | "founder_specification" | "other";

export function routeNewProjectWorkflow(
  prompt: string,
  existing: ProjectCreationState | NewProjectDraft | null,
  activeProject?: ActiveProjectContext | null
): NewProjectWorkflowRoute {
  const state = existing && "discoveryIntake" in existing ? existing : null;
  const draft = existing && "ideaText" in existing ? existing : null;

  if (
    activeProject &&
    shouldBlockNewProjectRouting(prompt, activeProject, Boolean(state || draft))
  ) {
    return "other";
  }

  if (detectNewProjectIntent(prompt) || detectNewProjectDetails(prompt)) {
    if (activeProject && isEstablishedProjectWorkspace(activeProject) && !isExplicitCreateNewProjectIntent(prompt) && !state && !draft) {
      return "other";
    }
    return "project_creation";
  }

  if (state?.needsProjectName && detectProjectNameSupplyIntent(prompt)) {
    return "project_creation";
  }

  if (state?.needsProjectName && prompt.trim().length > 0 && prompt.trim().length <= 80 && !/\n/.test(prompt)) {
    return "project_creation";
  }

  if (detectSimpleProjectIdea(prompt) && !state && !draft) {
    return "project_creation";
  }

  if (detectFounderSpecificationIntent(prompt)) {
    if (state?.lockedPlanner === "websitePlatformPlanner" || hasExtractableProjectIdentity(prompt, state)) {
      return "project_creation";
    }
    if (state || draft) {
      return "founder_specification";
    }
    if (hasExtractableProjectIdentity(prompt, null)) {
      return "project_creation";
    }
    return "founder_specification";
  }

  return "other";
}

export function updateNewProjectDraftFromPrompt(existing: NewProjectDraft | null, prompt: string): NewProjectDraft {
  const state = existing
    ? updateProjectCreationStateFromPrompt(
        createProjectCreationState({
          founderPrompt: existing.ideaText,
          existingDraft: existing,
          source: existing.createdFrom,
        }),
        prompt
      )
    : updateProjectCreationStateFromPrompt(null, prompt);
  return projectCreationStateToDraft(state, existing?.createdFrom === "menu" ? "prompt" : existing?.createdFrom ?? "prompt");
}

export function updateProjectCreationState(
  existing: ProjectCreationState | null,
  prompt: string
): ProjectCreationState {
  return updateProjectCreationStateFromPrompt(existing, prompt);
}

export function shouldHandleNewProjectMessage(
  prompt: string,
  existing: ProjectCreationState | NewProjectDraft | null,
  activeProject?: ActiveProjectContext | null
): boolean {
  return routeNewProjectWorkflow(prompt, existing, activeProject) === "project_creation";
}

function extractLabeledValues(prompt: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of prompt.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:[-*•]\s*)?([A-Za-z][A-Za-z ]{2,})\s*(?::|-)\s*(.+)$/);
    if (match?.[1] && match[2]) values[match[1].trim().toLowerCase()] = match[2].trim();
  }
  return values;
}

function inferExternalServices(prompt: string): string[] {
  const text = prompt.toLowerCase();
  const services = [
    ["OpenAI or model provider", /\b(openai|claude|gemini|grok|deepseek|llm|ai model)\b/],
    ["Authentication", /\b(auth|login|sign in|account)\b/],
    ["Database", /\b(database|postgres|supabase|firebase|sqlite|storage)\b/],
    ["Payments", /\b(stripe|payment|billing|subscription)\b/],
    ["Email", /\b(email|sendgrid|mailgun|smtp)\b/],
    ["Analytics", /\b(analytics|metrics|tracking)\b/],
    ["Hosting", /\b(hosting|deploy|vercel|netlify|cloudflare|aws)\b/],
  ] as const;
  return services.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

function inferFeatures(prompt: string): string[] {
  const lines = prompt
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter((line) => line.length > 0);
  const featureLines = lines.filter((line) =>
    /\b(feature|workflow|user can|nf should|must|should|dashboard|agent|memory|plan|project|founder)\b/i.test(line)
  );
  return [...new Set(featureLines)].slice(0, 8);
}

function estimateBuildTime(prompt: string, features: string[], services: string[]): string {
  const complexity = prompt.length + features.length * 180 + services.length * 220;
  if (complexity > 7000) return "8-12 weeks for a clean public MVP, assuming focused scope and weekly founder review checkpoints.";
  if (complexity > 3500) return "4-6 weeks for a clean public MVP, assuming the V1 scope stays tight.";
  return "2-4 weeks for a focused MVP, depending on external service setup and design polish.";
}

export function generateFounderSpecificationPlan(
  stateOrDraft: ProjectCreationState | NewProjectDraft,
  prompt: string
): string {
  const state =
    "discoveryIntake" in stateOrDraft
      ? stateOrDraft
      : createProjectCreationState({
          founderPrompt: `${stateOrDraft.ideaText}\n${prompt}`.trim(),
          existingDraft: stateOrDraft,
          source: stateOrDraft.createdFrom,
        });
  const draft = projectCreationStateToDraft(state, state.createdFrom);
  const lockedPlannerResponse = generateLockedPlanningModeResponse(draft, prompt, state.discoveryIntake);
  if (lockedPlannerResponse) return lockedPlannerResponse;

  const labels = extractLabeledValues(`${state.fullFounderPrompt}\n${prompt}`);
  const projectType = labels["project type"] ?? "Founder-first software product";
  const projectPurpose = labels["project purpose"] ?? "Turn the founder vision into a focused MVP.";
  const features = inferFeatures(prompt);
  const services = inferExternalServices(prompt);
  const estimate = estimateBuildTime(prompt, features, services);
  const featureList = features.length
    ? features.map((feature) => `- ${feature}`).join("\n")
    : "- Founder-first project workspace\n- Living build plan\n- Project memory and resume state\n- Manual approval before file changes";
  const serviceList = services.length
    ? services.map((service) => `- ${service}`).join("\n")
    : "- None confirmed yet; validate auth, storage, AI provider, hosting, and analytics before implementation.";

  return [
    "Planning Mode: Founder Specification",
    "",
    "Executive Build Summary",
    `${state.projectName} is a ${projectType} focused on: ${projectPurpose}`,
    `Total estimated build time: ${estimate}`,
    "Estimated MVP time: 2-4 weeks for the first founder-testable version, then additional time for polish, packaging, and release readiness.",
    "No code or files should be written until the founder approves the plan.",
    "",
    "Phased Build Plan",
    "Phase 1: Lock MVP scope, success metric, user roles, and non-goals.",
    "Phase 2: Define architecture, data model, memory boundaries, and external service choices.",
    "Phase 3: Build the smallest working founder workflow end to end.",
    "Phase 4: Add reliability, error handling, onboarding, and resume behavior.",
    "Phase 5: Polish demo flow, run checks, and prepare release packaging.",
    "",
    "MVP Definition",
    `The MVP should prove the core ${state.projectName} workflow with the fewest screens and decisions possible. It should include only the features needed to show the product can guide a founder from intent to a usable outcome.`,
    "",
    "Architecture Recommendation",
    "Use a local-first project workspace with explicit project memory, a living build plan, action logs, and approval-gated file changes. Keep project creation, founder specification, planning, and coding as separate workflow states.",
    "",
    "Founder Specification Extract",
    featureList,
    "",
    "External Services Required",
    serviceList,
    "",
    "External Setup Tasks",
    "- Confirm required accounts, API keys, redirect URLs, billing limits, and deployment targets before implementation depends on them.",
    "",
    "Founder Manual Testing Checkpoints",
    "- Approve MVP definition before files are generated.",
    "- Test the first end-to-end workflow after the scaffold is created.",
    "- Review every milestone summary before continuing.",
    "- Confirm external-service credentials and deployment targets before release work.",
    "",
    "Founder Action List",
    "- Approve or revise this master build plan.",
    "- Confirm what is explicitly out of scope for V1.",
    "- Confirm default save location or choose a different folder.",
    "- Confirm required external services before implementation begins.",
  ].join("\n");
}

export function generateProjectCreationErrorResponse(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return [
    "Project Planning Error",
    "",
    "NF could not safely render the generated project plan.",
    "No project files were created.",
    "",
    "What happened",
    message || "Planner output was invalid.",
    "",
    "Next",
    "Revise the planning input or regenerate the plan. NF will not fall back to a generic planner for locked specialized projects.",
  ].join("\n");
}
