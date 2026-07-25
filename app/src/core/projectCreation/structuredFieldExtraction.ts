import { UNRESOLVED_PROJECT_NAME } from "./projectIdentity";

export type ExtractedFieldSource = "explicit" | "inferred" | "defaulted";
export type ExtractedFieldConfidence = "low" | "medium" | "high";
export type IntentDepth =
  | "simpleIdea"
  | "roughConcept"
  | "detailedProductSpec"
  | "technicalArchitectureSpec"
  | "existingProjectImport";

export interface ExtractedField<T = string> {
  value: T;
  confidence: ExtractedFieldConfidence;
  source: ExtractedFieldSource;
  sourceText?: string;
  matchedPattern?: string;
  warnings?: string[];
}

export interface StructuredProjectFields {
  projectName: ExtractedField;
  savePath?: ExtractedField;
  projectType?: ExtractedField;
  launchType: ExtractedField;
  targetPlatform: ExtractedField;
  accountsModel: ExtractedField;
  rolesPermissions?: ExtractedField;
  tenancyModel?: ExtractedField;
  hostingTarget: ExtractedField;
  awsRequirements: ExtractedField<string[]>;
  domainRequirements: ExtractedField<string[]>;
  sslRequirements?: ExtractedField;
  analyticsRequirements?: ExtractedField;
  leadRequirements?: ExtractedField;
  mvpFeatures: ExtractedField<string[]>;
  postMvpFeatures: ExtractedField<string[]>;
  nonGoals: ExtractedField<string[]>;
  milestones: ExtractedField<string[]>;
  aiPlaceholders: ExtractedField<string[]>;
  qualityGates: ExtractedField<string[]>;
  founderConstraints: ExtractedField<string[]>;
  intentDepth: IntentDepth;
}

function clean(value: string): string {
  return value
    .trim()
    .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, "")
    .replace(/\*\*|__/g, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/[.?!,:;]+$/g, "")
    .trim();
}

