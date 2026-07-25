import type {
  DiscoveryIntake,
  PhaseTask,
  ProductBrief,
  ProjectClassificationResult,
  QualityGate,
  SpecializedPlannerOutput,
} from "../../types";
import { extractFullProjectSpec } from "../fullSpecExtraction";

const MVP_FEATURES = [
  "website projects",
  "industry templates",
  "layout templates",
  "page/section builder",
  "theme engine",
  "media library",
  "forms",
  "lead database",
  "basic analytics",
  "preview",
  "publishing/export design",
  "user accounts/settings",
];

const DEFERRED_AI_FEATURES = [
  "AI page generation",
  "AI copywriting",
  "AI SEO",
  "AI image recommendations",
  "AI chatbot",
  "advanced drag-and-drop editor",
];

function task(
  id: string,
  title: string,
  rationale: string,
  sourceGapKeys: string[] = [],
  constraints: string[] = []
): PhaseTask {
  return { id, title, rationale, sourceGapKeys, constraints, status: "todo" };
}

function qualityGate(id: string, title: string, check: string, required = true): QualityGate {
  return { id, title, check, required, status: "pending" };
}

function createProductBrief(): ProductBrief {
  return {
    summary: [
      "Build an internal NF-owned Website Platform / Website Builder for non-technical users.",
      "The MVP creates reusable websites from industry and layout templates, collects leads, shows basic analytics, previews sites, and prepares or exports sites for hosting.",
      "AI features are intentionally deferred until after the non-AI MVP is usable.",
    ].join(" "),
    productType: "Website Platform / Website Builder",
    platform: "web app",
    mvpFeatures: MVP_FEATURES,
    targetUsers: [
      "non-technical founders",
      "small businesses",
      "NF internal builders",
      "technical users who want faster website setup",
    ],
    launchTarget: "MVP Website Platform",
  };
}

export function isWebsitePlatformClassification(classification: ProjectClassificationResult | null | undefined): boolean {
  return classification?.requiredPlanner === "websitePlatformPlanner" ||
    classification?.primaryClassification === "Website Platform / Website Builder";
}

