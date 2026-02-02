/**
 * Prereq catalog for DevAssistantCursorLite.
 * Contains CORE_PREREQS (required) and RECOMMENDED_CLIS (optional).
 * Never auto-install; installs only on explicit user click.
 */

export type InstallMethod = "winget" | "choco" | "manual";

export interface Prereq {
  id: string;
  displayName: string;
  checkCommand: string;
  checkArgs: string[];
  installMethod: InstallMethod;
  installCommandPowerShell?: string;
  installUrl?: string;
  notes?: string;
}

/**
 * Core prerequisites - required tools for verify profiles.
 */
export const CORE_PREREQS: Record<string, Prereq> = {
  // Package managers (manual install)
  winget: {
    id: "winget",
    displayName: "winget (Windows Package Manager)",
    checkCommand: "where.exe",
    checkArgs: ["winget"],
    installMethod: "manual",
    installUrl: "https://learn.microsoft.com/en-us/windows/package-manager/winget/",
    notes: "Required to install other tools via winget. Install from Microsoft Store or App Installer.",
  },
  choco: {
    id: "choco",
    displayName: "Chocolatey",
    checkCommand: "where.exe",
    checkArgs: ["choco"],
    installMethod: "manual",
    installUrl: "https://chocolatey.org/install",
    notes: "Required to install other tools via Chocolatey. Install via PowerShell as Administrator.",
  },

  // Core development tools
  git: {
    id: "git",
    displayName: "Git",
    checkCommand: "where.exe",
    checkArgs: ["git"],
    installMethod: "winget",
    installCommandPowerShell: "winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements",
    installUrl: "https://git-scm.com/download/win",
  },
  node: {
    id: "node",
    displayName: "Node.js",
    checkCommand: "where.exe",
    checkArgs: ["node"],
    installMethod: "winget",
    installCommandPowerShell: "winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements",
    installUrl: "https://nodejs.org/",
    notes: "Required for npm, TypeScript, and most frontend tooling.",
  },
  npm: {
    id: "npm",
    displayName: "npm",
    checkCommand: "where.exe",
    checkArgs: ["npm"],
    installMethod: "winget",
    installCommandPowerShell: "winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements",
    installUrl: "https://nodejs.org/",
    notes: "Included with Node.js.",
  },
  java: {
    id: "java",
    displayName: "Java (Temurin 17)",
    checkCommand: "where.exe",
    checkArgs: ["java"],
    installMethod: "winget",
    installCommandPowerShell: "winget install --id EclipseAdoptium.Temurin.17.JDK -e --accept-source-agreements --accept-package-agreements",
    installUrl: "https://adoptium.net/",
  },
  flutter: {
    id: "flutter",
    displayName: "Flutter SDK",
    checkCommand: "where.exe",
    checkArgs: ["flutter"],
    installMethod: "winget",
    installCommandPowerShell: "winget install --id Google.Flutter -e --accept-source-agreements --accept-package-agreements",
    installUrl: "https://docs.flutter.dev/get-started/install",
  },
  python: {
    id: "python",
    displayName: "Python",
    checkCommand: "where.exe",
    checkArgs: ["python"],
    installMethod: "winget",
    installCommandPowerShell: "winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements",
    installUrl: "https://www.python.org/downloads/",
  },

  // Special/manual prerequisites
  android_home: {
    id: "android_home",
    displayName: "ANDROID_HOME / ANDROID_SDK_ROOT",
    checkCommand: "powershell",
    checkArgs: ["-NoProfile", "-Command", "if ($env:ANDROID_HOME -or $env:ANDROID_SDK_ROOT) { exit 0 } else { exit 1 }"],
    installMethod: "manual",
    installUrl: "https://docs.flutter.dev/get-started/install/windows#android-setup",
    notes: "Required for Flutter/Android. Set ANDROID_HOME or ANDROID_SDK_ROOT to your Android SDK path.",
  },
  gradle_wrapper: {
    id: "gradle_wrapper",
    displayName: "Gradle wrapper (gradlew.bat)",
    checkCommand: "",
    checkArgs: [],
    installMethod: "manual",
    installUrl: "https://docs.gradle.org/current/userguide/gradle_wrapper.html",
    notes: "Add gradlew.bat to android/ or project root.",
  },
};

/**
 * Recommended CLIs - optional tools suggested based on project signals.
 */
export const RECOMMENDED_CLIS: Record<string, Prereq> = {
  "firebase-cli": {
    id: "firebase-cli",
    displayName: "Firebase CLI",
    checkCommand: "where.exe",
    checkArgs: ["firebase"],
    installMethod: "manual",
    installCommandPowerShell: "npm install -g firebase-tools",
    installUrl: "https://firebase.google.com/docs/cli",
    notes: "Install via npm: npm install -g firebase-tools (requires Node.js)",
  },
  "gcloud-cli": {
    id: "gcloud-cli",
    displayName: "Google Cloud SDK",
    checkCommand: "where.exe",
    checkArgs: ["gcloud"],
    installMethod: "manual",
    installUrl: "https://cloud.google.com/sdk/docs/install",
    notes: "Install via official installer from Google Cloud.",
  },
  "vercel-cli": {
    id: "vercel-cli",
    displayName: "Vercel CLI",
    checkCommand: "where.exe",
    checkArgs: ["vercel"],
    installMethod: "manual",
    installCommandPowerShell: "npm install -g vercel",
    installUrl: "https://vercel.com/docs/cli",
    notes: "Install via npm: npm install -g vercel (requires Node.js)",
  },
  "stripe-cli-winget": {
    id: "stripe-cli-winget",
    displayName: "Stripe CLI",
    checkCommand: "where.exe",
    checkArgs: ["stripe"],
    installMethod: "winget",
    installCommandPowerShell: "winget install --id Stripe.StripeCLI -e --accept-source-agreements --accept-package-agreements",
    installUrl: "https://stripe.com/docs/stripe-cli",
  },
  "gh-cli": {
    id: "gh-cli",
    displayName: "GitHub CLI",
    checkCommand: "where.exe",
    checkArgs: ["gh"],
    installMethod: "winget",
    installCommandPowerShell: "winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements",
    installUrl: "https://cli.github.com/",
  },
  "aws-cli": {
    id: "aws-cli",
    displayName: "AWS CLI",
    checkCommand: "where.exe",
    checkArgs: ["aws"],
    installMethod: "winget",
    installCommandPowerShell: "winget install --id Amazon.AWSCLI -e --accept-source-agreements --accept-package-agreements",
    installUrl: "https://aws.amazon.com/cli/",
  },
  docker: {
    id: "docker",
    displayName: "Docker",
    checkCommand: "where.exe",
    checkArgs: ["docker"],
    installMethod: "winget",
    installCommandPowerShell: "winget install --id Docker.DockerDesktop -e --accept-source-agreements --accept-package-agreements",
    installUrl: "https://www.docker.com/products/docker-desktop/",
  },
};

