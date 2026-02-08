/**
 * ProjectDetector: scan workspace for project type(s), recommended packs,
 * important files, and inferred commands (build/test/lint/dev).
 */

import type { WorkspaceService } from "../workspace/WorkspaceService";
import type { FileTreeNode } from "../types";
import type { DetectedCommands } from "../types";

export interface ProjectDetectorResult {
  detectedTypes: string[];
  recommendedPacks: string[];
  importantFiles: string[];
  detectedCommands: DetectedCommands;
}

/** Signature files per project type. Paths are relative to workspace root. */
const SIGNATURES: Record<string, (string | { pattern: string })[]> = {
  "Node/TS": ["package.json", "tsconfig.json"],
  Python: ["pyproject.toml", "requirements.txt", "poetry.lock"],
  Flutter: ["pubspec.yaml"],
  "C/C++": ["CMakeLists.txt", "Makefile", { pattern: "*.cpp" }, { pattern: "*.h" }],
  PowerShell: [{ pattern: "*.ps1" }, { pattern: "*.psm1" }, { pattern: "*.psd1" }],
  Tauri: ["src-tauri/tauri.conf.json"],
  Firebase: ["firebase.json"],
  "Next.js": ["next.config.js", "next.config.mjs", "next.config.ts", "next.config.mts"],
};

/** Map detected type -> knowledge pack identifiers (match knowledge/ folder tags). */
const TYPE_TO_PACKS: Record<string, string[]> = {
  "Node/TS": ["node", "typescript"],
  Python: ["python"],
  Flutter: ["flutter"],
  "C/C++": ["cpp"],
  PowerShell: ["powershell"],
  Tauri: ["tauri"],
  Firebase: ["firebase"],
  "Next.js": ["nextjs"],
};

/** Default commands when no package.json scripts (by type). */
const DEFAULT_COMMANDS: Record<string, Partial<DetectedCommands>> = {
  "Node/TS": { build: "npm run build", test: "npm test", lint: "npm run lint", dev: "npm run dev" },
  Python: { build: "", test: "pytest", lint: "ruff check .", dev: "" },
  Flutter: { build: "flutter build", test: "flutter test", lint: "flutter analyze", dev: "flutter run" },
  "C/C++": { build: "make", test: "make test", lint: "", dev: "" },
  PowerShell: { build: "", test: "Invoke-Pester", lint: "Invoke-ScriptAnalyzer", dev: "" },
  Tauri: { build: "npm run tauri build", test: "npm test", lint: "npm run lint", dev: "npm run tauri dev" },
  Firebase: { build: "", test: "", lint: "", dev: "firebase emulators:start" },
  "Next.js": { build: "npm run build", test: "npm test", lint: "npm run lint", dev: "npm run dev" },
};

function flattenPaths(nodes: FileTreeNode[]): string[] {
  const out: string[] = [];
  function walk(n: FileTreeNode[]) {
    for (const node of n) {
      if (!node.isDir) out.push(node.path);
      if (node.children?.length) walk(node.children);
    }
  }
  walk(nodes);
  return out;
}

function pathMatches(path: string, sig: string | { pattern: string }): boolean {
  const name = path.split("/").pop() ?? "";
  const norm = path.replace(/\\/g, "/");
  if (typeof sig === "string") {
    return norm === sig || norm.endsWith("/" + sig);
  }
  const ext = sig.pattern.startsWith("*") ? sig.pattern.slice(1) : sig.pattern; // *.cpp -> .cpp
  return name.endsWith(ext) || name.toLowerCase().endsWith(ext.toLowerCase());
}

function hasSignature(fileList: string[], type: string): boolean {
  const sigs = SIGNATURES[type];
  if (!sigs) return false;
  if (type === "Next.js") {
    return (
      sigs.some((sig) => fileList.some((p) => pathMatches(p, sig))) ||
      fileList.some((p) => p.startsWith("app/") || p.startsWith("pages/"))
    );
  }
  return sigs.some((sig) =>
    fileList.some((p) => pathMatches(p, sig))
  );
}

export class ProjectDetector {
  constructor(private workspace: WorkspaceService) {}

  async detect(): Promise<ProjectDetectorResult> {
    const tree = await this.workspace.readFileTree();
    const fileList = flattenPaths(tree);

    const detectedTypes: string[] = [];
    for (const type of Object.keys(SIGNATURES)) {
      if (hasSignature(fileList, type)) detectedTypes.push(type);
    }

    const recommendedPacks: string[] = [];
    const seen = new Set<string>();
    for (const type of detectedTypes) {
      const packs = TYPE_TO_PACKS[type] ?? [];
      for (const p of packs) {
        if (!seen.has(p)) {
          seen.add(p);
          recommendedPacks.push(p);
        }
      }
    }

    const importantFiles: string[] = [];
    const configNames = [
      "package.json", "tsconfig.json", "pyproject.toml", "requirements.txt", "poetry.lock",
      "pubspec.yaml", "CMakeLists.txt", "Makefile", "tauri.conf.json", "firebase.json",
      "next.config.js", "next.config.mjs", "next.config.ts", "next.config.mts",
    ];
    for (const p of fileList) {
      const name = p.split("/").pop() ?? "";
      if (configNames.includes(name) || p === "src-tauri/tauri.conf.json") {
        importantFiles.push(p);
      }
    }
    // Add first entry point if Node (main from package.json) - done below after parsing package.json
    const detectedCommands = await this.inferCommands(fileList, detectedTypes);

    // If we have package.json and it has main/scripts, add main to importantFiles
    try {
      const pkgRaw = await this.workspace.readFile("package.json");
      const pkg = JSON.parse(pkgRaw) as { main?: string; bin?: string | Record<string, string> };
      if (typeof pkg.main === "string" && !importantFiles.includes(pkg.main)) {
        importantFiles.push(pkg.main);
      }
    } catch {
      /* no package.json or invalid */
    }

    return {
      detectedTypes,
      recommendedPacks,
      importantFiles: [...new Set(importantFiles)],
      detectedCommands,
    };
  }

  private async inferCommands(
    fileList: string[],
    detectedTypes: string[]
  ): Promise<DetectedCommands> {
    const out: DetectedCommands = {};
    const hasPackageJson = fileList.some((p) => p === "package.json" || p.endsWith("/package.json"));

    if (hasPackageJson) {
      try {
        const pkgRaw = await this.workspace.readFile("package.json");
        const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
        const scripts = pkg.scripts ?? {};
        if (scripts.build) out.build = scripts.build;
        if (scripts.test) out.test = scripts.test;
        if (scripts.lint) out.lint = scripts.lint;
        out.dev = scripts.dev ?? scripts.start ?? out.dev;
      } catch {
        /* ignore */
      }
    }

    const defaults = detectedTypes.length
      ? DEFAULT_COMMANDS[detectedTypes[0]] ?? {}
      : {};
    if (!out.build && defaults.build) out.build = defaults.build;
    if (!out.test && defaults.test) out.test = defaults.test;
    if (!out.lint && defaults.lint) out.lint = defaults.lint;
    if (!out.dev && defaults.dev) out.dev = defaults.dev;
    if (detectedTypes.includes("C/C++") && fileList.some((p) => p.includes("CMakeLists"))) {
      if (!out.build) out.build = "cmake --build .";
    }

    return out;
  }
}
