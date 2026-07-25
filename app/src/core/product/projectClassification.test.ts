import { createDiscoveryIntake } from "./discoveryIntake";
import { classifyProjectRequest, websitePlatformPlannerProfile } from "./projectClassification";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const websitePlatform = classifyProjectRequest(
  "Build the NF Web Platform, a website builder that creates industry templates, layout templates, pages, sections, SEO, analytics, lead generation forms, publishing, hosting, domains, and a media library."
);
assert(
  websitePlatform.primaryClassification === "Website Platform / Website Builder",
  "Website Platform request should use the specialized website platform classification"
);
assert(websitePlatform.requiredPlanner === "websitePlatformPlanner", "Website Platform should route to website platform planner");
assert(websitePlatform.confidence === "high", "Website Platform should classify with high confidence");
assert(
  websitePlatform.plannerProfile.understands.includes("industry templates") &&
    websitePlatform.plannerProfile.understands.includes("publishing") &&
    websitePlatform.plannerProfile.understands.includes("domains"),
  "Website Platform planner should understand website-builder concerns"
);
assert(
  websitePlatform.founderSummary === "NF detected this as a Website Platform / Website Builder project.",
  "Founder Mode summary should explain the detected Website Platform project"
);
assert(
  websitePlatform.developerDetails.some((detail) => detail.includes("planner=websitePlatformPlanner")),
  "Developer Mode details should expose raw planner routing"
);

const businessWebsite = classifyProjectRequest(
  "Create a business website for a local restaurant with services, menu pages, SEO, and a contact form."
);
assert(businessWebsite.primaryClassification === "Business Website", "Business website should classify separately from website platform");
assert(businessWebsite.requiredPlanner === "businessWebsitePlanner", "Business website should route to business website planner");

const saas = classifyProjectRequest("Build a SaaS subscription dashboard with teams, billing, accounts, and admin workflows.");
assert(saas.primaryClassification === "SaaS", "SaaS request should classify as SaaS");
assert(saas.requiredPlanner === "saasPlanner", "SaaS should route to SaaS planner");

const mobile = classifyProjectRequest("Build a mobile app for iOS and Android that tracks workouts.");
assert(mobile.primaryClassification === "Mobile App", "Mobile app request should classify as Mobile App");
assert(mobile.requiredPlanner === "mobileAppPlanner", "Mobile App should route to mobile planner");

const aiAgent = classifyProjectRequest("Create an AI agent with tools, memory, autonomous workflows, and model prompts.");
assert(aiAgent.primaryClassification === "AI Agent", "AI Agent request should classify as AI Agent");
assert(aiAgent.requiredPlanner === "aiAgentPlanner", "AI Agent should route to AI agent planner");

const ambiguous = classifyProjectRequest("I want to build something useful for people.");
assert(ambiguous.confidence === "low", "Ambiguous request should have low confidence");
assert(ambiguous.missingClarificationQuestions.length > 0, "Low-confidence classification should ask clarification questions");
assert(ambiguous.requiredPlanner === "generalSoftwarePlanner", "Ambiguous request should fall back to general planner");

const intake = createDiscoveryIntake("Build a website builder app for small businesses with templates and publishing.");
const classifiedFromIntake = classifyProjectRequest(intake);
assert(
  classifiedFromIntake.primaryClassification === "Website Platform / Website Builder",
  "Classifier should work from Discovery Intake, not only raw text"
);

assert(
  websitePlatformPlannerProfile.planningFocus.some((item) => item.includes("template")),
  "Website Platform planner profile should be reusable by future planners"
);

console.log("project classification regression passed");
