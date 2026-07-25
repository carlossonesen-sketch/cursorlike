import type {
  CurrentProductInventory,
  ExistingProductAssessment,
  ImportantFile,
  IntakeConfidenceLevel,
  PreservationRules,
  ProjectCommands,
} from "../types";

export interface ProductFileSnapshot {
  path: string;
  content?: string;
}

export interface ExistingProductAssessmentInput {
  projectPath?: string;
  files: ProductFileSnapshot[];
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function fileNames(files: ProductFileSnapshot[]): string[] {
  return files.map((file) => normalizePath(file.path));
}

function hasFile(paths: string[], path: string): boolean {
  return paths.includes(path);
}

function hasPrefix(paths: string[], prefix: string): boolean {
  return paths.some((path) => path.startsWith(prefix));
}

function readJsonFile<T>(files: ProductFileSnapshot[], path: string): T | null {
  const file = files.find((item) => normalizePath(item.path) === path);
  if (!file?.content) {
    return null;
  }

  try {
    return JSON.parse(file.content) as T;
  } catch {
    return null;
  }
}

function readTextFile(files: ProductFileSnapshot[], path: string): string {
  return files.find((item) => normalizePath(item.path) === path)?.content ?? "";
}

function detectCommands(files: ProductFileSnapshot[], paths: string[]): ProjectCommands {
  const packageJson = readJsonFile<{ scripts?: Record<string, string> }>(files, "package.json");
  if (packageJson?.scripts) {
    return {
      dev: packageJson.scripts.dev ? "npm run dev" : undefined,
      build: packageJson.scripts.build ? "npm run build" : undefined,
      test: packageJson.scripts.test ? "npm run test" : undefined,
      lint: packageJson.scripts.lint ? "npm run lint" : undefined,
      format: packageJson.scripts.format ? "npm run format" : undefined,
    };
  }

  if (hasFile(paths, "pubspec.yaml")) {
    return {
      dev: "flutter run",
      build: "flutter build",
      test: "flutter test",
    };
  }

  return {};
}

function detectFrameworks(files: ProductFileSnapshot[], paths: string[]): string[] {
  const frameworks = new Set<string>();
  const packageJson = readJsonFile<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>(files, "package.json");
  const deps = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
  };

  if ("react" in deps) frameworks.add("React");
  if ("vite" in deps || hasFile(paths, "vite.config.ts") || hasFile(paths, "vite.config.js")) frameworks.add("Vite");
  if ("@tauri-apps/api" in deps || hasPrefix(paths, "src-tauri/")) frameworks.add("Tauri");
  if ("next" in deps) frameworks.add("Next.js");
  if ("vue" in deps) frameworks.add("Vue");
  if ("svelte" in deps) frameworks.add("Svelte");
  if (hasFile(paths, "pubspec.yaml")) frameworks.add("Flutter");

  return Array.from(frameworks);
}

function detectProjectType(frameworks: string[], paths: string[]): string {
  if (frameworks.includes("Flutter")) return "Flutter application";
  if (frameworks.includes("Tauri") && frameworks.includes("React")) return "Tauri React application";
  if (frameworks.includes("React")) return "React application";
  if (frameworks.includes("Next.js")) return "Next.js application";
  if (hasFile(paths, "package.json")) return "JavaScript/TypeScript application";
  return "software project";
}

function detectLikelyAppType(frameworks: string[]): string {
  if (frameworks.includes("Flutter")) return "cross-platform app";
  if (frameworks.includes("Tauri")) return "desktop app";
  if (frameworks.includes("Next.js")) return "web app";
  if (frameworks.includes("React")) return "web app";
  return "application";
}

function detectSourceFolders(paths: string[]): string[] {
  const folders = new Set<string>();
  for (const path of paths) {
    const first = path.split("/")[0];
    if (["src", "app", "pages", "lib", "src-tauri"].includes(first)) {
      folders.add(first);
    }
  }
  return Array.from(folders);
}

function detectImportantFiles(paths: string[]): ImportantFile[] {
  const candidates: Array<[string, string]> = [
    ["package.json", "Node package metadata and scripts"],
    ["pubspec.yaml", "Flutter package metadata and commands"],
    ["src/main.tsx", "Likely React UI entry point"],
    ["src/main.ts", "Likely TypeScript app entry point"],
    ["src/App.tsx", "Likely main React app component"],
    ["lib/main.dart", "Likely Flutter UI entry point"],
    ["src-tauri/tauri.conf.json", "Tauri app configuration"],
    ["vite.config.ts", "Vite build configuration"],
    ["README.md", "Project documentation"],
  ];

  return candidates
    .filter(([path]) => paths.includes(path))
    .map(([path, reason]) => ({ path, reason }));
}