export function createWebsitePlatformPlannerOutput(
  intake: DiscoveryIntake,
  classification: ProjectClassificationResult
): SpecializedPlannerOutput {
  const fullSpecExtraction = extractFullProjectSpec({
    text: intake.userRequest,
    classification: classification.primaryClassification,
    requiredPlanner: classification.requiredPlanner,
  });
  const productBrief = createProductBrief();
  const mvpFeatures = Array.from(new Set([...MVP_FEATURES, ...fullSpecExtraction.mvpFeatures]));
  const deferredFeatures = Array.from(new Set([...DEFERRED_AI_FEATURES, ...fullSpecExtraction.postMvpFeatures]));
  const infrastructureIntegrations = fullSpecExtraction.awsDomainRequirements.length
    ? fullSpecExtraction.awsDomainRequirements.map((requirement) => `${requirement} planned through explicit approval gates`)
    : ["Static export or simple hosting boundary for MVP", "Domain configuration design only for MVP"];

  return {
    planner: "websitePlatformPlanner",
    mvpDefinition:
      "The MVP lets a user create a website project, choose an industry template and independent layout template, edit pages/sections, manage theme/media/forms/leads, preview the site, view basic analytics, and prepare/export the site for hosting without AI assistance.",
    productBrief: {
      ...productBrief,
      mvpFeatures,
    },
    features: mvpFeatures,
    screens: [
      "Project dashboard",
      "Website project setup",
      "Industry template picker",
      "Layout template picker",
      "Page and section editor",
      "Theme settings",
      "Media library",
      "Forms and lead inbox",
      "Basic analytics",
      "Preview",
      "Publishing/export settings",
      "User account/settings",
    ],
    dataModels: [
      "WebsiteProject",
      "IndustryTemplate",
      "LayoutTemplate",
      "Page",
      "Section",
      "NavigationItem",
      "ThemeTokens",
      "MediaAsset",
      "LeadForm",
      "LeadRecord",
      "AnalyticsEvent",
      "PublishTarget",
      "UserAccountSettings",
    ],
    apis: [
      "Project CRUD",
      "Template catalog read APIs",
      "Page/section update APIs",
      "Theme update APIs",
      "Media upload/list APIs",
      "Lead form submission APIs",
      "Analytics event recording APIs",
      "Preview render APIs",
      "Publishing/export preparation APIs",
    ],
    integrations: [
      ...infrastructureIntegrations,
      "Analytics storage owned by NF for MVP",
      "AI providers deferred until post-MVP phases",
    ],
    architectureRecommendation: [
      "Use a web app first so the platform is fast to build, demo, test, and share.",
      "Model website projects as structured data before generating files.",
      "Keep industry templates separate from layout templates.",
      "Industry templates define required pages, recommended sections, forms, SEO placeholders, analytics goals, and conversion goals.",
      "Layout templates define visual style, section arrangement, spacing, colors, typography, and presentation.",
      "Changing layout must preserve content, forms, analytics, navigation, and business data.",
      "Keep publishing/export simple in MVP; design hosting/domain boundaries without overbuilding infrastructure.",
      ...(fullSpecExtraction.awsDomainRequirements.length
        ? [`Treat ${fullSpecExtraction.awsDomainRequirements.join(", ")} as explicit infrastructure boundaries that require founder approval before implementation depends on them.`]
        : []),
      `Account model: ${fullSpecExtraction.accountUserModel ?? "confirm account/user model during Foundation"}.`,
      "Defer AI page generation, AI copywriting, AI SEO, AI image recommendations, AI chatbot, and advanced drag-and-drop until after MVP.",
    ],
    designSystem: [
      "Template-driven layouts with reusable sections.",
      "Theme tokens for color, typography, spacing, radius, and surface styles.",
      "Founder-first wording for non-technical users.",
      "Developer-visible schema and preview validation details.",
    ],
    dependencyGraph: [
      { id: "website-project-model", label: "Website project model", dependsOn: [], reason: "Everything is organized around website projects." },
      { id: "industry-template-model", label: "Industry template model", dependsOn: ["website-project-model"], reason: "Industry templates define business content structure and goals." },
      { id: "layout-template-model", label: "Layout template model", dependsOn: ["website-project-model"], reason: "Layout templates define visual presentation independently from business content." },
      { id: "page-section-schema", label: "Page and section schema", dependsOn: ["industry-template-model", "layout-template-model"], reason: "Pages and sections combine industry content needs with layout presentation." },
      { id: "theme-engine", label: "Theme engine", dependsOn: ["layout-template-model"], reason: "Theme tokens style layouts without changing business content." },
      { id: "editor-shell", label: "Page/section editor shell", dependsOn: ["page-section-schema", "theme-engine"], reason: "The editor needs structured content and styling primitives." },
      { id: "preview-renderer", label: "Preview renderer", dependsOn: ["editor-shell"], reason: "Users must preview generated websites before export/publishing." },
      { id: "media-library", label: "Media library", dependsOn: ["website-project-model"], reason: "Website projects need reusable assets." },
      { id: "forms-leads", label: "Forms and lead database", dependsOn: ["page-section-schema"], reason: "Lead capture is core to the MVP." },
      { id: "analytics", label: "Basic analytics", dependsOn: ["preview-renderer", "forms-leads"], reason: "The MVP tracks site activity and conversions." },
      { id: "publishing-export", label: "Publishing/export design", dependsOn: ["preview-renderer", "analytics"], reason: "Sites need a simple path toward hosting without overbuilt infrastructure." },
      { id: "accounts-settings", label: "User accounts/settings", dependsOn: ["website-project-model"], reason: fullSpecExtraction.accountUserModel ?? "Users need ownership and settings for their website projects." },
      { id: "ai-post-mvp", label: "AI features after MVP", dependsOn: ["publishing-export"], reason: "AI should enhance a working platform, not replace the first build path." },
    ],
    milestones: [
      { id: "mvp-website-platform", title: "MVP Website Platform", goal: "Build the non-AI website platform MVP.", items: mvpFeatures },
      { id: "ai-feature-integration", title: "AI Feature Integration", goal: "Add AI generation support after the MVP workflow works manually.", items: ["AI page generation", "AI copywriting", "AI SEO", "AI image recommendations"], deferred: true },
      { id: "ai-chatbot", title: "AI Chatbot", goal: "Add optional site chatbot capabilities after core publishing and analytics are stable.", items: ["AI chatbot"], deferred: true },
      { id: "advanced-drag-and-drop-editor", title: "Advanced Drag-and-Drop Editor", goal: "Add richer editing interactions after template-driven editing is stable.", items: ["advanced drag-and-drop editor"], deferred: true },
    ],
    phaseTasks: {
      discovery: [
        task("discovery-confirm-website-platform-blueprint", "Confirm Website Platform Blueprint", "Confirm the Website Platform-specific MVP scope, template separation, deferred AI roadmap, and founder decisions before planning implementation."),
      ],
      foundation: [
        task("foundation-model-website-projects", "Define website project data model", "Create the schema contract for website projects before UI or publishing work.", ["website-project-model"]),
        task("foundation-model-template-separation", "Define industry and layout template schemas separately", "Industry templates and layout templates must remain separate to avoid mixing business content with presentation.", ["industry-template-model", "layout-template-model"]),
        task("foundation-model-pages-sections-themes", "Define page, section, navigation, and theme contracts", "Pages, sections, navigation, and theme tokens are the base for editor, preview, and export.", ["page-section-schema", "theme-engine"]),
      ],
      "mvp-features": [
        task("mvp-build-project-setup", "Build website project creation workflow", "Users need to create and manage website projects before editing content.", ["website-project-model"]),
        task("mvp-build-industry-template-picker", "Build industry template picker", "Users need reusable business-specific templates such as Roofing, HIEN, and NF.", ["industry-template-model"]),
        task("mvp-build-layout-template-picker", "Build layout template picker", "Users need independent visual layouts that preserve content, forms, analytics, navigation, and business data.", ["layout-template-model"]),
        task("mvp-build-page-section-editor", "Build page and section editor", "Users need a simple template-driven editor before advanced drag-and-drop.", ["page-section-schema"]),
        task("mvp-build-theme-engine", "Build theme engine", "Users need colors, typography, spacing, and presentation controls without altering content.", ["theme-engine"]),
        task("mvp-build-media-library", "Build media library", "Website projects need reusable images and assets.", ["media-library"]),
        task("mvp-build-forms-leads", "Build forms and lead database", "Lead capture is part of the MVP, not a later add-on.", ["forms-leads"]),
        task("mvp-build-basic-analytics", "Build basic analytics", "The MVP needs simple visit, form, and conversion tracking.", ["analytics"]),
        task("mvp-build-preview", "Build website preview", "Users need to inspect generated sites before publishing/export.", ["preview-renderer"]),
        task("mvp-build-publishing-export-design", "Build publishing/export preparation", "Prepare sites for hosting/export without overbuilding full hosting automation in MVP.", ["publishing-export"]),
        task("mvp-build-accounts-settings", "Build user accounts and settings", fullSpecExtraction.accountUserModel ?? "Users need ownership and settings for website projects.", ["accounts-settings"]),
      ],
      "testing-stabilization": [
        task("testing-validate-roofing-template", "Validate Roofing website can be created", "MVP success requires a Roofing website from reusable templates.", ["industry-template-model", "layout-template-model"]),
        task("testing-validate-hien-template", "Validate HIEN website can be created", "MVP success requires a HIEN website from reusable templates.", ["industry-template-model", "layout-template-model"]),
        task("testing-validate-nf-template", "Validate NF website can be created", "MVP success requires an NF website from reusable templates.", ["industry-template-model", "layout-template-model"]),
        task("testing-validate-preview-export-leads-analytics", "Validate preview, export readiness, leads, and analytics", "MVP success requires preview, hosting/export preparation, lead tracking, and basic analytics.", ["preview-renderer", "publishing-export", "forms-leads", "analytics"]),
      ],
    },
    qualityGates: {
      "mvp-features": [
        qualityGate("website-platform-preview-renders", "Preview renders generated sites", "Roofing, HIEN, and NF websites can be previewed from reusable templates."),
        qualityGate("website-platform-lead-capture", "Lead capture works", "Forms submit into a lead database and preserve site/project context."),
        qualityGate("website-platform-analytics-recorded", "Analytics events are recorded", "Basic page view, form submission, and conversion events are tracked."),
        qualityGate("website-platform-export-ready", "Publishing/export is ready", "A generated site can be prepared or exported for hosting without overbuilt hosting automation."),
        qualityGate("website-platform-template-preservation", "Template separation is preserved", "Changing layout preserves content, forms, analytics, navigation, and business data."),
      ],
      "testing-stabilization": [
        qualityGate("website-platform-roofing-created", "Roofing site created", "A Roofing website can be created from reusable industry and layout templates."),
        qualityGate("website-platform-hien-created", "HIEN site created", "A HIEN website can be created from reusable industry and layout templates."),
        qualityGate("website-platform-nf-created", "NF site created", "An NF website can be created from reusable industry and layout templates."),
      ],
    },
    successCriteria: [
      "Roofing website can be created from reusable templates.",
      "HIEN website can be created from reusable templates.",
      "NF website can be created from reusable templates.",
      "Sites can be previewed.",
      "Sites can be prepared/exported for hosting.",
      "Leads and basic analytics are tracked.",
    ],
    deferredFeatures,
    founderSummary:
      "NF will first build a simple non-AI website platform: create a website project, choose industry and layout templates, edit pages and sections, manage media/forms/leads/analytics, preview the site, and prepare it for hosting. AI and advanced drag-and-drop come later.",
    developerDetails: [
      `planner=${classification.requiredPlanner}`,
      "industryTemplates=business content/pages/sections/forms/SEO/analytics/conversion goals",
      "layoutTemplates=visual style/arrangement/spacing/colors/typography/presentation",
      "mvpTemplates=Roofing, HIEN, NF",
      `deferred=${DEFERRED_AI_FEATURES.join(", ")}`,
      "publishing=prepare/export boundary in MVP, not full hosting automation",
      `fullSpecSummary=${fullSpecExtraction.uiSummary}`,
      `awsDomainRequirements=${fullSpecExtraction.awsDomainRequirements.join(", ") || "none"}`,
      `accountUserModel=${fullSpecExtraction.accountUserModel ?? "not inferred"}`,
    ],
    templateSeparationRules: [
      "Industry templates define required pages, recommended sections, lead forms, SEO placeholders, analytics goals, and conversion goals.",
      "Layout templates define visual style, section arrangement, spacing, colors, typography, and presentation.",
      "Changing layout must preserve content, forms, analytics, navigation, and business data.",
    ],
    fullSpecExtraction,
  };
}
