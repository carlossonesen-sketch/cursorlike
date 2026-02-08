// app/src/core/patch/EditPlan.ts
// Incremental edit plan: ordered, single-file steps.
// This will become the new "patch" flow (preview/apply per step).
// For now it's standalone and not wired into UI yet.

export type EditOperation =
  | {
      kind: "replace_range";
      /** 1-based inclusive start line */
      startLine: number;
      /** 1-based inclusive end line */
      endLine: number;
      /** replacement text (may contain newlines, no markdown fences) */
      newText: string;
    }
  | {
      kind: "search_and_replace";
      /** exact substring to match (must exist) */
      search: string;
      /** replacement text */
      replace: string;
      /** if true, replace all occurrences; default false */
      all?: boolean;
    }
  | {
      kind: "append";
      newText: string;
    }
  | {
      kind: "prepend";
      newText: string;
    };

export type EditStepOperation = "modify" | "create" | "delete";

export interface EditStep {
  id: string; // deterministic-ish: "step-1", "step-2", etc. or uuid
  filePath: string; // workspace-relative, forward slashes
  operation: EditStepOperation;

  summary: string;   // 1-2 lines
  rationale: string; // why this step exists

  // For create/modify: operations required. For delete: operations must be empty.
  operations: EditOperation[];
}

export interface EditPlan {
  version: 1;
  steps: EditStep[];
}

export type EditPlanValidationError =
  | { code: "not_object"; message: string }
  | { code: "missing_steps"; message: string }
  | { code: "empty_steps"; message: string }
  | { code: "bad_step"; message: string; stepIndex: number }
  | { code: "bad_path"; message: string; stepIndex: number }
  | { code: "bad_operations"; message: string; stepIndex: number };

export function normalizeRelPath(p: string): string {
  return p.replace(/^[/\\]+/, "").replace(/\\/g, "/").trim();
}

export function validateEditPlan(plan: unknown): { ok: true; value: EditPlan } | { ok: false; error: EditPlanValidationError } {
  if (!plan || typeof plan !== "object") return { ok: false, error: { code: "not_object", message: "plan must be an object" } };

  const obj = plan as Record<string, unknown>;
  if (!Array.isArray(obj.steps)) return { ok: false, error: { code: "missing_steps", message: "plan.steps must be an array" } };
  if (obj.steps.length === 0) return { ok: false, error: { code: "empty_steps", message: "plan.steps must not be empty" } };

  const steps: EditStep[] = [];
  for (let i = 0; i < obj.steps.length; i++) {
    const s = obj.steps[i] as any;
    if (!s || typeof s !== "object") return { ok: false, error: { code: "bad_step", message: "step must be an object", stepIndex: i } };

    const id = typeof s.id === "string" && s.id.trim() ? s.id.trim() : `step-${i + 1}`;
    const filePathRaw = typeof s.filePath === "string" ? s.filePath : typeof s.path === "string" ? s.path : "";
    const filePath = normalizeRelPath(filePathRaw);

    if (!filePath || filePath.includes("..") || filePath.startsWith("/")) {
      return { ok: false, error: { code: "bad_path", message: `invalid filePath: ${filePathRaw}`, stepIndex: i } };
    }

    const operation: EditStepOperation =
      s.operation === "create" || s.operation === "delete" || s.operation === "modify" ? s.operation : "modify";

    const summary = typeof s.summary === "string" ? s.summary : "";
    const rationale = typeof s.rationale === "string" ? s.rationale : "";

    const operationsRaw = Array.isArray(s.operations) ? s.operations : [];
    // delete steps must have empty ops
    if (operation === "delete" && operationsRaw.length > 0) {
      return { ok: false, error: { code: "bad_operations", message: "delete step must have operations=[]", stepIndex: i } };
    }
    // create/modify must have at least 1 op
    if ((operation === "create" || operation === "modify") && operationsRaw.length === 0) {
      return { ok: false, error: { code: "bad_operations", message: "create/modify step must have operations", stepIndex: i } };
    }

    // minimal shape check
    for (const op of operationsRaw) {
      if (!op || typeof op !== "object") {
        return { ok: false, error: { code: "bad_operations", message: "operation must be object", stepIndex: i } };
      }
      const k = (op as any).kind;
      if (k !== "replace_range" && k !== "search_and_replace" && k !== "append" && k !== "prepend") {
        return { ok: false, error: { code: "bad_operations", message: `unknown operation kind: ${String(k)}`, stepIndex: i } };
      }
    }

    steps.push({ id, filePath, operation, summary, rationale, operations: operationsRaw as EditOperation[] });
  }

  const out: EditPlan = { version: 1, steps };
  return { ok: true, value: out };
}
