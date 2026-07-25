import type {
  ActionLogEntry,
  FileTreeNode,
  GlobalMemory,
  LivingBuildPlan,
  ProjectBlueprint,
  ProjectMemory,
} from "../types";
import { evaluateExistingProjectImport } from "./projectImportEvaluator";
import { commitExistingProjectImport } from "./projectImportCommit";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type FileMap = Record<string, string>;

function treeFromFiles(files: FileMap): FileTreeNode[] {
  const root: FileTreeNode[] = [];

  for (const path of Object.keys(files)) {
    const parts = path.split("/");
    let level = root;
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index];
      const nodePath = parts.slice(0, index + 1).join("/");
      const isDir = index < parts.length - 1;
      let node = level.find((item) => item.name === name);
      if (!node) {
        node = { name, path: nodePath, isDir, children: isDir ? [] : undefined };
        level.push(node);
      }
      if (isDir) {
        level = node.children ?? [];
      }
    }
  }

  return root;
}

function createWorkspace(files: FileMap) {
  return {
    async readFileTree() {
      return treeFromFiles(files);
    },
    async readFile(path: string) {
      const normalized = path.replace(/\\/g, "/");
      if (!(normalized in files)) {
        throw new Error(`Missing test file: ${path}`);
      }
      return files[normalized];
    },
  };
}

const reactTauriFiles: FileMap = {
  "package.json": JSON.stringify({
    name: "foundry",
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
  "src/main.tsx": "import { createRoot } from 'react-dom/client';",
  "src/App.tsx": "export function App() { return <main />; }",
  "src/components/Shell.tsx": "export function Shell() { return null; }",
  "src/routes/routes.ts": "export const routes = [];",
  "src-tauri/tauri.conf.json": "{}",
  "vite.config.ts": "export default {};",
  "README.md": "# Foundry\n\nFoundry is an existing startup operating system project.",
};

const reactEvaluation = await evaluateExistingProjectImport(
  createWorkspace(reactTauriFiles) as never,
  "D:\\dev\\nf-projects\\foundry"
);

assert(reactEvaluation.projectBlueprintDraft !== undefined, "React/Tauri import creates Blueprint draft");
assert(
  reactEvaluation.projectBlueprintDraft?.existingProductAssessment.data?.projectType === "Tauri React application",
  "React/Tauri import stores assessment in Blueprint"
);
assert(
  reactEvaluation.projectBlueprintDraft?.currentProductInventory.data?.packageFiles.includes("package.json") === true,
  "React/Tauri import stores package inventory"
);
assert(
  reactEvaluation.projectBlueprintDraft?.currentProductInventory.data?.uiEntryPoints.includes("src/main.tsx") === true,
  "React/Tauri import stores UI entry point inventory"
);
assert(
  reactEvaluation.projectBlueprintDraft?.currentProductInventory.data?.detectedCommands.build === "npm run build",
  "React/Tauri assessment stores likely build command"
);
assert(
  reactEvaluation.projectBlueprintDraft?.preservationRules.data?.requireApprovalForRewrite === true,
  "React/Tauri import stores conservative preservation rules"
);
assert(reactEvaluation.projectMemoryDraft.name === "Foundry", "normal project memory draft still exists");
assert(reactEvaluation.livingBuildPlanDraft.currentMilestoneId === "m1", "normal build plan draft still exists");

const flutterFiles: FileMap = {
  "pubspec.yaml": "name: be_one\ndependencies:\n  flutter:\n    sdk: flutter\n",
  "lib/main.dart": "void main() => runApp(const App());",
  "lib/screens/home_screen.dart": "class HomeScreen {}",
  "lib/widgets/profile_card.dart": "class ProfileCard {}",
  "README.md": "# Be One\n\nBe One is an imported Flutter application.",
};

const flutterEvaluation = await evaluateExistingProjectImport(
  createWorkspace(flutterFiles) as never,
  "D:\\dev\\nf-projects\\be-one"
);

assert(flutterEvaluation.projectBlueprintDraft !== undefined, "Flutter import creates Blueprint draft");
assert(
  flutterEvaluation.projectBlueprintDraft?.existingProductAssessment.data?.projectType === "Flutter application",
  "Flutter import stores assessment in Blueprint"
);
assert(
  flutterEvaluation.projectBlueprintDraft?.currentProductInventory.data?.packageFiles.includes("pubspec.yaml") === true,
  "Flutter import stores pubspec inventory"
);
assert(
  flutterEvaluation.projectBlueprintDraft?.currentProductInventory.data?.uiEntryPoints.includes("lib/main.dart") === true,
  "Flutter import stores Flutter entry point inventory"
);
assert(
  flutterEvaluation.projectBlueprintDraft?.currentProductInventory.data?.detectedCommands.test === "flutter test",
  "Flutter assessment stores likely test command"
);
assert(
  flutterEvaluation.projectBlueprintDraft?.preservationRules.data?.defaultChangeMode === "extend",
  "Flutter import stores conservative preservation mode"
);

const written = {
  memory: null as ProjectMemory | null,
  plan: null as LivingBuildPlan | null,
  blueprint: null as ProjectBlueprint | null,
  actions: [] as ActionLogEntry[],
  global: {
    schemaVersion: 1 as const,
    updatedAt: "2026-06-27T00:00:00.000Z",
    defaultProjectsFolder: "D:\\dev\\nf-projects",
    projects: [],
  } as GlobalMemory,
};

await commitExistingProjectImport(reactEvaluation, {
  async writeProjectMemory(_workspaceRoot, memory) {
    written.memory = memory;
  },
  async writeLivingBuildPlan(_workspaceRoot, plan) {
    written.plan = plan;
  },
  async writeProjectBlueprint(_workspaceRoot, blueprint) {
    written.blueprint = blueprint;
  },
  async appendActionLogEntry(_workspaceRoot, entry) {
    written.actions.push(entry);
  },
  readGlobalMemory() {
    return written.global;
  },
  writeGlobalMemory(memory) {
    written.global = memory;
  },
});

assert(written.memory?.projectId === "foundry", "commit still writes normal project memory");
assert(written.plan?.projectId === "foundry", "commit still writes normal build plan");
assert(written.blueprint?.id === "blueprint-foundry", "commit writes Project Blueprint");
assert(
  written.blueprint?.preservationRules.data?.preserveWorkingUi === true,
  "commit saves preservation rules into Blueprint"
);
assert(
  written.actions[0]?.files?.includes(".devassistant/project-blueprint.json") === true,
  "commit action log includes Blueprint file"
);
assert(written.global.projects[0]?.name === "Foundry", "commit still updates global memory");
assert(Object.keys(reactTauriFiles).length === 8, "import flow does not modify imported app files");

console.log("project import assessment regression passed");
