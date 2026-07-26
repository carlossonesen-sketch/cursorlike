import { groupDeveloperChanges, type DeveloperChangeRecord } from "./developerServices";

function equal(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

const base = {
  operation: "modify",
  originalHash: "before",
  currentHash: "after",
  baseSnapshotReference: "snapshot",
  status: "applied",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  hunks: [],
  workspace: "C:\\fixture",
} satisfies Partial<DeveloperChangeRecord>;

const records: DeveloperChangeRecord[] = [
  { ...base, changeId: "auto", patchId: "p3", taskId: "task", source: "auto", filePath: "src/app.ts" } as DeveloperChangeRecord,
  { ...base, changeId: "manual", patchId: "p1", taskId: null, source: "manual", filePath: "test/app.test.ts" } as DeveloperChangeRecord,
  { ...base, changeId: "agent", patchId: "p2", taskId: "task", source: "agent", filePath: "src/app.ts" } as DeveloperChangeRecord,
];

const groups = groupDeveloperChanges(records);
equal(groups.map((group) => group.filePath), ["src/app.ts", "test/app.test.ts"], "groups by file");
equal(groups[0]?.records.map((record) => record.source), ["agent", "auto"], "mixed sources");
equal(records.length, 3, "grouping must not duplicate authoritative records");
console.log("mixed-source Developer Changes grouping regression passed");
