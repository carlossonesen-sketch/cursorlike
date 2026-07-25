import { invoke } from "@tauri-apps/api/core";
import type { ProjectMemory, ProjectSnapshot } from "../types";

type TauriInvoke = typeof invoke;

export interface BuildCheckRequest {
  runId: string;
  command: string;
  workspaceRoot: string;
  activeWorkspacePath: string;
  cwdSource: string;
}

export interface BuildCheckResult {
  runId: string;
  command: string;
  workingDirectory: string;
  startTimestamp: string;
  endTimestamp: string;
  durationMs: number;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function detectBuildCheckIntent(prompt: string): boolean {
  return /\b(run\s+(?:the\s+)?(?:build\s+)?checks?|run\s+build|check\s+(?:this\s+)?project|build\s+check)\b/i.test(prompt);
}

export function normalizeWorkspacePath(path: string | null | undefined): string {
  return (path ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function workspacePathsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeWorkspacePath(a);
  const right = normalizeWorkspacePath(b);
  return left.length > 0 && left === right;
}

export function validateBuildCheckWorkspace(request: BuildCheckRequest): string | null {
  if (!workspacePathsMatch(request.workspaceRoot, request.activeWorkspacePath)) {
    return [
      "Blocked build check: active project path drift detected.",
      `Active project path: ${request.activeWorkspacePath || "(none)"}`,
      `Command cwd: ${request.workspaceRoot || "(none)"}`,
      `CWD source: ${request.cwdSource}`,
      "NF will not run commands until the active project path and command cwd match.",
    ].join("\n");
  }
  return null;
}

export function detectBuildFailureFixIntent(prompt: string): boolean {
  return /\b(fix|debug|diagnose|repair)\b/i.test(prompt) &&
    /\b(?:build|test|typecheck|typescript|tsc)\b/i.test(prompt) &&
    /\b(?:failure|failed|error|issue|problem)\b/i.test(prompt);
}

function normalizeBuildCommand(command: string | undefined): string | null {
  const value = command?.trim();
  if (!value) return null;
  if (/^npm(\.cmd)?\s+run\s+build$/i.test(value)) return "npm run build";
  if (/^pnpm\s+run\s+build$/i.test(value)) return "pnpm run build";
  if (/^yarn\s+build$/i.test(value)) return "yarn build";
  if (/^cargo\s+build$/i.test(value)) return "cargo build";
  if (/\b(vite|tsc|next|react-scripts)\b/i.test(value)) return "npm run build";
  return null;
}

function normalizeTestCommand(command: string | undefined): string | null {
  const value = command?.trim();
  if (!value) return null;
  if (/^npm(\.cmd)?\s+(run\s+)?test$/i.test(value)) return "npm test";
  if (/^pnpm\s+(run\s+)?test$/i.test(value)) return "pnpm test";
  if (/^yarn\s+test$/i.test(value)) return "yarn test";
  if (/^flutter\s+test$/i.test(value)) return "flutter test";
  if (/^cargo\s+test$/i.test(value)) return "cargo test";
  if (/\b(vitest|jest|playwright|tsx\s+.*\.test)\b/i.test(value)) return "npm test";
  return null;
}

function hasUsefulPackageTestScript(scripts: Record<string, string> | undefined): boolean {
  const testScript = scripts?.test?.trim();
  if (!testScript) return false;
  return !/no test specified|exit\s+1/i.test(testScript);
}

export async function detectBuildCommand(
  workspaceRoot: string,
  projectMemory: ProjectMemory | null,
  projectSnapshot: ProjectSnapshot | null,
  readFile: (path: string) => Promise<string>
): Promise<string> {
  try {
    const packageJson = JSON.parse(await readFile("package.json")) as { scripts?: Record<string, string> };
    if (packageJson.scripts?.build) return "npm run build";
  } catch {
    /* no package.json build */
  }
  return normalizeBuildCommand(projectMemory?.commands.build) ??
    normalizeBuildCommand(projectSnapshot?.detectedCommands.build) ??
    (workspaceRoot.toLowerCase().includes("/target/") ? "cargo build" : "npm run build");
}

export async function detectTestCommand(
  _workspaceRoot: string,
  projectMemory: ProjectMemory | null,
  projectSnapshot: ProjectSnapshot | null,
  readFile: (path: string) => Promise<string>
): Promise<string | null> {
  try {
    const packageJson = JSON.parse(await readFile("package.json")) as { scripts?: Record<string, string> };
    if (hasUsefulPackageTestScript(packageJson.scripts)) return "npm test";
  } catch {
    /* no package.json test */
  }

  try {
    await readFile("pubspec.yaml");
    return "flutter test";
  } catch {
    /* no Flutter pubspec */
  }

  return normalizeTestCommand(projectMemory?.commands.test) ??
    normalizeTestCommand(projectSnapshot?.detectedCommands.test);
}

export async function runApprovedBuildCheck(
  request: BuildCheckRequest,
  invokeCommand: TauriInvoke = invoke
): Promise<BuildCheckResult> {
  const validationError = validateBuildCheckWorkspace(request);
  if (validationError) throw new Error(validationError);
  return invokeCommand<BuildCheckResult>("workspace_run_approved_command", {
    workspaceRoot: request.workspaceRoot,
    command: request.command,
    runId: request.runId,
  });
}

export function summarizeBuildCheck(result: BuildCheckResult): string {
  const passed = result.exitCode === 0;
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  return [
    `Build check ${passed ? "passed" : "failed"}.`,
    `Run ID: ${result.runId}`,
    `Ran: ${result.command}`,
    `In: ${result.workingDirectory}`,
    `Started: ${result.startTimestamp}`,
    `Ended: ${result.endTimestamp}`,
    `Duration: ${result.durationMs} ms`,
    `Exit code: ${result.exitCode}`,
    `stdout:\n${stdout || "(empty)"}`,
    `stderr:\n${stderr || "(empty)"}`,
    passed ? "" : "Focused fix: inspect the build output above and address the first TypeScript/configuration error before rerunning the build.",
  ].filter(Boolean).join("\n\n");
}
