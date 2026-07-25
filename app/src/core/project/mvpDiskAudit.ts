import type { LivingBuildPlan, ProjectMemory } from "../types";
import type { WorkspaceService } from "../workspace/WorkspaceService";

type AuditWorkspace = Pick<WorkspaceService, "readFile" | "exists">;

export type MvpModuleStatus = "missing" | "placeholder" | "partial" | "done";

export interface MvpModuleDefinition {
  id: string;
  title: string;
  routeKey?: string;
}

export interface MvpModuleAudit {
  id: string;
  title: string;
  status: MvpModuleStatus;
  detail: string;
}

export interface MvpDiskAuditResult {
  isWebsitePlatform: boolean;
  modules: MvpModuleAudit[];
  incompleteModules: MvpModuleAudit[];
  summary: string;
}

export const WEBSITE_MVP_MODULES: MvpModuleDefinition[] = [
  { id: "project-creation", title: "Implement project creation flow" },
  { id: "setup-persistence", title: "Wire setup persistence (replace mock data with localStorage)" },
  { id: "template-pickers", title: "Implement industry and layout template pickers as routed setup steps" },
  { id: "pages-editor", title: "Implement page and section editor", routeKey: "pages" },
  { id: "theme", title: "Implement theme settings", routeKey: "theme" },
  { id: "media", title: "Implement media library", routeKey: "media" },
  { id: "forms", title: "Implement reusable forms", routeKey: "forms" },
  { id: "leads", title: "Implement leads capture inbox", routeKey: "leads" },
  { id: "analytics", title: "Implement basic analytics", routeKey: "analytics" },
  { id: "preview", title: "Implement site preview", routeKey: "preview" },
  { id: "export", title: "Implement export and hosting prep", routeKey: "export" },
];

export function isWebsitePlatformProject(text: string): boolean {
  return /website\s+platform|industry\s+templates?|layout\s+templates?|website\s+builder/i.test(text);
}

export function isPlaceholderRoute(appContent: string, routeKey: string): boolean {
  const normalized = appContent.replace(/\s+/g, " ");
  const pattern = new RegExp(
    `path=["']${routeKey}["'][^>]*element=\\{<WorkspacePlaceholderPage`,
    "i"
  );
  return pattern.test(normalized);
}

export function hasDuplicateExportFunctions(content: string, functionName: string): boolean {
  const pattern = new RegExp(`export\\s+function\\s+${functionName}\\b`, "g");
  return (content.match(pattern) ?? []).length > 1;
}

function projectContextText(plan: LivingBuildPlan | null, memory: ProjectMemory | null): string {
  return [plan?.mvpDefinition, memory?.summary, memory?.fullIdea, memory?.name].filter(Boolean).join(" ");
}

async function readOptionalFile(workspace: AuditWorkspace, path: string): Promise<string> {
  try {
    return await workspace.readFile(path);
  } catch {
    return "";
  }
}

async function fileExists(workspace: AuditWorkspace, path: string): Promise<boolean> {
  return workspace.exists(path).catch(() => false);
}

async function auditProjectCreation(
  workspace: AuditWorkspace,
  appContent: string
): Promise<MvpModuleAudit> {
  const projectsPage = await readOptionalFile(workspace, "src/pages/ProjectsIndexPage.tsx");
  const hasCreate =
    /create\s+project|new\s+project|onCreateProject|handleCreate/i.test(projectsPage) ||
    /create\s+project|new\s+project/i.test(appContent);
  if (hasCreate) {
    return {
      id: "project-creation",
      title: "Implement project creation flow",
      status: "partial",
      detail: "Create-project UI detected but may not be fully wired.",
    };
  }
  return {
    id: "project-creation",
    title: "Implement project creation flow",
    status: "missing",
    detail: "Project list exists without a create-project flow.",
  };
}

async function auditSetupPersistence(workspace: AuditWorkspace): Promise<MvpModuleAudit> {
  const modelFile = await readOptionalFile(workspace, "src/models/websiteProject.ts");
  const setupPage = await readOptionalFile(workspace, "src/workspace/pages/WorkspaceSetupPage.tsx");
  const mockData = await readOptionalFile(workspace, "src/data/mockData.ts");
  const hasModel = /localStorage|saveWebsiteProject|loadWebsiteProjects/i.test(modelFile);
  const usesMock = /mockData|getProjectByTenantAndId|demoProjects/i.test(setupPage);
  const mockCorrupted =
    hasDuplicateExportFunctions(mockData, "industryTemplates") ||
    hasDuplicateExportFunctions(mockData, "getProjectByTenantAndId");
  if (hasModel && !usesMock && !mockCorrupted) {
    return {
      id: "setup-persistence",
      title: "Wire setup persistence (replace mock data with localStorage)",
      status: "done",
      detail: "Workspace uses persisted website project storage.",
    };
  }
  return {
    id: "setup-persistence",
    title: "Wire setup persistence (replace mock data with localStorage)",
    status: mockCorrupted ? "partial" : usesMock ? "placeholder" : "missing",
    detail: mockCorrupted
      ? "mockData.ts appears corrupted from repeated patches."
      : usesMock
        ? "Workspace still reads in-memory mock data instead of localStorage."
        : "Persistence model is not wired into workspace pages.",
  };
}

