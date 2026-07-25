import type {
  DiscoveryIntake,
  IntakeConfidenceLevel,
  PlannerProfile,
  ProjectClassificationResult,
  ProjectClassificationType,
  RequiredPlanner,
} from "../types";

interface ClassificationRule {
  type: ProjectClassificationType;
  planner: RequiredPlanner;
  signals: RegExp[];
  profile: PlannerProfile;
}

interface ClassificationScore {
  rule: ClassificationRule;
  score: number;
  matches: string[];
}

const CLASSIFICATION_PRIORITY: Record<ProjectClassificationType, number> = {
  "Website Platform / Website Builder": 20,
  "Business Website": 18,
  "SaaS": 17,
  "Mobile App": 16,
  "Desktop App": 15,
  "API / Backend Service": 14,
  "AI Agent": 13,
  "Developer Tool": 12,
  "Marketplace": 11,
  "Ecommerce": 10,
  "Internal Business Tool": 9,
  "Generic Software App": 1,
};

export const websitePlatformPlannerProfile: PlannerProfile = {
  id: "websitePlatformPlanner",
  label: "Website Platform Planner",
  understands: [
    "industry templates",
    "layout templates",
    "pages",
    "sections",
    "SEO",
    "analytics",
    "lead generation",
    "forms",
    "publishing",
    "hosting",
    "domains",
    "media library",
  ],
  planningFocus: [
    "Separate site-builder platform features from ordinary website pages.",
    "Plan template, page, section, media, publishing, analytics, and domain workflows.",
    "Route implementation through the normal Blueprint, phase plan, PatchEngine, checks, and quality gates.",
  ],
};

const profiles: Record<RequiredPlanner, PlannerProfile> = {
  websitePlatformPlanner: websitePlatformPlannerProfile,
  businessWebsitePlanner: {
    id: "businessWebsitePlanner",
    label: "Business Website Planner",
    understands: ["pages", "services", "contact forms", "SEO", "lead generation", "local business content"],
    planningFocus: ["Plan a focused public website before app-like workflows."],
  },
  saasPlanner: {
    id: "saasPlanner",
    label: "SaaS Planner",
    understands: ["accounts", "subscriptions", "dashboards", "teams", "billing", "admin workflows"],
    planningFocus: ["Plan authentication, tenancy, dashboard workflows, billing boundaries, and onboarding."],
  },
  mobileAppPlanner: {
    id: "mobileAppPlanner",
    label: "Mobile App Planner",
    understands: ["iOS", "Android", "mobile navigation", "offline states", "app store constraints"],
    planningFocus: ["Plan mobile-first flows and platform constraints."],
  },
  desktopAppPlanner: {
    id: "desktopAppPlanner",
    label: "Desktop App Planner",
    understands: ["Windows", "macOS", "Linux", "local files", "native shell integrations"],
    planningFocus: ["Plan desktop packaging, local storage, and OS integrations."],
  },
  backendServicePlanner: {
    id: "backendServicePlanner",
    label: "Backend Service Planner",
    understands: ["APIs", "services", "databases", "auth", "jobs", "integrations"],
    planningFocus: ["Plan endpoints, data models, validation, observability, and deployment boundaries."],
  },
  aiAgentPlanner: {
    id: "aiAgentPlanner",
    label: "AI Agent Planner",
    understands: ["agents", "tools", "memory", "prompts", "models", "retrieval", "automation"],
    planningFocus: ["Plan model routing, tool boundaries, memory isolation, and safety gates."],
  },
  developerToolPlanner: {
    id: "developerToolPlanner",
    label: "Developer Tool Planner",
    understands: ["CLI", "IDE", "debugging", "build tools", "linting", "developer workflows"],
    planningFocus: ["Plan developer workflows, diagnostics, commands, and integration points."],
  },
  marketplacePlanner: {
    id: "marketplacePlanner",
    label: "Marketplace Planner",
    understands: ["buyers", "sellers", "listings", "transactions", "reviews", "payments"],
    planningFocus: ["Plan listing, discovery, transaction, trust, and admin workflows."],
  },
  ecommercePlanner: {
    id: "ecommercePlanner",
    label: "Ecommerce Planner",
    understands: ["products", "cart", "checkout", "orders", "payments", "inventory"],
    planningFocus: ["Plan catalog, checkout, order, payment, and fulfillment flows."],
  },
  internalToolPlanner: {
    id: "internalToolPlanner",
    label: "Internal Business Tool Planner",
    understands: ["admin workflows", "operations", "approvals", "dashboards", "reports"],
    planningFocus: ["Plan internal users, permissions, data entry, reporting, and workflow automation."],
  },
  generalSoftwarePlanner: {
    id: "generalSoftwarePlanner",
    label: "General Software Planner",
    understands: ["apps", "tools", "workflows", "screens", "data"],
    planningFocus: ["Plan a general MVP when no specialized planner is confident enough."],
  },
};

