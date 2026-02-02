/**
 * Recommendation engine for project-aware CLI suggestions.
 * Detects project signals and recommends helpful tools.
 * Recommendations are suggestions only - never auto-install.
 */

import { RECOMMENDED_CLIS, type Prereq } from "./catalog";

export type CheckFileExistsFn = (relPath: string) => Promise<boolean>;
export type ReadFileFn = (relPath: string) => Promise<string>;

export interface ProjectSignals {
  hasFirebase: boolean;
  hasNextJs: boolean;
  hasStripe: boolean;
  hasVercel: boolean;
}

export interface RecommendedItem {
  prereq: Prereq;
  reason: string;
}

export interface RecommendationsResult {
  recommended: RecommendedItem[];
}

/**
 * Detect project signals from workspace files.
 * Uses lightweight checks: file existence + minimal JSON parsing.
 */
export async function detectProjectSignals(
  projectRoot: string,
  checkFileExists: CheckFileExistsFn,
  readFile: ReadFileFn
): Promise<ProjectSignals> {
  const signals: ProjectSignals = {
    hasFirebase: false,
    hasNextJs: false,
    hasStripe: false,
    hasVercel: false,
  };

  // Firebase detection: firebase.json or .firebaserc
  signals.hasFirebase =
    (await checkFileExists("firebase.json")) ||
    (await checkFileExists(".firebaserc"));

  // Next.js detection: next.config.* or "next" in package.json
  const hasNextConfig =
    (await checkFileExists("next.config.js")) ||
    (await checkFileExists("next.config.ts")) ||
    (await checkFileExists("next.config.mjs")) ||
    (await checkFileExists("next.config.mts"));

  if (hasNextConfig) {
    signals.hasNextJs = true;
  } else {
    // Check package.json for "next" dependency
    try {
      if (await checkFileExists("package.json")) {
        const pkgContent = await readFile("package.json");
        const pkg = JSON.parse(pkgContent) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if ("next" in deps) {
          signals.hasNextJs = true;
        }
      }
    } catch {
      /* ignore parse errors */
    }
  }

  // Stripe detection: "stripe" in package.json OR STRIPE_ in env files
  try {
    if (await checkFileExists("package.json")) {
      const pkgContent = await readFile("package.json");
      const pkg = JSON.parse(pkgContent) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if ("stripe" in deps) {
        signals.hasStripe = true;
      }
    }
  } catch {
    /* ignore */
  }

  if (!signals.hasStripe) {
    // Check .env or .env.local for STRIPE_
    try {
      if (await checkFileExists(".env")) {
        const envContent = await readFile(".env");
        if (envContent.includes("STRIPE_")) {
          signals.hasStripe = true;
        }
      }
    } catch {
      /* ignore */
    }
    if (!signals.hasStripe) {
      try {
        if (await checkFileExists(".env.local")) {
          const envContent = await readFile(".env.local");
          if (envContent.includes("STRIPE_")) {
            signals.hasStripe = true;
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  // Vercel detection: vercel.json or Next.js project
  signals.hasVercel = (await checkFileExists("vercel.json")) || signals.hasNextJs;

  return signals;
}

/**
 * Get CLI recommendations based on project signals.
 * Returns recommended prereqs with reasons.
 */
export async function getRecommendations(
  projectRoot: string,
  checkFileExists: CheckFileExistsFn,
  readFile: ReadFileFn
): Promise<RecommendationsResult> {
  const signals = await detectProjectSignals(projectRoot, checkFileExists, readFile);
  const recommended: RecommendedItem[] = [];

  // Firebase CLI recommendation
  if (signals.hasFirebase) {
    recommended.push({
      prereq: RECOMMENDED_CLIS["firebase-cli"],
      reason: "Detected firebase.json or .firebaserc → Firebase CLI recommended",
    });
  }

  // Google Cloud SDK recommendation (if Firebase detected)
  if (signals.hasFirebase) {
    recommended.push({
      prereq: RECOMMENDED_CLIS["gcloud-cli"],
      reason: "Detected Firebase project → Google Cloud SDK recommended",
    });
  }

  // Vercel CLI recommendation
  if (signals.hasVercel || signals.hasNextJs) {
    recommended.push({
      prereq: RECOMMENDED_CLIS["vercel-cli"],
      reason: signals.hasNextJs
        ? "Detected Next.js project → Vercel CLI recommended"
        : "Detected vercel.json → Vercel CLI recommended",
    });
  }

  // Stripe CLI recommendation
  if (signals.hasStripe) {
    recommended.push({
      prereq: RECOMMENDED_CLIS["stripe-cli-winget"],
      reason: "Detected Stripe dependency or STRIPE_ env var → Stripe CLI recommended",
    });
  }

  return { recommended };
}

// TODO (next step): Wire up to UI panels
// TODO (next step): Implement runInstallScript execution
// TODO (next step): Add status checking (installed/missing) for recommendations
