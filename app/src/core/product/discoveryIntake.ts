import type {
  DiscoveryIntake,
  IntakeAnswer,
  IntakeConfidenceLevel,
  IntakeDefault,
  IntakeQuestion,
  ProjectClassificationResult,
} from "../types";
import type { StructuredProjectFields } from "../projectCreation/structuredFieldExtraction";

function answer(
  key: string,
  label: string,
  value: string,
  source: IntakeAnswer["source"],
  confidence: IntakeConfidenceLevel
): IntakeAnswer {
  return { key, label, value, source, confidence };
}

function defaultValue(key: string, label: string, value: string, reason: string): IntakeDefault {
  return { key, label, value, reason };
}

function includesAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

const MATERIAL_QUESTION_KEYS = new Set([
  "platform",
  "accounts",
  "accountsTiming",
  "auth",
  "authentication",
  "storage",
  "database",
  "payments",
  "ai",
  "api",
  "integrations",
  "deployment",
  "legal",
  "privacy",
  "mvp",
  "mvpScope",
  "workflow",
  "audience",
  "sync",
  "launchTarget",
]);

const MATERIAL_QUESTION_TERMS = [
  "platform",
  "account",
  "auth",
  "login",
  "database",
  "storage",
  "sync",
  "payment",
  "ai",
  "api",
  "integration",
  "deploy",
  "hosting",
  "legal",
  "privacy",
  "mvp",
  "scope",
  "workflow",
  "multiple users",
  "production launch",
];

export function isMaterialIntakeQuestion(question: IntakeQuestion): boolean {
  if (MATERIAL_QUESTION_KEYS.has(question.key)) return true;
  const text = `${question.question} ${question.whyItMatters} ${question.recommendedDefault}`.toLowerCase();
  return includesAny(text, MATERIAL_QUESTION_TERMS);
}

function inferProductType(request: string): IntakeAnswer {
  const text = request.toLowerCase();
  if (includesAny(text, ["budget", "budgeting", "expense", "expenses", "income"])) {
    return answer("productType", "Product type", "budgeting app", "inferred", "high");
  }
  if (includesAny(text, ["game", "arcade", "puzzle", "platformer"])) {
    return answer("productType", "Product type", "game", "inferred", "high");
  }
  if (/\b(dashboard|admin|crm)\b/.test(text)) {
    return answer("productType", "Product type", "business dashboard", "inferred", "medium");
  }
  if (includesAny(text, ["app", "tool", "software", "website", "site"])) {
    return answer("productType", "Product type", "software app", "inferred", "medium");
  }
  return answer("productType", "Product type", "software product", "default", "medium");
}

function inferPlatform(request: string): IntakeAnswer {
  const text = request.toLowerCase();
  if (/\b(ios|iphone|ipad)\b/.test(text)) return answer("platform", "Platform", "iOS app", "user", "high");
  if (/\b(android)\b/.test(text)) return answer("platform", "Platform", "Android app", "user", "high");
  if (/\b(web|website|browser|saas)\b/.test(text)) return answer("platform", "Platform", "web app", "user", "high");
  if (/\b(desktop|windows|macos|linux)\b/.test(text)) return answer("platform", "Platform", "desktop app", "user", "high");
  if (/\bmac\b/.test(text) && /\b(app|desktop|os)\b/.test(text)) {
    return answer("platform", "Platform", "desktop app", "user", "high");
  }
  if (/\bapp\b/.test(text)) return answer("platform", "Platform", "web app", "default", "high");
  return answer("platform", "Platform", "web app", "default", "medium");
}

function inferMvpFeatures(productType: string): IntakeAnswer {
  if (productType === "budgeting app") {
    return answer("mvpFeatures", "MVP features", "income, expenses, categories, dashboard", "inferred", "high");
  }
  if (productType === "game") {
    return answer("mvpFeatures", "MVP features", "playable loop, scoring, restart, basic instructions", "inferred", "medium");
  }
  return answer("mvpFeatures", "MVP features", "primary workflow, simple dashboard, basic settings", "default", "medium");
}

