import type {
  DiscoveryIntake,
  PhaseTask,
  ProductBrief,
  ProjectClassificationResult,
  QualityGate,
  RequiredPlanner,
  SpecializedPlannerOutput,
} from "../../types";
import { extractFullProjectSpec } from "../fullSpecExtraction";

const SPECIALIZED_PLANNERS = new Set<RequiredPlanner>([
  "websitePlatformPlanner",
  "businessWebsitePlanner",
  "saasPlanner",
  "mobileAppPlanner",
  "desktopAppPlanner",
  "backendServicePlanner",
  "aiAgentPlanner",
  "developerToolPlanner",
  "marketplacePlanner",
  "ecommercePlanner",
  "internalToolPlanner",
]);

function task(id: string, title: string, rationale: string): PhaseTask {
  return { id, title, rationale, sourceGapKeys: [], constraints: [], status: "todo" };
}

function qualityGate(id: string, title: string, check: string): QualityGate {
  return { id, title, check, required: true, status: "pending" };
}

function findAnswer(intake: DiscoveryIntake, key: string): string | undefined {
  return intake.inferredAnswers.find((answer) => answer.key === key)?.value;
}

function splitFeatures(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function plannerLabel(planner: RequiredPlanner): string {
  return planner.replace(/Planner$/, "").replace(/([A-Z])/g, " $1").trim();
}

function defaultMvpFeatures(classification: ProjectClassificationResult, intake: DiscoveryIntake): string[] {
  const fromIntake = splitFeatures(findAnswer(intake, "mvpFeatures"));
  if (fromIntake.length > 0 && !fromIntake.every((feature) => /primary workflow|simple dashboard|basic settings/i.test(feature))) {
    return fromIntake;
  }

  switch (classification.requiredPlanner) {
    case "businessWebsitePlanner":
      return ["home page", "services or offerings", "contact or lead form", "basic SEO", "mobile-friendly layout"];
    case "saasPlanner":
      return ["accounts and login", "core dashboard", "primary workflow", "settings", "admin basics"];
    case "mobileAppPlanner":
      return ["primary screen", "core workflow", "navigation", "settings", "offline-safe defaults"];
    case "desktopAppPlanner":
      return ["main window", "core workflow", "local storage", "settings", "packaging plan"];
    case "backendServicePlanner":
      return ["core API endpoints", "data validation", "health checks", "auth boundary", "deployment notes"];
    case "aiAgentPlanner":
      return ["prompt and response flow", "tool boundaries", "memory boundaries", "safety checks", "operator review"];
    case "developerToolPlanner":
      return ["primary command or workflow", "configuration", "diagnostics", "docs", "safe defaults"];
    case "marketplacePlanner":
      return ["listings", "search or browse", "profiles", "transaction boundary", "admin review"];
    case "ecommercePlanner":
      return ["product catalog", "product detail pages", "cart", "checkout boundary", "order summary"];
    case "internalToolPlanner":
      return ["data entry", "dashboard", "reports", "roles boundary", "workflow tracking"];
    default:
      return fromIntake.length ? fromIntake : ["primary workflow", "simple dashboard", "basic settings"];
  }
}

function defaultScreens(planner: RequiredPlanner): string[] {
  switch (planner) {
    case "businessWebsitePlanner":
      return ["Home", "Services", "About", "Contact", "Lead capture"];
    case "saasPlanner":
      return ["Login", "Dashboard", "Primary workflow", "Settings", "Admin"];
    case "mobileAppPlanner":
      return ["Launch", "Home", "Primary workflow", "Settings"];
    case "aiAgentPlanner":
      return ["Conversation", "Tool activity", "Memory summary", "Operator controls"];
    case "ecommercePlanner":
      return ["Storefront", "Product detail", "Cart", "Checkout", "Order confirmation"];
    case "internalToolPlanner":
      return ["Dashboard", "Records", "Reports", "Settings"];
    default:
      return ["Home", "Primary workflow", "Settings"];
  }
}

function defaultArchitecture(planner: RequiredPlanner): string[] {
  switch (planner) {
    case "businessWebsitePlanner":
      return [
        "Keep the first version as a focused public website, not a full app platform.",
        "Separate marketing content from lead-capture workflow.",
        "Plan SEO, forms, and publishing before advanced integrations.",
      ];
    case "aiAgentPlanner":
      return [
        "Keep model routing, tools, and memory isolated behind explicit safety gates.",
        "Start with one support workflow before adding automation breadth.",
      ];
    case "ecommercePlanner":
      return [
        "Start with catalog and checkout boundaries before payments automation.",
        "Keep inventory and order handling explicit in the MVP plan.",
      ];
    case "saasPlanner":
      return [
        "Plan authentication, tenancy, and billing boundaries before feature breadth.",
        "Keep admin and user flows separate from day one.",
      ];
    default:
      return [
        "Start with the smallest working version of the core workflow.",
        "Defer advanced integrations until the MVP path is approved.",
      ];
  }
}

export function isSpecializedPlanner(planner: RequiredPlanner): boolean {
  return SPECIALIZED_PLANNERS.has(planner);
}

export function requiresSpecializedPlanner(classification: ProjectClassificationResult): boolean {
  return classification.requiredPlanner !== "generalSoftwarePlanner";
}

export function createFoundationPlannerOutput(
  intake: DiscoveryIntake,
  classification: ProjectClassificationResult
): SpecializedPlannerOutput | null {
  if (!requiresSpecializedPlanner(classification)) return null;

  const planner = classification.requiredPlanner;
  const mvpFeatures = defaultMvpFeatures(classification, intake);
  const productType = classification.primaryClassification;
  const platform = findAnswer(intake, "platform") ?? "web app";
  const fullSpecExtraction = extractFullProjectSpec({
    text: intake.userRequest,
    classification: productType,
    requiredPlanner: planner,
  });
  const productBrief: ProductBrief = {
    summary: intake.understoodSummary,
    productType,
    platform,
    mvpFeatures: fullSpecExtraction.mvpFeatures.length ? fullSpecExtraction.mvpFeatures : mvpFeatures,
    targetUsers: [],
    launchTarget: "MVP",
  };

  const milestoneId = `mvp-${planner.replace(/Planner$/, "").toLowerCase()}`;
  const phaseTasks = [
    task(`${milestoneId}-scope`, "Confirm MVP scope", "Lock the first user-visible workflow before any files are written."),
    task(`${milestoneId}-architecture`, "Review architecture", "Confirm the specialized planner architecture before Foundation."),
    task(`${milestoneId}-foundation`, "Prepare foundation plan", "Generate the approved foundation files for this project type."),
  ];

  return {
    planner,
    mvpDefinition: `${productType} MVP: ${productBrief.mvpFeatures.slice(0, 5).join(", ")}. NF will plan this with ${planner}, not the generic software planner.`,
    productBrief,
    features: productBrief.mvpFeatures,
    screens: defaultScreens(planner),
    dataModels: [`${plannerLabel(planner)} core records`],
    apis: planner === "backendServicePlanner" ? ["Core REST endpoints"] : [],
    integrations: fullSpecExtraction.awsDomainRequirements,
    architectureRecommendation: defaultArchitecture(planner),
    designSystem: ["Clear founder-readable layout", "Mobile-friendly defaults", "Simple navigation"],
    dependencyGraph: [
      {
        id: "scope",
        label: "MVP scope",
        dependsOn: [],
        reason: "Scope must be approved before implementation.",
      },
      {
        id: "architecture",
        label: "Architecture review",
        dependsOn: ["scope"],
        reason: "Architecture must be checked before Foundation files.",
      },
      {
        id: "foundation",
        label: "Foundation files",
        dependsOn: ["architecture"],
        reason: "Foundation files start only after approval.",
      },
    ],
    milestones: [
      {
        id: milestoneId,
        title: `${productType} MVP`,
        goal: `Deliver the first usable ${productType.toLowerCase()} version.`,
        items: productBrief.mvpFeatures.slice(0, 6),
      },
      {
        id: `${milestoneId}-polish`,
        title: "Polish and validation",
        goal: "Improve UX and run build/test checks.",
        items: ["Error states", "Founder demo path", "Basic quality checks"],
        deferred: true,
      },
    ],
    phaseTasks: {
      [milestoneId]: phaseTasks,
      "mvp-features": phaseTasks,
    },
    qualityGates: {
      [milestoneId]: [
        qualityGate("planner-lock", "Planner lock", `Plan stays on ${planner}.`),
        qualityGate("approval", "Founder approval", "No project files before approval."),
      ],
    },
    successCriteria: [
      `The ${productType.toLowerCase()} MVP is understandable to a non-technical founder.`,
      "Explicit requirements from the prompt are preserved.",
      "Missing details use safe defaults.",
    ],
    deferredFeatures: fullSpecExtraction.postMvpFeatures,
    founderSummary: [
      `NF understood this as a ${productType} project.`,
      `First build focus: ${productBrief.mvpFeatures.slice(0, 4).join(", ")}.`,
      "NF will stop for your approval before writing files.",
    ].join(" "),
    developerDetails: [
      `lockedPlanner=${planner}`,
      `classification=${productType}`,
      `plannerMode=foundation`,
    ],
    fullSpecExtraction,
  };
}