function detectUiEntryPoints(paths: string[]): string[] {
  return [
    "src/main.tsx",
    "src/main.jsx",
    "src/main.ts",
    "src/App.tsx",
    "src/App.jsx",
    "app/page.tsx",
    "pages/index.tsx",
    "lib/main.dart",
  ].filter((path) => paths.includes(path));
}

function detectRoutesOrNavigationHints(paths: string[], files: ProductFileSnapshot[]): string[] {
  const hints = new Set<string>();

  for (const path of paths) {
    const lower = path.toLowerCase();
    if (lower.includes("route") || lower.includes("router") || lower.includes("navigation")) {
      hints.add(path);
    }
    if (lower.startsWith("pages/") || lower.startsWith("app/")) {
      hints.add(path);
    }
    if (lower.includes("/screens/")) {
      hints.add(path);
    }
  }

  for (const entryPath of detectUiEntryPoints(paths)) {
    const content = readTextFile(files, entryPath);
    if (/\b(Route|Routes|Router|Navigator|MaterialApp|GoRouter)\b/.test(content)) {
      hints.add(entryPath);
    }
  }

  return Array.from(hints);
}

function detectComponentsWidgetsScreens(paths: string[]): string[] {
  return paths.filter((path) => {
    const lower = path.toLowerCase();
    return (
      lower.includes("/components/") ||
      lower.includes("/widgets/") ||
      lower.includes("/screens/") ||
      lower.includes("/pages/") ||
      lower.endsWith("screen.tsx") ||
      lower.endsWith("screen.dart") ||
      lower.endsWith("page.tsx")
    );
  });
}

function detectPackageFiles(paths: string[]): string[] {
  return ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "pubspec.yaml", "pubspec.lock"].filter(
    (path) => paths.includes(path)
  );
}

function createArchitectureNotes(frameworks: string[], inventory: CurrentProductInventory): string[] {
  const notes: string[] = [];

  if (frameworks.length > 0) {
    notes.push(`Detected framework stack: ${frameworks.join(", ")}.`);
  }
  if (inventory.uiEntryPoints.length > 0) {
    notes.push(`Likely UI entry point(s): ${inventory.uiEntryPoints.join(", ")}.`);
  }
  if (inventory.routesOrNavigationHints.length > 0) {
    notes.push("Navigation or routing hints exist and should be preserved before changing user flows.");
  }
  if (inventory.componentsWidgetsScreens.length > 0) {
    notes.push("Existing components/widgets/screens were detected; extend them before replacing UI structure.");
  }
  if (Object.keys(inventory.detectedCommands).length > 0) {
    notes.push("Build/test commands were inferred from project metadata.");
  }

  return notes;
}

export function createConservativePreservationRules(): PreservationRules {
  return {
    preserveWorkingUi: true,
    preserveUserFlows: true,
    preserveFolderStructure: true,
    preserveBusinessLogic: true,
    preserveArchitectureDecisions: true,
    requireApprovalForRewrite: true,
    defaultChangeMode: "extend",
    notes: [
      "Existing products are continued, not replaced.",
      "Preserve working UI, workflow, structure, logic, and architecture unless the founder approves a rewrite.",
      "Prefer additive changes and focused repairs before redesign or restructuring.",
    ],
  };
}

function confidenceFor(frameworks: string[], inventory: CurrentProductInventory): IntakeConfidenceLevel {
  if (frameworks.length > 0 && inventory.uiEntryPoints.length > 0 && inventory.packageFiles.length > 0) {
    return "high";
  }
  if (frameworks.length > 0 || inventory.uiEntryPoints.length > 0 || inventory.packageFiles.length > 0) {
    return "medium";
  }
  return "low";
}

export function assessExistingProduct(input: ExistingProductAssessmentInput): ExistingProductAssessment {
  const paths = fileNames(input.files);
  const frameworks = detectFrameworks(input.files, paths);
  const inventory: CurrentProductInventory = {
    projectPath: input.projectPath,
    filesInspected: paths,
    packageFiles: detectPackageFiles(paths),
    sourceFolders: detectSourceFolders(paths),
    importantFiles: detectImportantFiles(paths),
    uiEntryPoints: detectUiEntryPoints(paths),
    routesOrNavigationHints: detectRoutesOrNavigationHints(paths, input.files),
    componentsWidgetsScreens: detectComponentsWidgetsScreens(paths),
    detectedCommands: detectCommands(input.files, paths),
  };

  return {
    projectPath: input.projectPath,
    projectType: detectProjectType(frameworks, paths),
    frameworks,
    likelyAppType: detectLikelyAppType(frameworks),
    inventory,
    architectureNotes: createArchitectureNotes(frameworks, inventory),
    preservationRules: createConservativePreservationRules(),
    confidenceLevel: confidenceFor(frameworks, inventory),
  };
}
