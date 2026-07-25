import { isValidElement, type ReactNode } from "react";
import { createDiscoveryIntake } from "../core/product/discoveryIntake";
import type { DiscoveryIntake } from "../core/types";
import { DiscoveryIntakeCard } from "./DiscoveryIntakeCard";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function childrenOf(node: ReactNode): ReactNode[] {
  if (!isValidElement(node)) return [];
  const children = (node.props as { children?: ReactNode }).children;
  return Array.isArray(children) ? children : children == null ? [] : [children];
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return childrenOf(node).map(textOf).join("");
  return "";
}

function findButtons(node: ReactNode): Array<{ disabled?: boolean; onClick?: () => void; text: string }> {
  const out: Array<{ disabled?: boolean; onClick?: () => void; text: string }> = [];
  function visit(item: ReactNode): void {
    if (!isValidElement(item)) return;
    if (item.type === "button") {
      const props = item.props as { disabled?: boolean; onClick?: () => void };
      out.push({ disabled: props.disabled, onClick: props.onClick, text: textOf(item) });
    }
    for (const child of childrenOf(item)) visit(child);
  }
  visit(node);
  return out;
}

const intake = createDiscoveryIntake("Build me a budgeting app");
let continued = 0;
const founderCard = DiscoveryIntakeCard({
  intake,
  developerMode: false,
  onContinueWithDefaults: () => {
    continued += 1;
  },
});
const founderText = textOf(founderCard);

assert(founderText.includes("Discovery Intake"), "card renders discovery intake title");
assert(founderText.includes(intake.understoodSummary), "card renders understood summary");
assert(founderText.includes("What NF understood"), "founder summary clearly renders what NF understood");
assert(founderText.includes("Product idea"), "founder summary labels product idea");
assert(founderText.includes("Build me a budgeting app"), "founder summary renders original product idea");
assert(founderText.includes("Product type") || founderText.includes("budgeting app"), "founder summary renders product type");
assert(founderText.includes("Target users"), "founder summary renders target users");
assert(founderText.includes("personal use for the first MVP"), "founder summary renders inferred target-user default");
assert(founderText.includes("Platform default"), "founder summary labels platform default");
assert(founderText.includes("budgeting app"), "card renders inferred product type");
assert(founderText.includes("web app"), "card renders inferred/default platform");
assert(founderText.includes("MVP direction"), "founder summary labels MVP direction");
assert(founderText.includes("income, expenses, categories, dashboard"), "card renders inferred MVP features");
assert(founderText.includes("If you continue"), "founder summary explains what NF will assume if the user continues");
assert(founderText.includes("safest practical defaults"), "assumptions are visible before continuing");
assert(founderText.includes("Accounts are set to later unless requested"), "founder summary renders account assumption");
assert(founderText.includes("Recommended defaults"), "card renders recommended defaults");
assert(founderText.includes("If you skip the optional questions"), "recommended defaults explain they are used when skipped");
assert(founderText.includes("Used if skipped"), "recommended defaults are marked as used if skipped");
assert(founderText.includes("Platform"), "recommended defaults render default label");
assert(founderText.includes("Launch target"), "recommended defaults render launch target label");
assert(founderText.includes("MVP"), "recommended defaults render default value");
assert(founderText.includes("Fastest to build, demo, test, share"), "Founder Mode shows default reason");
assert(founderText.includes("Keeps the first MVP smaller and faster"), "Founder Mode shows account default reason");
assert(founderText.includes("Avoids backend complexity"), "Founder Mode shows sync default reason");
assert(founderText.includes("What NF inferred"), "card renders clear inferred answers section");
assert(founderText.includes("NF inferred this"), "Founder Mode shows friendly inferred source wording");
assert(founderText.includes("NF defaulted this"), "Founder Mode shows friendly default source wording");
assert(founderText.includes("high confidence"), "Founder Mode shows answer confidence");
assert(founderText.includes("The wording in your request points to this product category."), "Founder Mode shows short inferred-answer reason");
assert(founderText.includes("Web is the safest first platform"), "Founder Mode shows platform inference/default reason");
assert(founderText.includes("Material questions"), "card renders material questions prominently");
assert(founderText.includes("Is this for personal use or multiple users?"), "card renders unanswered questions");
assert(!founderText.includes("key: launchTarget"), "Founder Mode hides structured default keys");
assert(!founderText.includes("key: productType"), "Founder Mode hides structured answer keys");
assert(!founderText.includes("Assumptions"), "Founder Mode hides assumptions by default");
assert(!founderText.includes("Confirm later"), "Founder Mode hides later-confirmation details by default");

const founderButtons = findButtons(founderCard);
const continueButton = founderButtons.find((button) => button.text.includes("Continue with NF defaults"));
assert(Boolean(continueButton), "card renders continue with NF defaults action");
assert(continueButton?.disabled !== true, "continue action is enabled when canContinue is true");
assert(founderText.includes("NF will use the defaults above"), "continue action explains defaults will be used");
assert(founderText.includes("No files are created yet"), "continue action does not imply file generation");
continueButton?.onClick?.();
assert(continued === 1, "continue action calls handler when canContinue is true");

