import type {
  FullProjectSpecExtraction,
  IntakeConfidenceLevel,
  ProjectClassificationType,
  RequiredPlanner,
} from "../types";
import { extractStructuredProjectFields } from "../projectCreation/structuredFieldExtraction";

function has(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function addIf(items: string[], condition: boolean, value: string): void {
  if (condition && !items.includes(value)) items.push(value);
}

function extractLabeledValue(text: string, label: string): string | undefined {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^\\s*(?:[-*•]\\s*)?${escapedLabel}\\s*(?::|-)\\s*(.+)$`, "im"));
  return match?.[1]?.trim();
}

export function extractFullProjectSpec(input: {
  text: string;
  projectName?: string;
  savePath?: string;
  classification?: ProjectClassificationType;
  requiredPlanner?: RequiredPlanner;
}): FullProjectSpecExtraction {
  const text = input.text.trim();
  const lower = text.toLowerCase();
  const structured = extractStructuredProjectFields(text);
  const projectName = structured.projectName.value !== "Untitled Project"
    ? structured.projectName.value
    : extractLabeledValue(text, "Project Name") ?? input.projectName;
  const savePath = structured.savePath?.value ?? extractLabeledValue(text, "Save Path") ?? extractLabeledValue(text, "Path") ?? input.savePath;

  const mvpFeatures: string[] = [];
  addIf(mvpFeatures, has(lower, /\bwebsite projects?\b/), "website projects");
  addIf(mvpFeatures, has(lower, /\bindustry templates?\b/), "industry templates");
  addIf(mvpFeatures, has(lower, /\blayout templates?\b/), "layout templates");
  addIf(mvpFeatures, has(lower, /\b(page|section)\s+builder\b|\bpages?\b|\bsections?\b/), "page/section builder");
  addIf(mvpFeatures, has(lower, /\btheme (system|engine)\b|\btheme\b/), "theme system");
  addIf(mvpFeatures, has(lower, /\bmedia library\b|\bmedia\b/), "media library");
  addIf(mvpFeatures, has(lower, /\bforms?\b/), "forms");
  addIf(mvpFeatures, has(lower, /\blead (database|tracking|generation)\b|\bleads?\b/), "lead database");
  addIf(mvpFeatures, has(lower, /\banalytics\b/), "basic analytics");
  addIf(mvpFeatures, has(lower, /\bpreview\b/), "preview");
  addIf(mvpFeatures, has(lower, /\bpublishing\b|\bexport\b/), "publishing/export preparation");
  addIf(mvpFeatures, has(lower, /\baccounts?\b|\busers?\b|\broles?\b|\btenant\b/), "user accounts/settings");

  const postMvpFeatures: string[] = [];
  addIf(postMvpFeatures, has(lower, /\bfuture\s+ai page generation\b|\bai page generation\b/), "AI page generation");
  addIf(postMvpFeatures, has(lower, /\bfuture\s+ai copywriting\b|\bai copywriting\b/), "AI copywriting");
  addIf(postMvpFeatures, has(lower, /\bfuture\s+ai seo\b|\bai seo\b/), "AI SEO");
  addIf(postMvpFeatures, has(lower, /\bfuture\s+ai image recommendations?\b|\bai image recommendations?\b/), "AI image recommendations");
  addIf(postMvpFeatures, has(lower, /\bfuture\s+ai chatbot\b|\bai chatbot\b/), "AI chatbot");
  addIf(postMvpFeatures, has(lower, /\badvanced drag-and-drop editor\b|\bdrag-and-drop\b/), "advanced drag-and-drop editor");
  addIf(postMvpFeatures, has(lower, /\bfully automated domain purchasing deferred\b|\bfuture domain buying\b|\bdomain buying\b/), "automated domain purchasing");
  addIf(postMvpFeatures, has(lower, /\bfull cloud deployment automation deferred\b|\bfull cloud deployment automation\b/), "full cloud deployment automation");

  const awsDomainRequirements: string[] = [];
  addIf(awsDomainRequirements, has(lower, /\baws\b|\bamazon web services\b/), "AWS integration");
  addIf(awsDomainRequirements, has(lower, /\bdomain buying\b|\bfuture domain buying\b/), "future domain buying");
  addIf(awsDomainRequirements, has(lower, /\bdomain connection\b|\bconnect domains?\b/), "domain connection");
  addIf(awsDomainRequirements, has(lower, /\bsubdomains?\b/), "subdomains");
  addIf(awsDomainRequirements, has(lower, /\bssl\b|\bcertificate\b/), "SSL/certificate status");
  addIf(awsDomainRequirements, has(lower, /\bhosting\b/), "hosting preparation");

  const aiPlaceholders: string[] = [];
  addIf(aiPlaceholders, has(lower, /\bai creator placeholder\b|\bai creator\b/), "AI Creator placeholder");
  for (const feature of postMvpFeatures.filter((feature) => feature.startsWith("AI "))) {
    addIf(aiPlaceholders, true, `future ${feature}`);
  }

  const milestones: string[] = [];
  addIf(milestones, true, "MVP Website Platform");
  addIf(milestones, postMvpFeatures.some((feature) => feature.startsWith("AI ") && feature !== "AI chatbot"), "AI Feature Integration");
  addIf(milestones, postMvpFeatures.includes("AI chatbot"), "AI Chatbot");
  addIf(milestones, postMvpFeatures.includes("advanced drag-and-drop editor"), "Advanced Drag-and-Drop Editor");

  const nonGoals: string[] = [];
  addIf(nonGoals, has(lower, /\bfull cloud deployment automation deferred\b/), "Full cloud deployment automation deferred from MVP");
  addIf(nonGoals, has(lower, /\bfully automated domain purchasing deferred\b/), "Fully automated domain purchasing deferred from MVP");
  addIf(nonGoals, postMvpFeatures.some((feature) => feature.startsWith("AI ")), "AI generation features deferred until after MVP");
  addIf(nonGoals, postMvpFeatures.includes("advanced drag-and-drop editor"), "Advanced drag-and-drop editor deferred until after AI phases");

  const commercial = has(lower, /\bproduct launch\b|\bcommercial\b|\bsaas\b|\bcustomers?\b|\bclients?\b|\bsubscriptions?\b|\bcharge\b/);
  const multiTenant = has(lower, /\bmulti-tenant\b|\btenant\/account boundaries\b|\btenant boundaries\b/);
  const multiUser = has(lower, /\bmultiple accounts\b|\bmultiple users\b|\broles?\b|\baccounts?\b|\busers?\b/);
  const accountUserModel = multiTenant
    ? "multi-tenant accounts with roles, permissions, and tenant/account boundaries"
    : multiUser
      ? "multi-user accounts with roles and account boundaries"
      : "single founder/internal account to start";

  const approvalGates = [
    "Discovery approval before Blueprint finalization",
    "Architecture Review approval before Foundation",
    "Workspace path approval before file creation",
    "AWS credentials/account approval before AWS-dependent implementation",
    "Domain, SSL, billing, legal, and deployment decisions require explicit approval",
  ];

  const confidenceLevel: IntakeConfidenceLevel =
    mvpFeatures.length >= 8 && awsDomainRequirements.length >= 2 && postMvpFeatures.length >= 4
      ? "high"
      : mvpFeatures.length >= 4
        ? "medium"
        : "low";

  const uiSummary = [
    projectName ? `${projectName}: Website Platform / Website Builder.` : "Website Platform / Website Builder.",
    `MVP covers ${mvpFeatures.slice(0, 6).join(", ")}${mvpFeatures.length > 6 ? ", and more" : ""}.`,
    commercial ? "Commercial/product-launch signals mean accounts, roles, and account boundaries belong in the MVP." : "Internal-first launch with commercial readiness later.",
    awsDomainRequirements.length ? `Infrastructure planning includes ${awsDomainRequirements.join(", ")}.` : "Infrastructure requirements need confirmation.",
    postMvpFeatures.length ? `Deferred: ${postMvpFeatures.join(", ")}.` : "No post-MVP features were explicitly named.",
  ].join(" ");

  return {
    projectName,
    savePath,
    classification: input.classification,
    requiredPlanner: input.requiredPlanner,
    launchType: commercial ? "product launch / commercial-ready" : "internal first",
    accountUserModel,
    mvpFeatures,
    postMvpFeatures,
    awsDomainRequirements,
    aiPlaceholders,
    milestones,
    nonGoals,
    approvalGates,
    uiSummary,
    confidenceLevel,
  };
}
