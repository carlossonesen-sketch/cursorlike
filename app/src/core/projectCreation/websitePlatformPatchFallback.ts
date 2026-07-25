import type { PlanAndPatch } from "../types";
import type { PatchFallbackWorkspace } from "./nextTaskPatchFallback";

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "website-app";
}

function extractProjectName(prompt: string): string {
  const labeled = prompt.match(/\bProject:\s*([^\n]+)/i)?.[1]?.trim();
  if (labeled) return labeled;
  const named = prompt.match(/\bNF Web Developer\b/i)?.[0];
  if (named) return named;
  return "NF Web Developer";
}

function createNewFilePatch(path: string, content: string): string {
  const lines = content.replace(/\n$/, "").split(/\n/);
  return [
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

function createFullFileReplacementPatch(path: string, oldContent: string, newContent: string): string {
  const oldLines = oldContent.replace(/\n$/, "").split(/\n/);
  const newLines = newContent.replace(/\n$/, "").split(/\n/);
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

function combinePatches(paths: Array<{ path: string; content: string; replace?: boolean; oldContent?: string }>): PlanAndPatch {
  const patch = paths
    .map((file) =>
      file.replace && file.oldContent != null
        ? createFullFileReplacementPatch(file.path, file.oldContent, file.content)
        : createNewFilePatch(file.path, file.content)
    )
    .join("\n");
  return {
    explanation: `Offline fallback: create or update ${paths.map((file) => file.path).join(", ")}.`,
    patch,
  };
}

function webPackageJson(projectName: string): string {
  return `${JSON.stringify(
    {
      name: slugify(projectName),
      private: true,
      version: "0.1.0",
      type: "module",
      scripts: {
        dev: "vite",
        build: "tsc && vite build",
        preview: "vite preview",
      },
      dependencies: {
        react: "^19.0.0",
        "react-dom": "^19.0.0",
      },
      devDependencies: {
        "@types/react": "^19.0.0",
        "@types/react-dom": "^19.0.0",
        "@vitejs/plugin-react": "^4.0.0",
        typescript: "^5.0.0",
        vite: "^6.0.0",
      },
    },
    null,
    2
  )}\n`;
}

function scaffoldFiles(projectName: string): Array<{ path: string; content: string }> {
  return [
    {
      path: "package.json",
      content: webPackageJson(projectName),
    },
    {
      path: "tsconfig.json",
      content: `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            lib: ["ES2022", "DOM", "DOM.Iterable"],
            module: "ESNext",
            moduleResolution: "Bundler",
            jsx: "react-jsx",
            strict: true,
            skipLibCheck: true,
            noEmit: true,
            isolatedModules: true,
          },
          include: ["src"],
        },
        null,
        2
      )}\n`,
    },
    {
      path: "vite.config.ts",
      content: `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n\nexport default defineConfig({\n  plugins: [react()],\n});\n`,
    },
    {
      path: "index.html",
      content: `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>${projectName}</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n`,
    },
    {
      path: "src/main.tsx",
      content: `import { StrictMode } from "react";\nimport { createRoot } from "react-dom/client";\nimport { App } from "./App";\nimport "./styles.css";\n\nconst root = document.querySelector("#root");\nif (!root) throw new Error("Missing #root");\n\ncreateRoot(root).render(\n  <StrictMode>\n    <App />\n  </StrictMode>\n);\n`,
    },
    {
      path: "src/App.tsx",
      content: `import { useState } from "react";\n\nexport function App() {\n  const [step, setStep] = useState<"home" | "industry" | "layout" | "editor">("home");\n\n  return (\n    <main className="app-shell">\n      <header>\n        <h1>${projectName}</h1>\n        <p>Website builder MVP workspace</p>\n      </header>\n      <nav className="step-nav">\n        <button type="button" onClick={() => setStep("industry")}>Industry</button>\n        <button type="button" onClick={() => setStep("layout")}>Layout</button>\n        <button type="button" onClick={() => setStep("editor")}>Editor</button>\n      </nav>\n      <section className="panel">\n        {step === "home" && <p>Select a builder step to begin.</p>}\n        {step === "industry" && <p>Industry template picker shell will mount here.</p>}\n        {step === "layout" && <p>Layout template picker shell will mount here.</p>}\n        {step === "editor" && <p>Page and section editor shell will mount here.</p>}\n      </section>\n    </main>\n  );\n}\n`,
    },
    {
      path: "src/styles.css",
      content: `:root {\n  font-family: Inter, system-ui, sans-serif;\n  color: #101828;\n  background: #f8fafc;\n}\n\nbody {\n  margin: 0;\n}\n\n.app-shell {\n  max-width: 960px;\n  margin: 0 auto;\n  padding: 32px 20px;\n}\n\n.step-nav {\n  display: flex;\n  gap: 12px;\n  margin: 20px 0;\n}\n\nbutton {\n  padding: 10px 14px;\n  border: 0;\n  border-radius: 8px;\n  background: #1f5eff;\n  color: white;\n  cursor: pointer;\n}\n\n.panel {\n  background: white;\n  border: 1px solid #d0d5dd;\n  border-radius: 12px;\n  padding: 20px;\n}\n`,
    },
  ];
}

async function missingFiles(
  workspace: PatchFallbackWorkspace,
  files: Array<{ path: string; content: string }>
): Promise<Array<{ path: string; content: string }>> {
  const missing: Array<{ path: string; content: string }> = [];
  for (const file of files) {
    if (!(await workspace.exists(file.path).catch(() => false))) {
      missing.push(file);
    }
  }
  return missing;
}

async function createScaffoldFallback(
  workspace: PatchFallbackWorkspace,
  projectName: string
): Promise<PlanAndPatch | null> {
  const files = await missingFiles(workspace, scaffoldFiles(projectName));
  if (!files.length) return null;
  return combinePatches(files);
}

function industryPickerFile(): { path: string; content: string } {
  return {
    path: "src/pages/IndustryTemplatePicker.tsx",
    content: `const INDUSTRY_TEMPLATES = ["Roofing", "HIEN", "NF", "Landscaping"] as const;\n\nexport function IndustryTemplatePicker() {\n  return (\n    <section>\n      <h2>Industry Templates</h2>\n      <ul>\n        {INDUSTRY_TEMPLATES.map((template) => (\n          <li key={template}>\n            <button type="button">{template}</button>\n          </li>\n        ))}\n      </ul>\n    </section>\n  );\n}\n`,
  };
}

function layoutPickerFile(): { path: string; content: string } {
  return {
    path: "src/pages/LayoutTemplatePicker.tsx",
    content: `const LAYOUT_TEMPLATES = ["Single Page", "Services Focus", "Lead Gen", "Portfolio"] as const;\n\nexport function LayoutTemplatePicker() {\n  return (\n    <section>\n      <h2>Layout Templates</h2>\n      <p>Layouts stay independent from business content.</p>\n      <ul>\n        {LAYOUT_TEMPLATES.map((template) => (\n          <li key={template}>\n            <button type="button">{template}</button>\n          </li>\n        ))}\n      </ul>\n    </section>\n  );\n}\n`,
  };
}

function pageEditorFile(): { path: string; content: string } {
  return {
    path: "src/pages/PageSectionEditor.tsx",
    content: `const SECTION_TYPES = ["Hero", "Services", "CTA", "Contact"] as const;\n\nexport function PageSectionEditor() {\n  return (\n    <section>\n      <h2>Page and Section Editor</h2>\n      <ul>\n        {SECTION_TYPES.map((section) => (\n          <li key={section}>\n            <button type="button">Add {section} section</button>\n          </li>\n        ))}\n      </ul>\n    </section>\n  );\n}\n`,
  };
}

function websiteProjectModelFile(): { path: string; content: string } {
  return {
    path: "src/models/websiteProject.ts",
    content: `export interface WebsiteProject {\n  id: string;\n  name: string;\n  industryTemplate?: string;\n  layoutTemplate?: string;\n  pages: Array<{ id: string; title: string; sections: string[] }>;\n}\n\nconst STORAGE_KEY = "nf.websiteProjects";\n\nexport function listWebsiteProjects(): WebsiteProject[] {\n  const raw = localStorage.getItem(STORAGE_KEY);\n  if (!raw) return [];\n  try {\n    const parsed = JSON.parse(raw);\n    return Array.isArray(parsed) ? parsed : [];\n  } catch {\n    return [];\n  }\n}\n\nexport function saveWebsiteProject(project: WebsiteProject): void {\n  const projects = listWebsiteProjects().filter((item) => item.id !== project.id);\n  projects.push(project);\n  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));\n}\n`,
  };
}

function roofingPreviewFile(): { path: string; content: string } {
  return {
    path: "src/pages/RoofingPreviewPage.tsx",
    content: `export function RoofingPreviewPage() {\n  return (\n    <section>\n      <h2>Roofing Website Preview</h2>\n      <p>Founder-testable preview shell for a Roofing company website.</p>\n      <button type="button">Request Estimate</button>\n    </section>\n  );\n}\n`,
  };
}

async function wireAppImports(
  workspace: PatchFallbackWorkspace,
  projectName: string,
  componentImport: string,
  componentName: string,
  step: "industry" | "layout" | "editor" | "preview"
): Promise<PlanAndPatch | null> {
  const appPath = "src/App.tsx";
  if (!(await workspace.exists(appPath).catch(() => false))) {
    const scaffold = await createScaffoldFallback(workspace, projectName);
    if (!scaffold) return null;
    return scaffold;
  }
  const oldContent = await workspace.readFile(appPath);
  if (oldContent.includes(componentName)) return null;
  const importLine = `import { ${componentName} } from "${componentImport}";`;
  const newContent = oldContent
    .replace(
      'import { useState } from "react";',
      `import { useState } from "react";\n${importLine}`
    )
    .replace(
      `{step === "${step}" && <p>${step === "industry" ? "Industry template picker shell will mount here." : step === "layout" ? "Layout template picker shell will mount here." : step === "editor" ? "Page and section editor shell will mount here." : "Preview shell will mount here."}</p>}`,
      `{step === "${step}" && <${componentName} />}`
    )
    .replace(
      '<button type="button" onClick={() => setStep("editor")}>Editor</button>',
      '<button type="button" onClick={() => setStep("editor")}>Editor</button>\n        <button type="button" onClick={() => setStep("preview")}>Preview</button>'
    )
    .replace(
      'useState<"home" | "industry" | "layout" | "editor">("home")',
      'useState<"home" | "industry" | "layout" | "editor" | "preview">("home")'
    );
  if (newContent === oldContent) return null;
  return {
    explanation: `Offline fallback: wire ${componentName} into the app shell.`,
    patch: createFullFileReplacementPatch(appPath, oldContent, newContent),
  };
}

export async function createWebsitePlatformFallbackPatch(
  workspace: PatchFallbackWorkspace,
  prompt: string
): Promise<PlanAndPatch | null> {
  const lower = prompt.toLowerCase();
  const projectName = extractProjectName(prompt);

  if (/\b(scaffold|workspace scaffold|typescript web app workspace|set up website project)\b/i.test(lower)) {
    return createScaffoldFallback(workspace, projectName);
  }

  if (/\b(industry template picker)\b/i.test(lower)) {
    const file = industryPickerFile();
    if (!(await workspace.exists(file.path).catch(() => false))) {
      return combinePatches([file]);
    }
    return wireAppImports(workspace, projectName, "./pages/IndustryTemplatePicker", "IndustryTemplatePicker", "industry");
  }

  if (/\b(layout template picker)\b/i.test(lower)) {
    const file = layoutPickerFile();
    if (!(await workspace.exists(file.path).catch(() => false))) {
      return combinePatches([file]);
    }
    return wireAppImports(workspace, projectName, "./pages/LayoutTemplatePicker", "LayoutTemplatePicker", "layout");
  }

  if (/\b(page and section editor)\b/i.test(lower)) {
    const file = pageEditorFile();
    if (!(await workspace.exists(file.path).catch(() => false))) {
      return combinePatches([file]);
    }
    return wireAppImports(workspace, projectName, "./pages/PageSectionEditor", "PageSectionEditor", "editor");
  }

  if (/\b(website project models|local persistence)\b/i.test(lower)) {
    const file = websiteProjectModelFile();
    if (await workspace.exists(file.path).catch(() => false)) return null;
    return combinePatches([file]);
  }

  if (/\b(verify|roofing preview|roofing website flow)\b/i.test(lower)) {
    const file = roofingPreviewFile();
    const patches: Array<{ path: string; content: string; replace?: boolean; oldContent?: string }> = [];
    if (!(await workspace.exists(file.path).catch(() => false))) {
      patches.push(file);
    }
    if (patches.length) {
      return combinePatches(patches);
    }
    return wireAppImports(workspace, projectName, "./pages/RoofingPreviewPage", "RoofingPreviewPage", "preview");
  }

  if (/\bwebsite\s+platform\b/i.test(lower) && !(await workspace.exists("package.json").catch(() => false))) {
    return createScaffoldFallback(workspace, projectName);
  }

  return null;
}
