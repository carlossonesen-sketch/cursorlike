/**
 * ProjectInspector: detect project type(s), config/lockfiles, build Manifest.
 */

import type { ProjectManifest } from "../types";
import type { WorkspaceService } from "../workspace/WorkspaceService";

const INDICATORS: Record<string, string[]> = {
  "Node/TS": ["package.json", "tsconfig.json", "yarn.lock", "pnpm-lock.yaml"],
  Python: ["pyproject.toml", "requirements.txt", "Pipfile", "poetry.lock"],
  Rust: ["Cargo.toml", "Cargo.lock"],
  ".NET": ["*.csproj", "*.sln"],
  Flutter: ["pubspec.yaml", "pubspec.lock"],
  Go: ["go.mod", "go.sum"],
};

export class ProjectInspector {
  constructor(private workspace: WorkspaceService) {}

  async buildManifest(): Promise<ProjectManifest> {
    const fileList: string[] = [];
    const configFiles: string[] = [];
    const lockfiles: string[] = [];
    const dependencyIndicators: Record<string, string[]> = {};
    const projectTypes: string[] = [];

    const tree = await this.workspace.readFileTree();
    const walk = (nodes: typeof tree) => {
      for (const n of nodes) {
        if (n.isDir) {
          if (n.children) walk(n.children);
        } else {
          fileList.push(n.path);
          const name = n.path.split("/").pop() ?? "";
          if (/package\.json|tsconfig\.json|pyproject\.toml|Cargo\.toml|pubspec\.yaml|go\.mod/i.test(name))
            configFiles.push(n.path);
          if (/package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|pubspec\.lock|go\.sum/i.test(name))
            lockfiles.push(n.path);
        }
      }
    };
    walk(tree);

    for (const [type, files] of Object.entries(INDICATORS)) {
      const found = files.filter((f) => {
        if (f.startsWith("*")) return fileList.some((p) => p.endsWith(f.slice(1)));
        return fileList.includes(f) || fileList.some((p) => p.includes("/" + f));
      });
      if (found.length > 0) {
        projectTypes.push(type);
        dependencyIndicators[type] = found;
      }
    }

    return {
      projectTypes,
      configFiles,
      lockfiles,
      fileList,
      dependencyIndicators,
    };
  }
}