/**
 * Verify profiles by project type.
 * Each profile specifies required prerequisites.
 */
export interface VerifyProfile {
  id: string;
  displayName: string;
  requiredPrereqs: Prereq[];
}

export const VERIFY_PROFILES: Record<string, VerifyProfile> = {
  "Node/TS": {
    id: "node-ts",
    displayName: "Node/TypeScript",
    requiredPrereqs: [CORE_PREREQS.git, CORE_PREREQS.node, CORE_PREREQS.npm],
  },
  "Next.js": {
    id: "nextjs",
    displayName: "Next.js",
    requiredPrereqs: [CORE_PREREQS.git, CORE_PREREQS.node, CORE_PREREQS.npm],
  },
  Firebase: {
    id: "firebase",
    displayName: "Firebase",
    requiredPrereqs: [CORE_PREREQS.git, CORE_PREREQS.node, CORE_PREREQS.npm],
  },
  Tauri: {
    id: "tauri",
    displayName: "Tauri",
    requiredPrereqs: [CORE_PREREQS.git, CORE_PREREQS.node, CORE_PREREQS.npm],
  },
  Flutter: {
    id: "flutter",
    displayName: "Flutter/Android",
    requiredPrereqs: [CORE_PREREQS.git, CORE_PREREQS.java, CORE_PREREQS.flutter],
  },
  Python: {
    id: "python",
    displayName: "Python",
    requiredPrereqs: [CORE_PREREQS.git, CORE_PREREQS.python],
  },
};

export type CheckFileExistsFn = (relPath: string) => Promise<boolean>;
export type ReadFileFn = (relPath: string) => Promise<string>;

/**
 * Pick verify profile from file signals (deterministic, lightweight).
 * Order: Flutter > Firebase > Next.js > Node/TS > Python > Node/TS default.
 */
export async function pickVerifyProfileFromSignals(
  checkFileExists: CheckFileExistsFn,
  readFile?: ReadFileFn
): Promise<VerifyProfile> {
  if (await checkFileExists("pubspec.yaml")) {
    return VERIFY_PROFILES["Flutter"];
  }
  if (
    (await checkFileExists("firebase.json")) ||
    (await checkFileExists(".firebaserc")) ||
    (await checkFileExists("functions/package.json"))
  ) {
    return VERIFY_PROFILES["Firebase"];
  }
  if (await checkFileExists("package.json")) {
    const hasNextConfig =
      (await checkFileExists("next.config.js")) ||
      (await checkFileExists("next.config.ts")) ||
      (await checkFileExists("next.config.mjs")) ||
      (await checkFileExists("next.config.mts"));
    if (hasNextConfig) return VERIFY_PROFILES["Next.js"];
    if (readFile) {
      try {
        const pkg = JSON.parse(await readFile("package.json")) as { dependencies?: Record<string, string> };
        if (pkg.dependencies?.next) return VERIFY_PROFILES["Next.js"];
      } catch {
        /* ignore */
      }
    }
    return VERIFY_PROFILES["Node/TS"];
  }
  if (
    (await checkFileExists("requirements.txt")) ||
    (await checkFileExists("pyproject.toml"))
  ) {
    return VERIFY_PROFILES["Python"];
  }
  return VERIFY_PROFILES["Node/TS"];
}

/**
 * Pick default verify profile from project root signals.
 * Alias for pickVerifyProfileFromSignals - pass checkFileExists and readFile bound to workspace.
 */
export const pickDefaultVerifyProfile = pickVerifyProfileFromSignals;

/**
 * Get merged verify profile for detected project types.
 */
export function getVerifyProfile(detectedTypes: string[]): VerifyProfile {
  const prereqs: Prereq[] = [];
  const seen = new Set<string>();
  for (const t of detectedTypes) {
    const profile = VERIFY_PROFILES[t];
    if (profile) {
      for (const p of profile.requiredPrereqs) {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          prereqs.push(p);
        }
      }
    }
  }
  if (prereqs.length === 0) {
    // Default to Node/TS profile
    return VERIFY_PROFILES["Node/TS"];
  }
  return { id: "merged", displayName: detectedTypes.join(", "), requiredPrereqs: prereqs };
}

/**
 * Look up prereq by id from either catalog.
 */
export function getPrereqById(id: string): Prereq | undefined {
  return CORE_PREREQS[id] ?? RECOMMENDED_CLIS[id];
}
