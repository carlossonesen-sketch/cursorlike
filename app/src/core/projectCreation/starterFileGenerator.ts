import type { NewProjectDraft, NewProjectFilePreview, NewProjectPlanPreview, NewProjectStarterFile, ProjectBlueprint } from "../types";
import { createPlannerLock } from "./projectCreationWizard";
import type { ProjectCreationState } from "./projectCreationState";
import { createProjectCreationState, projectCreationStateToDraft } from "./projectCreationState";
import { generateWebsitePlatformFilePlan } from "./websitePlatformFilePlan";
import { generateSpecializedFoundationFilePlan } from "./specializedFilePlan";
import { requiresSpecializedPlanner } from "../product/planners/foundationPlanner";

function packageJson(projectName: string): string {
  return JSON.stringify({
    scripts: {
      dev: "vite",
      build: "tsc && vite build",
      preview: "vite preview",
    },
    dependencies: {
      "@vitejs/plugin-react": "latest",
      vite: "latest",
      typescript: "latest",
    },
    devDependencies: {},
    private: true,
    name: projectName,
    version: "0.1.0",
    type: "module",
  }, null, 2) + "\n";
}

function createCanvasFiles(draft: NewProjectDraft): NewProjectStarterFile[] {
  return [
    {
      path: "package.json",
      reason: "Project scripts and dependencies",
      content: packageJson(draft.slug),
    },
    {
      path: "index.html",
      reason: "Browser entry point",
      content: `<div id="app"></div>\n<script type="module" src="/src/main.ts"></script>\n`,
    },
    {
      path: "src/main.ts",
      reason: "Initial canvas game loop",
      content: `import "./styles.css";\n\nconst app = document.querySelector<HTMLDivElement>("#app");\nif (!app) throw new Error("Missing #app");\n\napp.innerHTML = \`<canvas id="game" width="960" height="540"></canvas>\`;\nconst canvas = document.querySelector<HTMLCanvasElement>("#game");\nconst ctx = canvas?.getContext("2d");\n\nfunction frame() {\n  if (!canvas || !ctx) return;\n  ctx.fillStyle = "#101828";\n  ctx.fillRect(0, 0, canvas.width, canvas.height);\n  ctx.fillStyle = "#f9fafb";\n  ctx.font = "28px sans-serif";\n  ctx.fillText("${draft.projectName}", 40, 70);\n  ctx.font = "16px sans-serif";\n  ctx.fillText("MVP scaffold ready. Next: add the first playable interaction.", 40, 110);\n  requestAnimationFrame(frame);\n}\n\nframe();\n`,
    },
    {
      path: "src/styles.css",
      reason: "Minimal founder-demo styling",
      content: `html, body, #app {\n  margin: 0;\n  width: 100%;\n  height: 100%;\n  background: #0b1020;\n  color: #f9fafb;\n  font-family: Inter, system-ui, sans-serif;\n}\n\n#app {\n  display: grid;\n  place-items: center;\n}\n\ncanvas {\n  max-width: min(960px, 100vw);\n  width: 100%;\n  border: 1px solid #344054;\n}\n`,
    },
  ];
}

function createReactFiles(draft: NewProjectDraft): NewProjectStarterFile[] {
  return [
    {
      path: "package.json",
      reason: "Project scripts and dependencies",
      content: packageJson(draft.slug),
    },
    {
      path: "index.html",
      reason: "Browser entry point",
      content: `<div id="root"></div>\n<script type="module" src="/src/main.tsx"></script>\n`,
    },
    {
      path: "src/main.tsx",
      reason: "Initial app screen",
      content: `import "./styles.css";\n\nconst root = document.querySelector("#root");\nif (!root) throw new Error("Missing #root");\n\nroot.innerHTML = \`\n  <main class="app-shell">\n    <h1>${draft.projectName}</h1>\n    <p>${draft.ideaText}</p>\n    <button type="button">Start MVP</button>\n  </main>\n\`;\n`,
    },
    {
      path: "src/styles.css",
      reason: "Minimal founder-demo styling",
      content: `.app-shell {\n  max-width: 760px;\n  margin: 64px auto;\n  padding: 0 24px;\n  font-family: Inter, system-ui, sans-serif;\n}\n\nbutton {\n  padding: 10px 14px;\n  border: 0;\n  border-radius: 6px;\n  background: #1f5eff;\n  color: white;\n}\n`,
    },
  ];
}

function generateGenericStarterFilePreview(
  draft: NewProjectDraft,
  plan: NewProjectPlanPreview
): NewProjectFilePreview {
  const isCanvas = plan.inferredStack.some((item) => item.toLowerCase() === "canvas");
  const files = isCanvas ? createCanvasFiles(draft) : createReactFiles(draft);
  const folders = [...new Set(files.map((file) => file.path.split("/").slice(0, -1).join("/")).filter(Boolean))];
  return {
    targetPath: draft.defaultPath,
    foldersToCreate: folders,
    filesToCreate: files,
    keyStarterFiles: files.slice(0, 3),
  };
}

export function generateStarterFilePreview(
  state: ProjectCreationState,
  plan: NewProjectPlanPreview,
  blueprint?: ProjectBlueprint | null
): NewProjectFilePreview;
export function generateStarterFilePreview(
  draft: NewProjectDraft,
  plan: NewProjectPlanPreview,
  options?: { plannerLock?: ReturnType<typeof createPlannerLock>; blueprint?: ProjectBlueprint | null }
): NewProjectFilePreview;
export function generateStarterFilePreview(
  stateOrDraft: ProjectCreationState | NewProjectDraft,
  plan: NewProjectPlanPreview,
  blueprintOrOptions?: ProjectBlueprint | null | { plannerLock?: ReturnType<typeof createPlannerLock>; blueprint?: ProjectBlueprint | null }
): NewProjectFilePreview {
  const blueprint =
    blueprintOrOptions && "identity" in blueprintOrOptions
      ? blueprintOrOptions
      : blueprintOrOptions?.blueprint ?? null;

  if ("discoveryIntake" in stateOrDraft) {
    const lock = createPlannerLock(stateOrDraft.classification);
    if (lock.lockedPlanner === "websitePlatformPlanner") {
      return generateWebsitePlatformFilePlan(stateOrDraft, plan, blueprint);
    }
    if (requiresSpecializedPlanner(stateOrDraft.classification)) {
      return generateSpecializedFoundationFilePlan(stateOrDraft, plan, blueprint);
    }
    return generateGenericStarterFilePreview(projectCreationStateToDraft(stateOrDraft), plan);
  }

  const options = blueprintOrOptions && !("identity" in blueprintOrOptions) ? blueprintOrOptions : {};
  if (options.plannerLock?.lockedPlanner === "websitePlatformPlanner") {
    const state = createProjectCreationState({
      founderPrompt: stateOrDraft.ideaText,
      existingDraft: stateOrDraft,
      source: stateOrDraft.createdFrom,
    });
    return generateWebsitePlatformFilePlan(state, plan, options.blueprint ?? blueprint);
  }
  return generateGenericStarterFilePreview(stateOrDraft, plan);
}