function normalizeFounderTextForExtraction(text: string): string {
  return text
    .replace(/\*\*([^*]+):\*\*/g, "$1: ")
    .replace(/__([^_]+):__/g, "$1: ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\r\n/g, "\n");
}

function extractInlineLabeledValue(
  text: string,
  label: string,
  stopBefore = /\s+(?:Save\s+Path|Project\s+Type|Project\s+Name|#|---)\b/i
): { value: string; sourceText: string; pattern: string } | null {
  const words = label.trim().replace(/\s+/g, "\\s+");
  const pattern = new RegExp(
    `(?:\\*\\*|__)?${words}(?:\\*\\*|__)?\\s*:\\s*(.+?)(?=${stopBefore.source}|$)`,
    "is"
  );
  const match = text.match(pattern);
  if (!match?.[1]) return null;
  const value = /path/i.test(label) ? normalizeSavePathValue(match[1]) : clean(match[1]);
  if (!value) return null;
  return { value, sourceText: match[0], pattern: `inline ${label}` };
}

function normalizeSavePathValue(value: string): string {
  return value
    .trim()
    .replace(/`+/g, "")
    .split(/\s+(?:---|#|\*\*(?:Project|Save)\b)/)[0]
    .trim();
}

function safeAbsolutePath(value: string): boolean {
  const trimmed = normalizeSavePathValue(value);
  return /^[a-zA-Z]:[\\/]/.test(trimmed) && !trimmed.split(/[\\/]+/).includes("..");
}

function sourceLine(text: string, index: number): string {
  return text.split(/\r?\n/)[index]?.trim() ?? "";
}

function labelPattern(label: string): RegExp {
  const words = label.trim().replace(/\s+/g, "\\s+");
  return new RegExp(
    `^\\s*(?:#{1,6}\\s+)?(?:[-*•]\\s*)?(?:\\*\\*|__)?${words}(?:\\*\\*|__)?\\s*(?::|-)\\s*(.+)$`,
    "i"
  );
}

function nextLineLabelPattern(label: string): RegExp {
  const words = label.trim().replace(/\s+/g, "\\s+");
  return new RegExp(`^\\s*(?:#{1,6}\\s+)?(?:[-*•]\\s*)?(?:\\*\\*|__)?${words}(?:\\*\\*|__)?\\s*$`, "i");
}

function extractLabeledValue(text: string, labels: string[]): { value: string; sourceText: string; pattern: string } | null {
  const normalized = normalizeFounderTextForExtraction(text);
  for (const source of [normalized, text]) {
    const lines = source.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      for (const label of labels) {
        const sameLine = lines[i].match(labelPattern(label));
        if (sameLine?.[1]) {
          const value = /path/i.test(label) ? normalizeSavePathValue(sameLine[1]) : clean(sameLine[1]);
          return { value, sourceText: sourceLine(source, i), pattern: `${label}: value` };
        }
        const nextLine = lines[i].match(nextLineLabelPattern(label));
        if (nextLine && lines[i + 1]?.trim()) {
          return {
            value: clean(lines[i + 1]),
            sourceText: `${sourceLine(source, i)} ${sourceLine(source, i + 1)}`,
            pattern: `${label}\\nvalue`,
          };
        }
      }
    }
    for (const label of labels) {
      const inline = extractInlineLabeledValue(source, label);
      if (inline) return inline;
    }
  }
  return null;
}

function titleCasePhrase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function normalizeIdeaName(value: string): string {
  return titleCasePhrase(
    clean(value)
      .replace(/^(?:a|an|the)\s+/i, "")
      .replace(/\s+(?:that|which|with|for|to)\b[\s\S]*$/i, "")
      .trim()
  );
}

function extractIdeaProjectName(text: string): { value: string; sourceText: string; pattern: string } | null {
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
  const ideaPatterns = [
    /^(?:i\s+)?(?:want|need)(?:\s+to)?(?:\s+build)?\s+(?:a|an)?\s*(.+)$/i,
    /^(?:build|make|create)\s+(?:me\s+)?(?:a|an)?\s*(.+)$/i,
  ];
  for (const pattern of ideaPatterns) {
    const match = firstLine.match(pattern);
    if (!match?.[1]) continue;
    const normalized = normalizeIdeaName(match[1]);
    if (!normalized || normalized.length < 3 || normalized.length > 80) continue;
    if (/^(something|anything|useful)\b/i.test(normalized)) continue;
    return { value: normalized, sourceText: match[0], pattern: pattern.source };
  }
  return null;
}

function extractNaturalProjectName(text: string): { value: string; sourceText: string; pattern: string } | null {
  const patterns = [
    /\bcreate\s+(?:a\s+)?new\s+NF\s+project\s+named\s+["“'‘]?([^"”'’.\n]+)["”'’]?/i,
    /\bcreate\s+(?:a\s+)?new\s+project\s+named\s+["“'‘]?([^"”'’.\n]+)["”'’]?/i,
    /\bproject\s+named\s+["“'‘]?([^"”'’.\n]+)["”'’]?/i,
    /\bproject\s+called\s+["“'‘]?([^"”'’.\n]+)["”'’]?/i,
    /\bname\s+the\s+project\s+["“'‘]?([^"”'’.\n]+)["”'’]?/i,
    /\bcreate\s+(?:a\s+)?new\s+project\s+called\s+["“'‘]?([^"”'’.\n]+)["”'’]?/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return { value: clean(match[1]), sourceText: match[0], pattern: pattern.source };
    }
  }
  const ideaName = extractIdeaProjectName(text);
  if (ideaName) return ideaName;
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (
    firstLine &&
    firstLine.length <= 80 &&
    /^[A-Z][A-Za-z0-9 '&-]{2,}$/.test(firstLine) &&
    !/path|save|project\s+save/i.test(firstLine) &&
    !/^(build|create|make|start|launch|design)\b/i.test(firstLine)
  ) {
    return { value: clean(firstLine), sourceText: firstLine, pattern: "title-style first line" };
  }
  return null;
}

function stringField(value: string, source: ExtractedFieldSource, confidence: ExtractedFieldConfidence, sourceText?: string, matchedPattern?: string, warnings: string[] = []): ExtractedField {
  return { value, source, confidence, sourceText, matchedPattern, warnings };
}

function listField(values: string[], source: ExtractedFieldSource, confidence: ExtractedFieldConfidence, sourceText?: string): ExtractedField<string[]> {
  return { value: Array.from(new Set(values)), source, confidence, sourceText };
}

function includes(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function pushIf(values: string[], condition: boolean, value: string): void {
  if (condition && !values.includes(value)) values.push(value);
}

export function extractStructuredProjectFields(text: string): StructuredProjectFields {
  const raw = text.trim();
  const lower = raw.toLowerCase();
  const explicitName = extractLabeledValue(raw, ["Project Name", "Project name", "Name", "App Name", "Site Name"]);
  const naturalName = explicitName ? null : extractNaturalProjectName(raw);
  const ambiguousNameWarning = /project\s+save\s+path|save\s+path|default\s+path|workspace\s+path/i.test(explicitName?.sourceText ?? "")
    ? ["Project name label appeared near a path label; value was ignored."]
    : [];
  const projectName = explicitName && !ambiguousNameWarning.length
    ? stringField(explicitName.value, "explicit", "high", explicitName.sourceText, explicitName.pattern)
    : naturalName
      ? stringField(naturalName.value, "explicit", "high", naturalName.sourceText, naturalName.pattern)
      : stringField(UNRESOLVED_PROJECT_NAME, "defaulted", "low", undefined, "fallback", ambiguousNameWarning);

  const explicitPath = extractLabeledValue(raw, ["Save Path", "Save path", "Project Path", "Workspace Path", "Default Path"]);
  const pathMention = normalizeFounderTextForExtraction(raw).match(/[a-zA-Z]:[\\/][^\s"'<>|`*]+(?:[\\/][^\s"'<>|`*]+)*/);
  const savePathValueRaw = explicitPath?.value ?? pathMention?.[0];
  const savePathValue = savePathValueRaw ? normalizeSavePathValue(savePathValueRaw) : undefined;
  const savePath = savePathValue && safeAbsolutePath(savePathValue)
    ? stringField(savePathValue, explicitPath ? "explicit" : "inferred", explicitPath ? "high" : "medium", explicitPath?.sourceText ?? pathMention?.[0], explicitPath?.pattern ?? "safe path mention")
    : undefined;

  const projectTypeValue = extractLabeledValue(raw, ["Project Type", "Type"])?.value;
  const projectType = projectTypeValue
    ? stringField(projectTypeValue, "explicit", "high")
    : includes(lower, /\bwebsite\s+(platform|builder|creator|hosting)\b|\bindustry templates?\b|\blayout templates?\b/)
      ? stringField("Website Platform / Website Builder", "inferred", "high")
      : undefined;

  const commercial = includes(lower, /\bproduct launch\b|\bcommercial\b|\bsaas\b|\bcustomers?\b|\bclients?\b|\bsubscriptions?\b|\bcharge\b/);
  const multiTenant = includes(lower, /\bmulti-tenant\b|\btenant\/account boundaries\b|\btenant boundaries\b|\baccount boundaries\b/);
  const multiUser = includes(lower, /\bmultiple accounts\b|\bmultiple users\b|\broles?\b|\baccounts?\b|\busers?\b/);

  const mvpFeatures: string[] = [];
  pushIf(mvpFeatures, includes(lower, /\bwebsite projects?\b/), "website projects");
  pushIf(mvpFeatures, includes(lower, /\bindustry templates?\b/), "industry templates");
  pushIf(mvpFeatures, includes(lower, /\blayout templates?\b/), "layout templates");
  pushIf(mvpFeatures, includes(lower, /\b(page|section)\s+builder\b|\bpages?\b|\bsections?\b/), "page/section builder");
  pushIf(mvpFeatures, includes(lower, /\btheme (system|engine)\b|\btheme\b/), "theme system");
  pushIf(mvpFeatures, includes(lower, /\bmedia library\b|\bmedia\b/), "media library");
  pushIf(mvpFeatures, includes(lower, /\bforms?\b/), "forms");
  pushIf(mvpFeatures, includes(lower, /\blead (database|tracking|generation)\b|\bleads?\b/), "lead database");
  pushIf(mvpFeatures, includes(lower, /\banalytics\b/), "basic analytics");
  pushIf(mvpFeatures, includes(lower, /\bpreview\b/), "preview");
  pushIf(mvpFeatures, includes(lower, /\bpublishing\b|\bexport\b/), "publishing/export preparation");
  pushIf(mvpFeatures, includes(lower, /\baccounts?\b|\busers?\b|\broles?\b|\btenant\b/), "user accounts/settings");

  const postMvpFeatures: string[] = [];
  pushIf(postMvpFeatures, includes(lower, /\bfuture\s+ai page generation\b|\bai page generation\b/), "AI page generation");
  pushIf(postMvpFeatures, includes(lower, /\bfuture\s+ai copywriting\b|\bai copywriting\b/), "AI copywriting");
  pushIf(postMvpFeatures, includes(lower, /\bfuture\s+ai seo\b|\bai seo\b/), "AI SEO");
  pushIf(postMvpFeatures, includes(lower, /\bfuture\s+ai image recommendations?\b|\bai image recommendations?\b/), "AI image recommendations");
  pushIf(postMvpFeatures, includes(lower, /\bfuture\s+ai chatbot\b|\bai chatbot\b/), "AI chatbot");
  pushIf(postMvpFeatures, includes(lower, /\badvanced drag-and-drop editor\b|\bdrag-and-drop\b/), "advanced drag-and-drop editor");
  pushIf(postMvpFeatures, includes(lower, /\bfull cloud deployment automation deferred\b|\bfull cloud deployment automation\b/), "full cloud deployment automation");
  pushIf(postMvpFeatures, includes(lower, /\bfully automated domain purchasing deferred\b|\bfuture domain buying\b|\bdomain buying\b/), "automated domain purchasing");

  const awsRequirements: string[] = [];
  pushIf(awsRequirements, includes(lower, /\baws\b|\bamazon web services\b/), "AWS integration");
  pushIf(awsRequirements, includes(lower, /\bhosting\b/), "hosting preparation");

  const domainRequirements: string[] = [];
  pushIf(domainRequirements, includes(lower, /\bdomain buying\b|\bfuture domain buying\b/), "future domain buying");
  pushIf(domainRequirements, includes(lower, /\bdomain connection\b|\bconnect domains?\b/), "domain connection");
  pushIf(domainRequirements, includes(lower, /\bsubdomains?\b/), "subdomains");

  const nonGoals: string[] = [];
  pushIf(nonGoals, includes(lower, /\bfull cloud deployment automation deferred\b/), "Full cloud deployment automation deferred from MVP");
  pushIf(nonGoals, includes(lower, /\bfully automated domain purchasing deferred\b/), "Fully automated domain purchasing deferred from MVP");
  pushIf(nonGoals, postMvpFeatures.some((feature) => feature.startsWith("AI ")), "AI generation features deferred until after MVP");
  pushIf(nonGoals, postMvpFeatures.includes("advanced drag-and-drop editor"), "Advanced drag-and-drop editor deferred");

  const constraints: string[] = [];
  pushIf(constraints, includes(lower, /\bdo not write code yet\b/), "Do not write code yet");
  pushIf(constraints, includes(lower, /\bwait for founder approval\b|\bbefore proposing file changes\b/), "Wait for founder approval before file changes");

  const milestones: string[] = [];
  pushIf(milestones, mvpFeatures.length > 0, "MVP Website Platform");
  pushIf(milestones, postMvpFeatures.some((feature) => feature.startsWith("AI ") && feature !== "AI chatbot"), "AI Feature Integration");
  pushIf(milestones, postMvpFeatures.includes("AI chatbot"), "AI Chatbot");
  pushIf(milestones, postMvpFeatures.includes("advanced drag-and-drop editor"), "Advanced Drag-and-Drop Editor");

  const intentDepth: IntentDepth =
    includes(lower, /\bimport existing project\b|\btrack this project\b/) ? "existingProjectImport" :
    includes(lower, /\barchitecture\b|\baws\b|\bdomain\b|\btenant\b|\bssl\b/) && mvpFeatures.length >= 6 ? "technicalArchitectureSpec" :
    raw.length > 900 || mvpFeatures.length >= 6 ? "detailedProductSpec" :
    raw.length > 160 ? "roughConcept" :
    "simpleIdea";

  return {
    projectName,
    savePath,
    projectType,
    launchType: stringField(commercial ? "commercial/product-launch" : "internal", commercial ? "inferred" : "defaulted", commercial ? "high" : "medium"),
    targetPlatform: stringField("web app", includes(lower, /\bweb\b|\bwebsite\b|\bbrowser\b/) ? "inferred" : "defaulted", "high"),
    accountsModel: stringField(
      multiTenant ? "multi-user / multi-tenant accounts with roles and permissions" : multiUser ? "multi-user accounts with roles and permissions" : "single-user/internal first",
      multiTenant || multiUser ? "inferred" : "defaulted",
      multiTenant || multiUser ? "high" : "medium"
    ),
    rolesPermissions: multiUser || multiTenant ? stringField("roles and permissions required", "inferred", "high") : undefined,
    tenancyModel: multiTenant ? stringField("tenant/account boundaries required", "inferred", "high") : undefined,
    hostingTarget: stringField(includes(lower, /\baws\b/) ? "AWS" : "local/undecided", includes(lower, /\baws\b/) ? "explicit" : "defaulted", includes(lower, /\baws\b/) ? "high" : "medium"),
    awsRequirements: listField(awsRequirements, awsRequirements.length ? "explicit" : "defaulted", awsRequirements.length ? "high" : "medium"),
    domainRequirements: listField(domainRequirements, domainRequirements.length ? "explicit" : "defaulted", domainRequirements.length ? "high" : "medium"),
    sslRequirements: includes(lower, /\bssl\b|\bcertificate\b/) ? stringField("SSL/certificate status", "explicit", "high") : undefined,
    analyticsRequirements: includes(lower, /\banalytics\b/) ? stringField("basic analytics", "explicit", "high") : undefined,
    leadRequirements: includes(lower, /\bleads?\b/) ? stringField("lead capture and lead database", "explicit", "high") : undefined,
    mvpFeatures: listField(mvpFeatures, mvpFeatures.length ? "explicit" : "defaulted", mvpFeatures.length >= 6 ? "high" : "medium"),
    postMvpFeatures: listField(postMvpFeatures, postMvpFeatures.length ? "explicit" : "defaulted", postMvpFeatures.length ? "high" : "medium"),
    nonGoals: listField(nonGoals, nonGoals.length ? "explicit" : "defaulted", nonGoals.length ? "high" : "medium"),
    milestones: listField(milestones, milestones.length ? "inferred" : "defaulted", milestones.length ? "high" : "medium"),
    aiPlaceholders: listField(
      [
        ...(includes(lower, /\bai creator placeholder\b|\bai creator\b/) ? ["AI Creator placeholder"] : []),
        ...postMvpFeatures.filter((feature) => feature.startsWith("AI ")).map((feature) => `future ${feature}`),
      ],
      includes(lower, /\bai\b/) ? "explicit" : "defaulted",
      includes(lower, /\bai\b/) ? "high" : "medium"
    ),
    qualityGates: listField(["planner lock", "workspace safety", "architecture review", "template preservation"], "inferred", "medium"),
    founderConstraints: listField(constraints, constraints.length ? "explicit" : "defaulted", constraints.length ? "high" : "medium"),
    intentDepth,
  };
}