async function auditTemplatePickers(workspace: AuditWorkspace, appContent: string): Promise<MvpModuleAudit> {
  const hasLayoutRoute =
    /LayoutTemplatePicker/i.test(appContent) && !/WorkspacePlaceholderPage[^>]*layout/i.test(appContent);
  const layoutPageExists = await fileExists(workspace, "src/pages/LayoutTemplatePicker.tsx");
  const setupPage = await readOptionalFile(workspace, "src/workspace/pages/WorkspaceSetupPage.tsx");
  const setupCorrupted = hasDuplicateExportFunctions(setupPage, "WorkspaceSetupPage");
  const hasIndustryPicker = /industryTemplates|IndustryTemplate/i.test(setupPage) && !setupCorrupted;
  if (hasIndustryPicker && hasLayoutRoute) {
    return {
      id: "template-pickers",
      title: "Implement industry and layout template pickers as routed setup steps",
      status: "done",
      detail: "Industry and layout pickers are routed in the app.",
    };
  }
  return {
    id: "template-pickers",
    title: "Implement industry and layout template pickers as routed setup steps",
    status: setupCorrupted || (layoutPageExists && !hasLayoutRoute) ? "partial" : "placeholder",
    detail: setupCorrupted
      ? "WorkspaceSetupPage appears corrupted from repeated patches."
      : layoutPageExists && !hasLayoutRoute
        ? "LayoutTemplatePicker exists but is not routed in App.tsx."
        : "Industry picker is partial and layout picker is not fully routed.",
  };
}

function auditRoutedModule(
  moduleId: string,
  routeKey: string,
  title: string,
  appContent: string
): MvpModuleAudit {
  if (!appContent.trim()) {
    return { id: moduleId, title, status: "missing", detail: `src/App.tsx not found; ${routeKey} route unknown.` };
  }
  if (isPlaceholderRoute(appContent, routeKey)) {
    return {
      id: moduleId,
      title,
      status: "placeholder",
      detail: `${routeKey} route still mounts WorkspacePlaceholderPage.`,
    };
  }
  const routePattern = new RegExp(`path=["']${routeKey}["']`, "i");
  if (!routePattern.test(appContent)) {
    return { id: moduleId, title, status: "missing", detail: `${routeKey} route is not defined in App.tsx.` };
  }
  return { id: moduleId, title, status: "done", detail: `${routeKey} route has a real page component.` };
}

export async function auditWebsitePlatformMvp(
  workspace: AuditWorkspace,
  plan: LivingBuildPlan | null,
  memory: ProjectMemory | null
): Promise<MvpDiskAuditResult | null> {
  const context = projectContextText(plan, memory);
  if (!isWebsitePlatformProject(context)) return null;

  const appContent = await readOptionalFile(workspace, "src/App.tsx");
  const modules: MvpModuleAudit[] = [
    await auditProjectCreation(workspace, appContent),
    await auditSetupPersistence(workspace),
    await auditTemplatePickers(workspace, appContent),
    auditRoutedModule("pages-editor", "pages", "Implement page and section editor", appContent),
    auditRoutedModule("theme", "theme", "Implement theme settings", appContent),
    auditRoutedModule("media", "media", "Implement media library", appContent),
    auditRoutedModule("forms", "forms", "Implement reusable forms", appContent),
    auditRoutedModule("leads", "leads", "Implement leads capture inbox", appContent),
    auditRoutedModule("analytics", "analytics", "Implement basic analytics", appContent),
    auditRoutedModule("preview", "preview", "Implement site preview", appContent),
    auditRoutedModule("export", "export", "Implement export and hosting prep", appContent),
  ];

  const incompleteModules = modules.filter((module) => module.status !== "done");
  const doneCount = modules.length - incompleteModules.length;
  const summary =
    incompleteModules.length === 0
      ? `All ${modules.length} MVP modules verified on disk.`
      : `${doneCount}/${modules.length} MVP modules complete on disk; ${incompleteModules.length} still need implementation.`;

  return {
    isWebsitePlatform: true,
    modules,
    incompleteModules,
    summary,
  };
}

export function formatDiskTruthSummary(audit: MvpDiskAuditResult | null): string | null {
  if (!audit) return null;
  if (!audit.incompleteModules.length) return audit.summary;
  const lines = audit.incompleteModules.slice(0, 6).map((module) => `- ${module.title} (${module.status})`);
  if (audit.incompleteModules.length > 6) {
    lines.push(`- ...and ${audit.incompleteModules.length - 6} more`);
  }
  return [`Disk truth: ${audit.summary}`, "Incomplete MVP modules:", ...lines].join("\n");
}
