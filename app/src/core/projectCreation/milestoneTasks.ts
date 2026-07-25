import type { BuildTask, TaskKind } from "../types";

function includesAny(text: string, words: string[]): boolean {
  const lower = text.toLowerCase();
  return words.some((word) => lower.includes(word));
}

export function inferProjectKind(input: string, stack: string[] = []): "game" | "web" | "api" {
  const text = `${input} ${stack.join(" ")}`;
  if (includesAny(text, ["game", "canvas", "arcade", "player", "intruder", "fence"])) return "game";
  if (includesAny(text, ["api", "server", "backend", "service"])) return "api";
  return "web";
}

function task(id: string, title: string, kind: TaskKind = "implementation"): BuildTask {
  return { id, title, status: "todo", kind };
}

export function defaultTasksForMilestone(
  milestoneId: string,
  milestoneName: string,
  projectKind: "game" | "web" | "api"
): BuildTask[] {
  const normalized = milestoneName.toLowerCase();
  if (normalized.includes("core")) {
    if (projectKind === "game") {
      return [
        task(`${milestoneId}-t1`, "Add intruder spawning"),
        task(`${milestoneId}-t2`, "Add collision between player, intruders, and fence"),
        task(`${milestoneId}-t3`, "Add score or lives"),
        task(`${milestoneId}-t4`, "Add restart after failure"),
        task(`${milestoneId}-t5`, "Verify playable loop"),
      ];
    }
    if (projectKind === "api") {
      return [
        task(`${milestoneId}-t1`, "Define core data model"),
        task(`${milestoneId}-t2`, "Add primary API route"),
        task(`${milestoneId}-t3`, "Add request validation"),
        task(`${milestoneId}-t4`, "Add basic persistence or in-memory storage"),
        task(`${milestoneId}-t5`, "Verify core request flow"),
      ];
    }
    return [
      task(`${milestoneId}-t1`, "Build primary screen layout"),
      task(`${milestoneId}-t2`, "Add core user interaction"),
      task(`${milestoneId}-t3`, "Add state handling"),
      task(`${milestoneId}-t4`, "Add empty and error states"),
      task(`${milestoneId}-t5`, "Verify main user flow"),
    ];
  }
  if (normalized.includes("polish") || normalized.includes("reliability")) {
    return [
      task(`${milestoneId}-t1`, "Tighten visual polish"),
      task(`${milestoneId}-t2`, "Handle obvious error states"),
      task(`${milestoneId}-t3`, "Run build check and fix failures"),
      task(`${milestoneId}-t4`, "Clean up unused starter code"),
    ];
  }
  if (normalized.includes("testing") || normalized.includes("validation")) {
    return [
      task(`${milestoneId}-t1`, "Add clear README run instructions"),
      task(`${milestoneId}-t2`, "Verify fresh install and build"),
      task(`${milestoneId}-t3`, "Prepare founder testing checklist"),
      task(`${milestoneId}-t4`, "Capture remaining known issues"),
    ];
  }
  return [
    task(`${milestoneId}-t1`, `Plan ${milestoneName}`, "planning"),
    task(`${milestoneId}-t2`, `Implement first ${milestoneName} task`),
    task(`${milestoneId}-t3`, `Verify ${milestoneName}`),
  ];
}
