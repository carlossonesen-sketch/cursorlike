/**
 * Prerequisites detection for verify profiles.
 * Checks if required tools are available; offers install helpers.
 * Never auto-installs; installs only on explicit user click.
 */

// Re-export types and catalogs from catalog.ts
export type { InstallMethod, Prereq, VerifyProfile } from "./catalog";
export { CORE_PREREQS, RECOMMENDED_CLIS, VERIFY_PROFILES, getVerifyProfile, getPrereqById, pickVerifyProfileFromSignals, pickDefaultVerifyProfile } from "./catalog";

import { CORE_PREREQS, type Prereq, type VerifyProfile } from "./catalog";

export interface MissingPrereqResult {
  prereq: Prereq;
  status: "missing";
  reason?: string;
  /** When set, Install is disabled; user must install this package manager first. */
  blockedBy?: "winget" | "choco";
}

export interface RecommendedPrereqResult {
  prereq: Prereq;
  status: "installed" | "missing";
  reason?: string;
  /** When set, Install is disabled; user must install the dependency first. */
  blockedBy?: string;
}

/** Run command function: returns exit code. */
export type RunCommandFn = (cmd: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

/** Check if a file exists under workspace root. */
export type CheckFileExistsFn = (relPath: string) => Promise<boolean>;

/**
 * Check if a command/executable is available.
 * Windows: uses where.exe (e.g. where.exe node).
 * Returns true if exit code 0.
 */
export async function isCommandAvailable(cmd: string, runCommand: RunCommandFn): Promise<boolean> {
  const checkCmd = `where.exe ${cmd}`;
  try {
    const r = await runCommand(checkCmd);
    return r.exitCode === 0;
  } catch {
    return false;
  }
}

function buildCheckCommand(p: Prereq): string {
  if (!p.checkCommand) return "";
  const parts = [p.checkCommand, ...p.checkArgs];
  return parts.join(" ");
}

export interface DetectMissingPrereqsOptions {
  profile: VerifyProfile;
  runCommand: RunCommandFn;
  workspaceRoot?: string;
  checkFileExists?: CheckFileExistsFn;
  detectedTypes?: string[];
}

/** Check if winget is available. */
async function isWingetAvailable(runCommand: RunCommandFn): Promise<boolean> {
  try {
    const r = await runCommand("where.exe winget");
    return r.exitCode === 0;
  } catch {
    return false;
  }
}

/** Check if choco is available. */
async function isChocoAvailable(runCommand: RunCommandFn): Promise<boolean> {
  try {
    const r = await runCommand("where.exe choco");
    return r.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Detect which prerequisites are missing.
 * Includes special checks: Gradle wrapper, Flutter+ANDROID_HOME, package managers (winget/choco).
 */
export async function detectMissingPrereqs(
  opts: DetectMissingPrereqsOptions
): Promise<MissingPrereqResult[]> {
  const { profile, runCommand, checkFileExists, detectedTypes = [] } = opts;
  const results: MissingPrereqResult[] = [];

  const wingetAvailable = await isWingetAvailable(runCommand);
  const chocoAvailable = await isChocoAvailable(runCommand);

  for (const p of profile.requiredPrereqs) {
    const cmd = buildCheckCommand(p);
    if (!cmd) continue;
    try {
      const r = await runCommand(cmd);
      if (r.exitCode !== 0) {
        const entry: MissingPrereqResult = { prereq: p, status: "missing", reason: `Command not found: ${cmd}` };
        if (p.installMethod === "winget" && !wingetAvailable) {
          entry.blockedBy = "winget";
          if (!results.some((x) => x.prereq.id === "winget")) {
            results.unshift({ prereq: CORE_PREREQS.winget, status: "missing", reason: "Required to install tools via winget." });
          }
        } else if (p.installMethod === "choco" && !chocoAvailable) {
          entry.blockedBy = "choco";
          if (!results.some((x) => x.prereq.id === "choco")) {
            results.unshift({ prereq: CORE_PREREQS.choco, status: "missing", reason: "Required to install tools via Chocolatey." });
          }
        }
        results.push(entry);
      }
    } catch {
      const entry: MissingPrereqResult = { prereq: p, status: "missing", reason: `Failed to check: ${cmd}` };
      if (p.installMethod === "winget" && !wingetAvailable) {
        entry.blockedBy = "winget";
        if (!results.some((x) => x.prereq.id === "winget")) {
          results.unshift({ prereq: CORE_PREREQS.winget, status: "missing", reason: "Required to install tools via winget." });
        }
      } else if (p.installMethod === "choco" && !chocoAvailable) {
        entry.blockedBy = "choco";
        if (!results.some((x) => x.prereq.id === "choco")) {
          results.unshift({ prereq: CORE_PREREQS.choco, status: "missing", reason: "Required to install tools via Chocolatey." });
        }
      }
      results.push(entry);
    }
  }

  // Special check: Flutter + ANDROID_HOME
  const flutterMissing = results.some((r) => r.prereq.id === "flutter");
  const hasFlutterProfile = profile.requiredPrereqs.some((p) => p.id === "flutter");
  if (hasFlutterProfile && !flutterMissing) {
    const flutterPrereq = profile.requiredPrereqs.find((p) => p.id === "flutter");
    if (flutterPrereq) {
      const flutterCmd = buildCheckCommand(flutterPrereq);
      try {
        const r = await runCommand(flutterCmd);
        if (r.exitCode === 0) {
          // Flutter exists, check ANDROID_HOME
          const androidHomeCheck =
            'powershell -NoProfile -Command "if ($env:ANDROID_HOME -or $env:ANDROID_SDK_ROOT) { exit 0 } else { exit 1 }"';
          const ah = await runCommand(androidHomeCheck);
          if (ah.exitCode !== 0) {
            results.push({
              prereq: CORE_PREREQS.android_home,
              status: "missing",
              reason: "Flutter is installed but ANDROID_HOME / ANDROID_SDK_ROOT is not set.",
            });
          }
        }
      } catch {
        /* skip */
      }
    }
  }

  // Special check: Gradle wrapper for Flutter/Android projects
  if (checkFileExists) {
    const gradlewPaths = ["android/gradlew.bat", "gradlew.bat"];
    let hasGradlew = false;
    for (const path of gradlewPaths) {
      if (await checkFileExists(path)) {
        hasGradlew = true;
        break;
      }
    }
    if (!hasGradlew && (detectedTypes.includes("Flutter") || detectedTypes.some((t) => t.includes("Android")))) {
      results.push({
        prereq: CORE_PREREQS.gradle_wrapper,
        status: "missing",
        reason: "Gradle wrapper (gradlew.bat) not found in android/ or project root.",
      });
    }
  }

  return results;
}

/**
 * Check status of recommended prereqs.
 * Returns list with installed/missing status for each.
 * Includes blockedBy for dependency gating (npm, winget, choco).
 */
export async function checkRecommendedPrereqs(
  prereqs: Prereq[],
  runCommand: RunCommandFn
): Promise<RecommendedPrereqResult[]> {
  const results: RecommendedPrereqResult[] = [];

  // Check package manager availability for dependency gating
  const wingetAvailable = await isWingetAvailable(runCommand);
  const chocoAvailable = await isChocoAvailable(runCommand);
  const npmAvailable = await isCommandAvailable("npm", runCommand);

  for (const p of prereqs) {
    const cmd = buildCheckCommand(p);
    if (!cmd) {
      results.push({ prereq: p, status: "missing", reason: "Cannot check (no check command)" });
      continue;
    }

    try {
      const r = await runCommand(cmd);
      if (r.exitCode === 0) {
        results.push({ prereq: p, status: "installed" });
      } else {
        // Check for dependency blockers
        let blockedBy: string | undefined;
        if (p.installCommandPowerShell?.startsWith("npm ") && !npmAvailable) {
          blockedBy = "Node.js + npm";
        } else if (p.installMethod === "winget" && !wingetAvailable) {
          blockedBy = "winget";
        } else if (p.installMethod === "choco" && !chocoAvailable) {
          blockedBy = "Chocolatey";
        }
        results.push({ prereq: p, status: "missing", blockedBy });
      }
    } catch {
      results.push({ prereq: p, status: "missing" });
    }
  }

  return results;
}