function inferAccounts(request: string): IntakeAnswer {
  const text = request.toLowerCase();
  if (/\b(product launch|platform|multiple users|customers|clients|charge|subscriptions?|saas)\b/.test(text)) {
    return answer("accounts", "Accounts", "include multi-user accounts in MVP", "inferred", "high");
  }
  if (/\b(account|login|sign in|users|multi-user|team)\b/.test(text)) {
    return answer("accounts", "Accounts", "include accounts in MVP", "user", "high");
  }
  return answer("accounts", "Accounts", "later unless requested", "default", "high");
}

function inferCharts(productType: string): IntakeAnswer {
  if (productType === "budgeting app") {
    return answer("charts", "Charts", "basic charts", "inferred", "high");
  }
  return answer("charts", "Charts", "only if useful for the core workflow", "default", "medium");
}

function inferMobileApps(request: string): IntakeAnswer {
  const text = request.toLowerCase();
  if (/\b(ios|android|mobile app|app store|play store)\b/.test(text)) {
    return answer("mobileApps", "Mobile apps", "requested", "user", "high");
  }
  return answer("mobileApps", "Mobile apps", "later", "default", "high");
}

function inferStorage(request: string, productType: string): IntakeAnswer {
  const text = request.toLowerCase();
  if (/\b(sync|accounts|login|multi-user|team|database|cloud)\b/.test(text)) {
    return answer("storage", "Storage", "simple database", "inferred", "medium");
  }
  if (productType === "budgeting app") {
    return answer("storage", "Storage", "local first for MVP, upgrade to database if sync/accounts are needed", "default", "medium");
  }
  return answer("storage", "Storage", "local or simple database depending on MVP scope", "default", "medium");
}

function buildQuestions(): IntakeQuestion[] {
  return [
    {
      key: "audience",
      question: "Is this for personal use or multiple users?",
      whyItMatters: "This changes account, sync, privacy, and data-model choices.",
      recommendedDefault: "personal use for the first MVP",
      blocksBuild: false,
    },
    {
      key: "accountsTiming",
      question: "Do you want accounts now or later?",
      whyItMatters: "Accounts add authentication, user data isolation, and more setup.",
      recommendedDefault: "later unless the MVP requires multiple users",
      blocksBuild: false,
    },
    {
      key: "sync",
      question: "Should data sync across devices?",
      whyItMatters: "Sync usually requires a backend or hosted database.",
      recommendedDefault: "no sync for the first local MVP",
      blocksBuild: false,
    },
    {
      key: "launchTarget",
      question: "Is this for a demo, MVP, or production launch?",
      whyItMatters: "The target changes quality gates, polish, deployment, and legal checks.",
      recommendedDefault: "MVP",
      blocksBuild: false,
    },
  ];
}

function confidenceFor(answers: IntakeAnswer[]): IntakeConfidenceLevel {
  const high = answers.filter((item) => item.confidence === "high").length;
  if (high >= 4) return "high";
  return "medium";
}

export interface ProjectStateIntakeInput {
  projectName: string;
  fullFounderPrompt: string;
  classification: ProjectClassificationResult;
  extractedFields: StructuredProjectFields;
}

export function buildDiscoveryUnderstoodSummary(
  classification: ProjectClassificationResult,
  platform: string
): string {
  if (classification.primaryClassification === "Website Platform / Website Builder") {
    return "NF understood this as a Website Platform / Website Builder.";
  }
  return `NF understood this as a ${classification.primaryClassification} as a ${platform}.`;
}

function replaceInferredAnswer(
  answers: IntakeAnswer[],
  key: string,
  label: string,
  value: string,
  source: IntakeAnswer["source"],
  confidence: IntakeConfidenceLevel
): IntakeAnswer[] {
  return answers.map((answer) =>
    answer.key === key ? { key, label, value, source, confidence } : answer
  );
}

