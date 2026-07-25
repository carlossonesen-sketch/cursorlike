import { createDiscoveryIntake } from "../product/discoveryIntake";
import { assessExistingProduct } from "../product/existingProductAssessment";
import { createGapAnalysis } from "../product/gapAnalysis";
import {
  attachExistingProductAssessment,
  attachGapAnalysis,
  attachPhaseBuildPlan,
  createProjectBlueprintFromDiscoveryIntake,
} from "../product/projectBlueprint";
import { createPhaseBuildPlan } from "./phaseBuildPlan";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const expectedPhaseTitles = [
  "Discovery",
  "Architecture Review",
  "Foundation",
  "MVP Features",
  "Testing/Stabilization",
  "Polish",
  "Launch Readiness",
];

function phaseTitles(plan: { phases: { title: string }[] }): string[] {
  return plan.phases.map((phase) => phase.title);
}

function phaseById(plan: ReturnType<typeof createPhaseBuildPlan>, id: string) {
  const phase = plan.phases.find((item) => item.id === id);
  assert(Boolean(phase), `expected phase ${id}`);
  return phase!;
}

function assertEveryPhaseHasGates(plan: ReturnType<typeof createPhaseBuildPlan>): void {
  for (const phase of plan.phases) {
    assert(Boolean(phase.id), `${phase.title} should have id`);
    assert(Boolean(phase.title), `${phase.id} should have title`);
    assert(Boolean(phase.goal), `${phase.title} should have goal`);
    assert(phase.tasks.length > 0, `${phase.title} should have tasks`);
    assert(phase.definitionOfDone.length > 0, `${phase.title} should have definition of done`);
    assert(phase.qualityGates.length > 0, `${phase.title} should have quality gates`);
    assert(phase.approvalGate.requiresApproval, `${phase.title} should require approval gate`);
    assert(Boolean(phase.status), `${phase.title} should have status`);
  }
}

const newBlueprint = createProjectBlueprintFromDiscoveryIntake(createDiscoveryIntake("Build me a budgeting app"), {
  id: "blueprint-new-budgeting-app",
  projectId: "new-budgeting-app",
  now: "2026-06-27T00:00:00.000Z",
});
const newGap = createGapAnalysis(newBlueprint, "2026-06-27T01:00:00.000Z");
const newPlan = createPhaseBuildPlan(newBlueprint, newGap, "2026-06-27T02:00:00.000Z");

assert(
  phaseTitles(newPlan).join("|") === expectedPhaseTitles.join("|"),
  "new project Blueprint should generate the default phase plan"
);
assert(newPlan.currentPhaseId === "discovery", "new plan starts at Discovery");
assertEveryPhaseHasGates(newPlan);
assert(
  phaseById(newPlan, "architecture-review").qualityGates.some((gate) => gate.id === "architecture-review-no-critical-blockers"),
  "Architecture Review phase should require no critical blockers before Foundation"
);

const newMvpPhase = phaseById(newPlan, "mvp-features");
assert(
  newMvpPhase.tasks.some((task) => task.title === "Build income"),
  "missing MVP feature income becomes MVP phase task"
);
assert(
  newMvpPhase.tasks.some((task) => task.title === "Build expenses"),
  "missing MVP feature expenses becomes MVP phase task"
);

const testingIndex = phaseTitles(newPlan).indexOf("Testing/Stabilization");
const polishIndex = phaseTitles(newPlan).indexOf("Polish");
const mvpIndex = phaseTitles(newPlan).indexOf("MVP Features");
assert(mvpIndex < testingIndex, "MVP Features should come before Testing/Stabilization");
assert(testingIndex < polishIndex, "Polish should come after Testing/Stabilization");

const reactAssessment = assessExistingProduct({
  projectPath: "D:\\dev\\nf-projects\\budget-react",
  files: [
    {
      path: "package.json",
      content: JSON.stringify({
        scripts: { build: "tsc && vite build", test: "vitest" },
        dependencies: { react: "^19.0.0", "@tauri-apps/api": "^2" },
        devDependencies: { vite: "^7.0.0" },
      }),
    },
    { path: "src/main.tsx", content: "import { createRoot } from 'react-dom/client';" },
    { path: "src/App.tsx", content: "export function App() { return <Dashboard />; }" },
    { path: "src/components/Dashboard.tsx", content: "export function Dashboard() { return null; }" },
    { path: "src/components/ExpenseList.tsx", content: "export function ExpenseList() { return null; }" },
    { path: "src/routes/routes.ts", content: "export const routes = [];" },
    { path: "src-tauri/tauri.conf.json", content: "{}" },
  ],
});

const existingBlueprint = attachExistingProductAssessment(
  createProjectBlueprintFromDiscoveryIntake(createDiscoveryIntake("Build me a budgeting app"), {
    id: "blueprint-existing-budgeting-app",
    projectId: "existing-budgeting-app",
    source: "existingProject",
    now: "2026-06-27T00:00:00.000Z",
  }),
  reactAssessment,
  "2026-06-27T01:00:00.000Z"
);
const existingGap = createGapAnalysis(existingBlueprint, "2026-06-27T02:00:00.000Z");
const existingPlan = createPhaseBuildPlan(existingBlueprint, existingGap, "2026-06-27T03:00:00.000Z");

assert(
  existingPlan.preservationSummary.includes("Preservation-first"),
  "existing project phase plan should summarize preservation-first behavior"
);
assert(
  phaseById(existingPlan, "discovery").tasks.some((task) => task.id === "discovery-review-inventory"),
  "existing project phase plan should review inventory"
);
assert(
  phaseById(existingPlan, "foundation").tasks.some((task) => task.id === "foundation-preserve-existing-product"),
  "existing project phase plan should lock preservation boundaries"
);

const existingMvpTasks = phaseById(existingPlan, "mvp-features").tasks;
assert(
  existingMvpTasks.some((task) => task.title === "Build income"),
  "existing project missing feature becomes MVP phase task"
);
assert(
  existingMvpTasks.some((task) => task.constraints.some((constraint) => constraint.includes("Preserve existing working UI"))),
  "preservation rules become task constraints"
);
assert(
  existingMvpTasks.some((task) => task.constraints.some((constraint) => constraint.includes("extend rather than rewrite"))),
  "preservation warnings become task constraints"
);

const blueprintWithGap = attachGapAnalysis(existingBlueprint, existingGap, "2026-06-27T04:00:00.000Z");
const blueprintWithPlan = attachPhaseBuildPlan(blueprintWithGap, existingPlan, "2026-06-27T05:00:00.000Z");

assert(blueprintWithPlan.phaseBuildPlan.data?.blueprintId === existingBlueprint.id, "Phase plan inserts into Blueprint");
assert(blueprintWithPlan.phaseBuildPlan.status === "draft", "attached Phase Build Plan is a draft Blueprint section");
assert(
  blueprintWithPlan.buildHistory.data.some((entry) => entry.source === "PhaseBuildPlan"),
  "Blueprint build history records Phase Build Plan attachment"
);
assert(
  reactAssessment.inventory.filesInspected.length === 7,
  "phase planning does not write or mutate imported app source files"
);

console.log("phase build plan regression passed");
