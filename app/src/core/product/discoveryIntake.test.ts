import { createDiscoveryIntake } from "./discoveryIntake";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const intake = createDiscoveryIntake("Build me a budgeting app");

function answerValue(key: string): string {
  return intake.inferredAnswers.find((item) => item.key === key)?.value ?? "";
}

function hasQuestion(key: string): boolean {
  return intake.unansweredQuestions.some((item) => item.key === key);
}

assert(intake.userRequest === "Build me a budgeting app", "preserves the user request");
assert(intake.understoodSummary.includes("budgeting app"), "summarizes the inferred budgeting app");
assert(answerValue("productType") === "budgeting app", "infers budgeting app product type");
assert(answerValue("platform") === "web app", "defaults unspecified app platform to web app");
assert(
  answerValue("mvpFeatures") === "income, expenses, categories, dashboard",
  "infers budgeting MVP features"
);
assert(answerValue("accounts") === "later unless requested", "defaults accounts to later unless requested");
assert(answerValue("charts") === "basic charts", "infers basic charts for a budgeting app");
assert(answerValue("mobileApps") === "later", "defaults mobile apps to later");

assert(hasQuestion("audience"), "asks whether this is personal use or multiple users");
assert(hasQuestion("accountsTiming"), "asks whether accounts are needed now or later");
assert(hasQuestion("sync"), "asks whether data should sync across devices");
assert(hasQuestion("launchTarget"), "asks whether this is for demo, MVP, or production launch");
assert(
  intake.unansweredQuestions.every((question) => question.blocksBuild === false),
  "useful budgeting app questions should not block the build"
);

assert(intake.canContinue, "allows continuation with safe defaults");
assert(
  intake.recommendedDefaults.some((item) => item.key === "platform" && item.value === "web app"),
  "recommends web app as the default platform"
);
assert(
  intake.assumptions.some((item) => item.toLowerCase().includes("safest practical defaults")),
  "stores safe-default assumptions"
);
assert(
  intake.decisionsRequiringLaterConfirmation.length > 0,
  "stores decisions requiring later confirmation"
);
assert(intake.confidenceLevel !== "low", "marks confidence as medium or high");
assert(
  intake.userConfirmedAnswers.length === 0,
  "does not mutate user-confirmed answers or perform project writes"
);

console.log("discovery intake regression passed");