const rules: ClassificationRule[] = [
  {
    type: "Website Platform / Website Builder",
    planner: "websitePlatformPlanner",
    profile: profiles.websitePlatformPlanner,
    signals: [
      /\bwebsite\s+(platform|builder|generator|creator)\b/i,
      /\b(build|create|generate|publish)\s+websites\b/i,
      /\bindustry\s+templates?\b/i,
      /\blayout\s+templates?\b/i,
      /\b(site|page|section)\s+builder\b/i,
      /\bmedia\s+library\b/i,
      /\bpublishing\b/i,
      /\bdomains?\b/i,
    ],
  },
  {
    type: "Business Website",
    planner: "businessWebsitePlanner",
    profile: profiles.businessWebsitePlanner,
    signals: [
      /\bbusiness\s+website\b/i,
      /\bcompany\s+website\b/i,
      /\blanding\s+page\b/i,
      /\bportfolio\s+(site|website)\b/i,
      /\bportfolio\s+website\b/i,
      /\b(service|restaurant|clinic|contractor|agency|roofing|church|school)\s+website\b/i,
      /\b(?:roofing|restaurant|church|portfolio|real\s+estate|listing)\b.*\bwebsite\b/i,
      /\bwebsite\b.*\b(?:menu|events|reservations|leads|listings|services)\b/i,
      /\bcontact\s+form\b/i,
      /\bgets?\s+leads?\b/i,
    ],
  },
  {
    type: "SaaS",
    planner: "saasPlanner",
    profile: profiles.saasPlanner,
    signals: [/\bsaas\b/i, /\bsubscription\b/i, /\btenant(s|cy)?\b/i, /\bteam\s+dashboard\b/i, /\bbilling\b/i],
  },
  {
    type: "Mobile App",
    planner: "mobileAppPlanner",
    profile: profiles.mobileAppPlanner,
    signals: [/\bmobile\s+app\b/i, /\bios\b/i, /\biphone\b/i, /\bandroid\b/i, /\bapp\s+store\b/i],
  },
  {
    type: "Desktop App",
    planner: "desktopAppPlanner",
    profile: profiles.desktopAppPlanner,
    signals: [/\bdesktop\s+app\b/i, /\bwindows\b/i, /\bmacos\b/i, /\blinux\b/i, /\btauri\b/i, /\belectron\b/i],
  },
  {
    type: "API / Backend Service",
    planner: "backendServicePlanner",
    profile: profiles.backendServicePlanner,
    signals: [/\bapi\b/i, /\bbackend\b/i, /\bservice\b/i, /\bwebhook\b/i, /\bendpoints?\b/i],
  },
  {
    type: "AI Agent",
    planner: "aiAgentPlanner",
    profile: profiles.aiAgentPlanner,
    signals: [/\bai\s+agent\b/i, /\bchatbot\b/i, /\bcustomer\s+support\b/i, /\bagent\b/i, /\bautonomous\b/i, /\btools?\b/i, /\bmemory\b/i, /\bllm\b/i],
  },
  {
    type: "Developer Tool",
    planner: "developerToolPlanner",
    profile: profiles.developerToolPlanner,
    signals: [/\bdeveloper\s+tool\b/i, /\bcli\b/i, /\bide\b/i, /\bdebugger\b/i, /\bbuild\s+tool\b/i],
  },
  {
    type: "Marketplace",
    planner: "marketplacePlanner",
    profile: profiles.marketplacePlanner,
    signals: [/\bmarketplace\b/i, /\bbuyers?\b/i, /\bsellers?\b/i, /\blistings?\b/i],
  },
  {
    type: "Ecommerce",
    planner: "ecommercePlanner",
    profile: profiles.ecommercePlanner,
    signals: [/\be-?commerce\b/i, /\bonline\s+store\b/i, /\bshopping\s+cart\b/i, /\bcheckout\b/i, /\bsimple\s+e-?commerce\s+store\b/i, /\becommerce\s+store\b/i],
  },
  {
    type: "Internal Business Tool",
    planner: "internalToolPlanner",
    profile: profiles.internalToolPlanner,
    signals: [/\binternal\s+(tool|app|dashboard)\b/i, /\boperations?\b/i, /\badmin\s+(tool|panel)\b/i, /\bapproval\s+workflow\b/i, /\bcrm\b/i, /\battendance\s+tracker\b/i, /\bsimple\s+crm\b/i],
  },
  {
    type: "Generic Software App",
    planner: "generalSoftwarePlanner",
    profile: profiles.generalSoftwarePlanner,
    signals: [/\bapp\b/i, /\bsoftware\b/i, /\btool\b/i, /\bplatform\b/i],
  },
];