export function createDiscoveryIntakeFromProjectState(input: ProjectStateIntakeInput): DiscoveryIntake {
  const base = createDiscoveryIntake(input.fullFounderPrompt);
  const productType = input.classification.primaryClassification;
  const platform = input.extractedFields.targetPlatform.value;
  const mvpFeatureList = input.extractedFields.mvpFeatures.value;
  const mvpFeatures = mvpFeatureList.length
    ? mvpFeatureList.join(", ")
    : base.inferredAnswers.find((item) => item.key === "mvpFeatures")?.value ?? "the core MVP workflow";
  const understoodSummary = buildDiscoveryUnderstoodSummary(input.classification, platform);

  let inferredAnswers = replaceInferredAnswer(
    base.inferredAnswers,
    "productType",
    "Product type",
    productType,
    input.extractedFields.projectType?.source === "explicit" ? "user" : "inferred",
    "high"
  );
  inferredAnswers = replaceInferredAnswer(
    inferredAnswers,
    "platform",
    "Platform",
    platform,
    input.extractedFields.targetPlatform.source === "explicit"
      ? "user"
      : input.extractedFields.targetPlatform.source === "inferred"
        ? "inferred"
        : "default",
    "high"
  );
  inferredAnswers = replaceInferredAnswer(
    inferredAnswers,
    "mvpFeatures",
    "MVP features",
    mvpFeatures,
    mvpFeatureList.length ? "inferred" : "default",
    mvpFeatureList.length >= 6 ? "high" : "medium"
  );

  const accountsModel = input.extractedFields.accountsModel.value;
  if (/\bmulti/i.test(accountsModel)) {
    inferredAnswers = replaceInferredAnswer(
      inferredAnswers,
      "accounts",
      "Accounts",
      accountsModel.includes("tenant")
        ? "include multi-user / multi-tenant accounts in MVP"
        : "include multi-user accounts in MVP",
      "inferred",
      "high"
    );
  }

  return {
    ...base,
    userRequest: input.fullFounderPrompt,
    understoodSummary,
    inferredAnswers,
    confidenceLevel:
      mvpFeatureList.length >= 6 || input.extractedFields.intentDepth !== "simpleIdea"
        ? "high"
        : base.confidenceLevel,
  };
}

export function createDiscoveryIntake(userRequest: string): DiscoveryIntake {
  const trimmed = userRequest.trim();
  const productType = inferProductType(trimmed);
  const platform = inferPlatform(trimmed);
  const mvpFeatures = inferMvpFeatures(productType.value);
  const accounts = inferAccounts(trimmed);
  const storage = inferStorage(trimmed, productType.value);
  const charts = inferCharts(productType.value);
  const mobileApps = inferMobileApps(trimmed);
  const inferredAnswers = [
    productType,
    platform,
    mvpFeatures,
    accounts,
    storage,
    charts,
    mobileApps,
  ];
  const recommendedDefaults = [
    defaultValue(
      "platform",
      "Platform",
      "web app",
      "Fastest to build, demo, test, share, and later wrap for iOS/Android."
    ),
    accounts.value.includes("multi-user accounts")
      ? defaultValue("accounts", "Accounts", "include multi-user accounts in MVP", "Commercial/product-launch projects need account ownership, roles, and user boundaries in the MVP.")
      : defaultValue("accounts", "Accounts", "later unless requested", "Keeps the first MVP smaller and faster."),
    defaultValue("sync", "Device sync", "later", "Avoids backend complexity until the MVP proves value."),
    defaultValue("launchTarget", "Launch target", "MVP", "Balances speed with enough quality to test the product."),
  ];
  const confidenceLevel = confidenceFor(inferredAnswers);

  return {
    userRequest: trimmed,
    understoodSummary: `NF understood this as a request to build a ${productType.value} as a ${platform.value}.`,
    inferredAnswers,
    unansweredQuestions: buildQuestions(),
    recommendedDefaults,
    userConfirmedAnswers: [],
    assumptions: [
      "NF can continue if these questions are skipped.",
      "Skipped answers will use the safest practical defaults.",
      platform.value === "web app"
        ? "Web app is the default because it is fastest to build, demo, test, and share."
        : `${platform.value} was selected from the user request.`,
      "Mobile apps can be added later unless explicitly required now.",
      accounts.value.includes("multi-user accounts")
        ? "Commercial product language means accounts, roles, and account boundaries belong in the MVP."
        : "Accounts can stay later unless the MVP requires multiple users.",
    ],
    confidenceLevel,
    decisionsRequiringLaterConfirmation: [
      accounts.value.includes("multi-user accounts")
        ? "Confirm authentication depth during Foundation before implementation."
        : "Whether accounts are required before MVP testing.",
      "Whether data must sync across devices.",
      "Whether the target is demo, MVP, or production launch.",
    ],
    canContinue: true,
  };
}