const developerCard = DiscoveryIntakeCard({
  intake,
  developerMode: true,
  onContinueWithDefaults: () => {},
});
const developerText = textOf(developerCard);
assert(developerText.includes("Fastest to build, demo, test, share"), "Developer Mode can show default reasons");
assert(developerText.includes("key: platform"), "Developer Mode can show structured default key details");
assert(developerText.includes("key: launchTarget"), "Developer Mode can show structured launch default key details");
assert(developerText.includes("Assumptions"), "Developer Mode can show assumptions");
assert(developerText.includes("Confirm later"), "Developer Mode can show later-confirmation decisions");
assert(developerText.includes("All intake questions"), "Developer Mode can show the full question list");
assert(developerText.includes("key: productType; source: inferred; confidence: high"), "Developer Mode can show structured source/confidence details");
assert(developerText.includes("key: platform; source: default; confidence: high"), "Developer Mode can show default source/confidence details");

const largeIdea = `Build me a website platform. ${"This line contains detailed founder requirements, workflows, constraints, and planning notes. ".repeat(80)}`;
const largeIdeaCard = DiscoveryIntakeCard({
  intake: createDiscoveryIntake(largeIdea),
  developerMode: false,
  onContinueWithDefaults: () => {},
});
const largeIdeaText = textOf(largeIdeaCard);
assert(largeIdeaText.includes("more characters hidden in the UI"), "large intake prompts should be clipped in the UI");
assert(largeIdeaText.includes("full text is preserved for planning"), "large intake prompt clipping should explain data is preserved");

const nonMaterialIntake: DiscoveryIntake = {
  ...intake,
  unansweredQuestions: [
    ...intake.unansweredQuestions,
    {
      key: "brandTone",
      question: "Should the app feel playful or formal?",
      whyItMatters: "This can be refined during polish.",
      recommendedDefault: "clean and simple",
      blocksBuild: false,
    },
  ],
};
const nonMaterialFounderCard = DiscoveryIntakeCard({
  intake: nonMaterialIntake,
  developerMode: false,
  onContinueWithDefaults: () => {},
});
const nonMaterialFounderText = textOf(nonMaterialFounderCard);
assert(nonMaterialFounderText.includes("Material questions"), "material questions remain prominent in Founder Mode");
assert(!nonMaterialFounderText.includes("Should the app feel playful or formal?"), "non-material questions are hidden in Founder Mode");

const nonMaterialDeveloperCard = DiscoveryIntakeCard({
  intake: nonMaterialIntake,
  developerMode: true,
  onContinueWithDefaults: () => {},
});
const nonMaterialDeveloperText = textOf(nonMaterialDeveloperCard);
assert(nonMaterialDeveloperText.includes("Should the app feel playful or formal?"), "Developer Mode can show non-material questions");
assert(nonMaterialDeveloperText.includes("Developer detail"), "Developer Mode labels non-material questions as developer details");

let nonMaterialBlockingContinued = 0;
const nonMaterialBlockingCard = DiscoveryIntakeCard({
  intake: {
    ...intake,
    canContinue: false,
    unansweredQuestions: [
      {
        key: "brandTone",
        question: "Should the app feel playful or formal?",
        whyItMatters: "This can be refined during polish.",
        recommendedDefault: "clean and simple",
        blocksBuild: true,
      },
    ],
  },
  developerMode: false,
  onContinueWithDefaults: () => {
    nonMaterialBlockingContinued += 1;
  },
});
const nonMaterialBlockingButton = findButtons(nonMaterialBlockingCard).find((button) =>
  button.text.includes("Continue with NF defaults")
);
assert(nonMaterialBlockingButton?.disabled !== true, "non-material questions do not block continuation");
nonMaterialBlockingButton?.onClick?.();
assert(nonMaterialBlockingContinued === 1, "non-material blocked questions do not suppress the continue handler");

const blockedIntake: DiscoveryIntake = {
  ...intake,
  canContinue: false,
  unansweredQuestions: [
    {
      key: "requiredDecision",
      question: "Which customer owns the first workflow?",
      whyItMatters: "NF cannot choose the first workflow safely.",
      recommendedDefault: "choose the highest-value user",
      blocksBuild: true,
    },
  ],
};
let blockedContinued = 0;
const blockedCard = DiscoveryIntakeCard({
  intake: blockedIntake,
  developerMode: true,
  onContinueWithDefaults: () => {
    blockedContinued += 1;
  },
});
const blockedText = textOf(blockedCard);
const blockedButton = findButtons(blockedCard).find((button) => button.text.includes("Answer required questions first"));

assert(blockedText.includes("Questions before NF can continue"), "blocked card shows blocking state");
assert(blockedText.includes("Which customer owns the first workflow?"), "blocked card renders blocking question");
assert(blockedText.includes("NF needs the blocking answers"), "blocked card explains why continue is blocked");
assert(blockedButton?.disabled === true, "blocked card disables continue action");
blockedButton?.onClick?.();
assert(blockedContinued === 0, "blocked card does not expose an active continue handler");

console.log("discovery intake card regression passed");