function requestText(input: string | DiscoveryIntake): string {
  if (typeof input === "string") return input;
  return input.userRequest;
}

function scoreRule(text: string, rule: ClassificationRule): ClassificationScore {
  const matches = rule.signals
    .filter((signal) => signal.test(text))
    .map((signal) => signal.source);
  return {
    rule,
    score: matches.length,
    matches,
  };
}

function confidenceFor(primary: ClassificationScore, secondary: ClassificationScore[]): IntakeConfidenceLevel {
  if (primary.score >= 3) return "high";
  if (primary.score >= 2) return "medium";
  if (primary.score === 1 && secondary.length === 0) return "medium";
  return "low";
}

function clarificationQuestions(confidence: IntakeConfidenceLevel): string[] {
  if (confidence !== "low") return [];
  return [
    "What kind of product is this: website platform, business website, SaaS, mobile app, AI agent, or another type?",
    "Who is the primary user?",
    "What is the first MVP workflow NF should optimize for?",
  ];
}

export function classifyProjectRequest(input: string | DiscoveryIntake): ProjectClassificationResult {
  const text = requestText(input).trim();
  const scored = rules
    .map((rule) => scoreRule(text, rule))
    .filter((score) => score.score > 0)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return CLASSIFICATION_PRIORITY[b.rule.type] - CLASSIFICATION_PRIORITY[a.rule.type];
    });
  const specialized = scored.filter((score) => score.rule.type !== "Generic Software App");
  const primaryScore = scored[0];
  const selectedPrimary = primaryScore?.rule.type === "Generic Software App" && specialized[0]?.score
    ? specialized[0]
    : primaryScore;
  const primary = scored[0] ?? {
    rule: rules[rules.length - 1],
    score: 0,
    matches: [],
  };
  const effectivePrimary = selectedPrimary ?? primary;
  const secondary = scored
    .filter((score) => score.score > 0 && score.rule.type !== effectivePrimary.rule.type)
    .slice(0, 3);
  const confidence = confidenceFor(effectivePrimary, secondary);
  const reasoning = effectivePrimary.matches.length
    ? effectivePrimary.matches.map((match) => `Matched signal /${match}/ for ${effectivePrimary.rule.type}.`)
    : ["No strong specialized project-type signal was found; defaulting to a general software planner."];

  return {
    primaryClassification: effectivePrimary.rule.type,
    secondaryClassifications: secondary.map((score) => score.rule.type),
    confidence,
    reasoning,
    requiredPlanner: effectivePrimary.rule.planner,
    missingClarificationQuestions: clarificationQuestions(confidence),
    founderSummary: `NF detected this as a ${effectivePrimary.rule.type} project.`,
    developerDetails: [
      `primary=${effectivePrimary.rule.type}`,
      `planner=${effectivePrimary.rule.planner}`,
      `score=${effectivePrimary.score}`,
      `secondary=${secondary.map((score) => `${score.rule.type}:${score.score}`).join(", ") || "none"}`,
    ],
    plannerProfile: effectivePrimary.rule.profile,
  };
}
