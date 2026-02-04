/**
 * Intent routing test harness (no framework).
 * Run: npx tsx src/core/intent/intentRouting.test.ts
 */

import { classifyFileActionIntent } from "./fileActionIntent";
import { routeUserMessage } from "./router";
import { hasDiffRequest } from "../workspace/readProjectFile";

type Expected = {
  intent: "file_open" | "file_edit" | "file_edit_search" | "none";
  extracted?: string[];
  action: "file_open" | "file_edit" | "file_edit_auto_search" | "multi_file_edit" | "chat";
  targetPath?: string;
  targets?: string[];
};

const cases: { input: string; expected: Expected }[] = [
  {
    input: "show me readme",
    expected: {
      intent: "file_open",
      extracted: ["readme"],
      action: "file_open",
      targetPath: "readme",
    },
  },
  {
    input: "open the readme",
    expected: {
      intent: "file_open",
      extracted: ["readme"],
      action: "file_open",
      targetPath: "readme",
    },
  },
  {
    input: "Open the file: README.md",
    expected: {
      intent: "file_open",
      extracted: ["README.md"],
      action: "file_open",
      targetPath: "README.md",
    },
  },
  {
    input: "add a local runtime section to the readme",
    expected: {
      intent: "file_edit",
      extracted: ["readme"],
      action: "file_edit",
      targets: ["readme"],
    },
  },
  {
    input: "Edit README.md: add a Local Runtime section",
    expected: {
      intent: "file_edit",
      extracted: ["README.md"],
      action: "file_edit",
      targets: ["README.md"],
    },
  },
  {
    input: "update gguf model selection to prefer q4_k_m",
    expected: {
      intent: "file_edit_search",
      action: "file_edit_auto_search",
    },
  },
  {
    input: "Update the code that selects the GGUF model...",
    expected: {
      intent: "file_edit_search",
      action: "file_edit_auto_search",
    },
  },
  {
    input: "find where emails are sent and block sending when DRY_RUN is true. show diff.",
    expected: {
      intent: "file_edit_search",
      action: "file_edit_auto_search",
    },
  },
  {
    input: "Show diff.",
    expected: {
      intent: "none",
      action: "chat",
    },
  },
];

function runTests(): void {
  let passed = 0;
  let failed = 0;
  for (const { input, expected } of cases) {
    const intent = classifyFileActionIntent(input);
    const route = routeUserMessage(input);

    const intentOk = intent.intentType === expected.intent;
    const extractedOk =
      expected.extracted == null ||
      (intent.targets.length === expected.extracted.length &&
        intent.targets.every((t, i) => t.path === expected.extracted![i]));
    const actionOk = route.action === expected.action;
    const targetPathOk =
      expected.targetPath == null ||
      (route.action === "file_open" && route.targetPath === expected.targetPath);
    const targetsOk =
      expected.targets == null ||
      (route.action === "file_edit" &&
        route.targets?.length === expected.targets!.length &&
        route.targets?.every((p, i) => p === expected.targets![i]));

    const ok = intentOk && extractedOk && actionOk && targetPathOk && targetsOk;
    if (ok) {
      passed++;
      console.log(`PASS: "${input.slice(0, 50)}${input.length > 50 ? "..." : ""}" => ${expected.action}${expected.targetPath != null ? ` (${expected.targetPath})` : ""}`);
    } else {
      failed++;
      console.error(`FAIL: "${input}"`);
      if (!intentOk) console.error("  intent: got", intent.intentType, "expected", expected.intent);
      if (!extractedOk) console.error("  extracted: got", intent.targets.map((t) => t.path), "expected", expected.extracted);
      if (!actionOk) console.error("  route.action: got", route.action, "expected", expected.action);
      if (!targetPathOk) console.error("  targetPath: got", route.action === "file_open" ? route.targetPath : "n/a", "expected", expected.targetPath);
      if (!targetsOk) console.error("  targets: got", route.action === "file_edit" ? route.targets : "n/a", "expected", expected.targets);
    }
  }
  console.log("");
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

function runDiffRequestTests(): void {
  const diffCases: { prompt: string; expected: boolean }[] = [
    { prompt: "find where emails are sent and block sending when DRY_RUN is true. show diff.", expected: true },
    { prompt: "Show diff.", expected: true },
    { prompt: "show me readme", expected: false },
  ];
  let passed = 0;
  let failed = 0;
  for (const { prompt, expected } of diffCases) {
    const got = hasDiffRequest(prompt);
    if (got === expected) {
      passed++;
      console.log(`PASS hasDiffRequest: "${prompt.slice(0, 50)}..." => ${got}`);
    } else {
      failed++;
      console.error(`FAIL hasDiffRequest: "${prompt}" => got ${got}, expected ${expected}`);
    }
  }
  console.log(`hasDiffRequest: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests();
runDiffRequestTests();
