import { createDiscoveryIntake } from "./discoveryIntake";
import { assessExistingProduct } from "./existingProductAssessment";
import {
  attachExistingProductAssessment,
  createProjectBlueprintFromDiscoveryIntake,
} from "./projectBlueprint";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const reactTauriFiles = [
  {
    path: "package.json",
    content: JSON.stringify({
      scripts: {
        dev: "vite",
        build: "tsc && vite build",
        test: "vitest",
      },
      dependencies: {
        "@tauri-apps/api": "^2",
        react: "^19.0.0",
      },
      devDependencies: {
        vite: "^7.0.0",
      },
    }),
  },
  { path: "src/main.tsx", content: "import { createRoot } from 'react-dom/client';" },
  { path: "src/App.tsx", content: "export function App() { return <main />; }" },
  { path: "src/components/ProjectDashboard.tsx", content: "export function ProjectDashboard() { return null; }" },
  { path: "src/routes/projectRoutes.ts", content: "export const routes = [];" },
  { path: "src-tauri/tauri.conf.json", content: "{}" },
  { path: "vite.config.ts", content: "export default {};" },
];

const reactAssessment = assessExistingProduct({
  projectPath: "D:\\dev\\nf",
  files: reactTauriFiles,
});

assert(reactAssessment.projectType === "Tauri React application", "detects React/Tauri project type");
assert(reactAssessment.frameworks.includes("React"), "detects React");
assert(reactAssessment.frameworks.includes("Tauri"), "detects Tauri");
assert(reactAssessment.frameworks.includes("Vite"), "detects Vite");
assert(reactAssessment.inventory.packageFiles.includes("package.json"), "detects package.json");
assert(reactAssessment.inventory.sourceFolders.includes("src"), "detects source folder");
assert(reactAssessment.inventory.sourceFolders.includes("src-tauri"), "detects Tauri source folder");
assert(reactAssessment.inventory.uiEntryPoints.includes("src/main.tsx"), "detects React UI entry point");
assert(reactAssessment.inventory.uiEntryPoints.includes("src/App.tsx"), "detects React app component");
assert(
  reactAssessment.inventory.routesOrNavigationHints.includes("src/routes/projectRoutes.ts"),
  "detects route hints"
);
assert(
  reactAssessment.inventory.componentsWidgetsScreens.includes("src/components/ProjectDashboard.tsx"),
  "detects components"
);
assert(reactAssessment.inventory.detectedCommands.build === "npm run build", "detects build command");
assert(reactAssessment.inventory.detectedCommands.test === "npm run test", "detects test command");
assert(reactAssessment.architectureNotes.length > 0, "adds architecture notes");

const flutterFiles = [
  { path: "pubspec.yaml", content: "name: budget_app\ndependencies:\n  flutter:\n    sdk: flutter\n" },
  { path: "lib/main.dart", content: "void main() => runApp(const App());" },
  { path: "lib/screens/home_screen.dart", content: "class HomeScreen {}" },
  { path: "lib/widgets/budget_card.dart", content: "class BudgetCard {}" },
  { path: "README.md", content: "# Budget App" },
];

const flutterAssessment = assessExistingProduct({
  projectPath: "D:\\dev\\budget_app",
  files: flutterFiles,
});

assert(flutterAssessment.projectType === "Flutter application", "detects Flutter project type");
assert(flutterAssessment.frameworks.includes("Flutter"), "detects Flutter");
assert(flutterAssessment.inventory.packageFiles.includes("pubspec.yaml"), "detects pubspec.yaml");
assert(flutterAssessment.inventory.uiEntryPoints.includes("lib/main.dart"), "detects Flutter entry point");
assert(
  flutterAssessment.inventory.componentsWidgetsScreens.includes("lib/screens/home_screen.dart"),
  "detects Flutter screens"
);
assert(
  flutterAssessment.inventory.componentsWidgetsScreens.includes("lib/widgets/budget_card.dart"),
  "detects Flutter widgets"
);
assert(flutterAssessment.inventory.detectedCommands.dev === "flutter run", "detects Flutter dev command");
assert(flutterAssessment.inventory.detectedCommands.test === "flutter test", "detects Flutter test command");

assert(reactAssessment.preservationRules.preserveWorkingUi, "preservation keeps working UI");
assert(reactAssessment.preservationRules.preserveUserFlows, "preservation keeps workflows");
assert(reactAssessment.preservationRules.preserveFolderStructure, "preservation keeps folder structure");
assert(reactAssessment.preservationRules.preserveBusinessLogic, "preservation keeps business logic");
assert(reactAssessment.preservationRules.preserveArchitectureDecisions, "preservation keeps architecture decisions");
assert(reactAssessment.preservationRules.requireApprovalForRewrite, "rewrite requires approval");
assert(reactAssessment.preservationRules.defaultChangeMode === "extend", "default change mode is conservative");

const blueprint = createProjectBlueprintFromDiscoveryIntake(createDiscoveryIntake("Continue this app"), {
  id: "blueprint-existing-product",
  projectId: "existing-product",
  source: "existingProject",
  now: "2026-06-27T00:00:00.000Z",
});
const updatedBlueprint = attachExistingProductAssessment(
  blueprint,
  reactAssessment,
  "2026-06-27T01:00:00.000Z"
);

assert(updatedBlueprint.identity.source === "existingProject", "Blueprint remains an existing project");
assert(
  updatedBlueprint.existingProductAssessment.data?.projectType === "Tauri React application",
  "Blueprint stores assessment"
);
assert(
  updatedBlueprint.currentProductInventory.data?.uiEntryPoints.includes("src/main.tsx") === true,
  "Blueprint stores inventory"
);
assert(
  updatedBlueprint.preservationRules.data?.defaultChangeMode === "extend",
  "Blueprint stores preservation rules"
);
assert(updatedBlueprint.buildHistory.data.length === 2, "Blueprint records assessment history");
assert(reactTauriFiles.length === 7, "assessment does not mutate or write project files");

console.log("existing product assessment regression passed");
