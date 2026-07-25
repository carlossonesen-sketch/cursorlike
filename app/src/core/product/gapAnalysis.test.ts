import { createDiscoveryIntake } from "./discoveryIntake";
import { assessExistingProduct } from "./existingProductAssessment";
import { createGapAnalysis } from "./gapAnalysis";
import {
  attachExistingProductAssessment,
  attachGapAnalysis,
  createProjectBlueprintFromDiscoveryIntake,
} from "./projectBlueprint";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function labels(items: { label: string }[]): string[] {
  return items.map((item) => item.label);
}

const emptyBudgetBlueprint = createProjectBlueprintFromDiscoveryIntake(
  createDiscoveryIntake("Build me a budgeting app"),
  {
    id: "blueprint-budget-empty",
    projectId: "budget-empty",
    now: "2026-06-27T00:00:00.000Z",
  }
);
const emptyGap = createGapAnalysis(emptyBudgetBlueprint, "2026-06-27T01:00:00.000Z");

assert(emptyGap.missingMvpFeatures.length === 4, "new empty Blueprint should report missing MVP features");
assert(labels(emptyGap.missingMvpFeatures).includes("income"), "new empty Blueprint should miss income");
assert(labels(emptyGap.missingMvpFeatures).includes("expenses"), "new empty Blueprint should miss expenses");
assert(labels(emptyGap.missingMvpFeatures).includes("categories"), "new empty Blueprint should miss categories");
assert(labels(emptyGap.missingMvpFeatures).includes("dashboard"), "new empty Blueprint should miss dashboard");
assert(
  emptyGap.recommendedNextBuildFocus.includes("Build missing MVP feature"),
  "new empty Blueprint should recommend building the first missing feature"
);

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
const reactBlueprint = attachExistingProductAssessment(emptyBudgetBlueprint, reactAssessment, "2026-06-27T02:00:00.000Z");
const reactGap = createGapAnalysis(reactBlueprint, "2026-06-27T03:00:00.000Z");

assert(labels(reactGap.existingItems).includes("dashboard"), "React/Tauri inventory should recognize existing dashboard");
assert(labels(reactGap.partialFeatures).includes("expenses"), "React/Tauri inventory should identify partial expense feature");
assert(labels(reactGap.missingMvpFeatures).includes("income"), "React/Tauri inventory should identify missing income");
assert(labels(reactGap.missingMvpFeatures).includes("categories"), "React/Tauri inventory should identify missing categories");
assert(
  reactGap.preservationWarnings.length > 0,
  "React/Tauri missing or partial features should include preservation warnings"
);
assert(
  reactGap.preservationWarnings[0].reason.includes("extend rather than rewrite"),
  "preservation warnings should discourage rewrite/redesign by default"
);

const flutterAssessment = assessExistingProduct({
  projectPath: "D:\\dev\\nf-projects\\budget-flutter",
  files: [
    { path: "pubspec.yaml", content: "name: budget_flutter\n" },
    { path: "lib/main.dart", content: "void main() => runApp(const App());" },
    { path: "lib/screens/dashboard_screen.dart", content: "class DashboardScreen {}" },
    { path: "lib/widgets/category_chip.dart", content: "class CategoryChip {}" },
  ],
});
const flutterBlueprint = attachExistingProductAssessment(emptyBudgetBlueprint, flutterAssessment, "2026-06-27T04:00:00.000Z");
const flutterGap = createGapAnalysis(flutterBlueprint, "2026-06-27T05:00:00.000Z");

assert(labels(flutterGap.existingItems).includes("dashboard"), "Flutter inventory should recognize existing dashboard");
assert(labels(flutterGap.partialFeatures).includes("categories"), "Flutter inventory should identify partial categories");
assert(labels(flutterGap.missingMvpFeatures).includes("income"), "Flutter inventory should identify missing income");
assert(labels(flutterGap.missingMvpFeatures).includes("expenses"), "Flutter inventory should identify missing expenses");
assert(flutterGap.preservationWarnings.length > 0, "Flutter gaps should include preservation warnings");

const blueprintWithGap = attachGapAnalysis(reactBlueprint, reactGap, "2026-06-27T06:00:00.000Z");

assert(blueprintWithGap.gapAnalysis.data?.blueprintId === reactBlueprint.id, "Gap Analysis attaches to Blueprint");
assert(blueprintWithGap.gapAnalysis.status === "draft", "attached Gap Analysis is a draft Blueprint section");
assert(
  blueprintWithGap.buildHistory.data.some((entry) => entry.source === "GapAnalysis"),
  "Blueprint build history records Gap Analysis attachment"
);
assert(reactAssessment.inventory.filesInspected.length === 7, "Gap Analysis does not mutate source inventory");

console.log("gap analysis regression passed");
