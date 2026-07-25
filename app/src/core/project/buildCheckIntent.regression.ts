import { detectBuildCheckIntent, detectBuildFailureFixIntent } from "./buildCheck";

const cases: Array<[string, boolean]> = [
  ["fix build test failure", true],
  ["fix build failure", true],
  ["debug tsc error", true],
  ["run check", false],
  ["what is next", false],
];

for (const [prompt, expected] of cases) {
  const actual = detectBuildFailureFixIntent(prompt);
  if (actual !== expected) {
    throw new Error(`detectBuildFailureFixIntent(${JSON.stringify(prompt)}) expected ${expected}, got ${actual}`);
  }
}

if (!detectBuildCheckIntent("run check")) {
  throw new Error("detectBuildCheckIntent should treat 'run check' as a build check request");
}

console.log("buildCheckIntent regression passed");
