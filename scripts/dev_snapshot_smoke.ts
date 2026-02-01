/**
 * Smoke test for project snapshot and detection logic.
 * Run from repo root: npx tsx scripts/dev_snapshot_smoke.ts
 *
 * Tests pure functions (inferDetectedType, shouldIgnorePathSegment).
 * Full snapshot generation requires the Tauri app (open workspace, check .devassistant/project_snapshot.json).
 */

import { inferDetectedType } from "../app/src/core/project/projectRoot";
import { shouldIgnorePathSegment } from "../app/src/core/project/snapshot";

function main() {
  console.log("=== Project Snapshot Smoke Test ===\n");

  console.log("1. inferDetectedType (pure):");
  const cases: [string[], string][] = [
    [["Cargo.toml"], "rust"],
    [["package.json"], "node"],
    [["pyproject.toml"], "python"],
    [["go.mod"], "go"],
    [["composer.json"], "php"],
    [["package.json", "yarn.lock"], "node"],
    [[".git"], "unknown"],
    [[], "unknown"],
  ];
  for (const [signals, expected] of cases) {
    const got = inferDetectedType(signals);
    const ok = got === expected ? "ok" : "FAIL";
    console.log(`   signals=${JSON.stringify(signals)} => ${got} (expected ${expected}) [${ok}]`);
  }

  console.log("\n2. shouldIgnorePathSegment (pure):");
  const ignoreCases: [string, boolean][] = [
    ["node_modules", true],
    [".git", true],
    ["src", false],
    ["NODE_MODULES", true],
    ["dist", true],
  ];
  for (const [seg, expected] of ignoreCases) {
    const got = shouldIgnorePathSegment(seg);
    const ok = got === expected ? "ok" : "FAIL";
    console.log(`   "${seg}" => ${got} (expected ${expected}) [${ok}]`);
  }

  console.log("\n=== Smoke test complete ===");
  console.log("For full snapshot: open workspace in the app, then check .devassistant/project_snapshot.json");
}

main();
