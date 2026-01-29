import type { SessionRecord } from "../types";

export interface ResumeSuggestion {
  lastDid: string;
  nextStep: string;
}

/** Mock: "Last time you did X; next suggested step is Y". */
export function resumeSuggestion(session: SessionRecord | null): ResumeSuggestion | null {
  if (!session) return null;
  const firstLine = (session.explanation || "").split(/\r?\n/)[0]?.trim() || (session.userPrompt || "").slice(0, 80);
  const lastDid = firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine || "(no summary)";
  const nextStep = mockNextStep(session);
  return { lastDid, nextStep };
}

function mockNextStep(s: SessionRecord): string {
  if (s.status === "proposed") return "Apply, save for later, or refine the patch.";
  if (s.status === "pending") return "Apply the pending changes or refine the patch.";
  if (s.status === "reverted") return "Try a different approach or propose a new patch.";
  return "Review the changes, run checks, or propose a follow-up patch.";
}
