import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const tests = Object.keys(manifest.scripts)
  .filter((name) => name.startsWith("test:") && name !== "test:all")
  .sort();

for (const name of tests) {
  const npmCli = process.env.npm_execpath;
  const result = npmCli
    ? spawnSync(process.execPath, [npmCli, "run", name], {
      cwd: new URL("..", import.meta.url),
      stdio: "inherit",
      shell: false,
    })
    : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", name], {
    cwd: new URL("..", import.meta.url),
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) {
    console.error(`Could not run ${name}:`, result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Passed ${tests.length} repository-defined frontend test scripts.`);
