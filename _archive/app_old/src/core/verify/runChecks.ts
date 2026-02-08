/**
 * Run staged verification checks (typecheck, lint, test).
 * Stops on first failure.
 */

import type { DetectedCommands } from "../types";

export interface CheckStage {
  name: string;
  command: string;
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface VerificationResult {
  allPassed: boolean;
  stages: CheckStage[];
  failedStageIndex: number | null;
}

export interface RunChecksOptions {
  workspaceRoot: string;
  commands: DetectedCommands;
  runTests?: boolean;
  runCommand: (workspaceRoot: string, command: string) => Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
}

/**
 * Run verification checks in order: typecheck -> lint -> test (optional).
 * Stops on first failure.
 */
export async function runVerificationChecks(
  opts: RunChecksOptions
): Promise<VerificationResult> {
  const { workspaceRoot, commands, runTests = false, runCommand } = opts;
  const stages: CheckStage[] = [];
  let failedStageIndex: number | null = null;

  const toRun: { name: string; cmd: string }[] = [];
  if (commands.typecheck) toRun.push({ name: "typecheck", cmd: commands.typecheck });
  if (commands.lint) toRun.push({ name: "lint", cmd: commands.lint });
  if (runTests && commands.test) toRun.push({ name: "test", cmd: commands.test });

  for (let i = 0; i < toRun.length; i++) {
    const { name, cmd } = toRun[i];
    const result = await runCommand(workspaceRoot, cmd);
    const passed = result.exitCode === 0;
    stages.push({
      name,
      command: cmd,
      passed,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });
    if (!passed) {
      failedStageIndex = i;
      break;
    }
  }

  return {
    allPassed: failedStageIndex === null,
    stages,
    failedStageIndex,
  };
}
