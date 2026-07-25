import {
  canCompleteTaskWithFiles,
  inferTaskKind,
  isPlanningOnlyFileChange,
  taskStepUsedPlanningOnly,
} from "./taskKind";
import type { BuildMilestone, BuildTask } from "../types";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function milestone(id: string, name: string, tasks: BuildTask[]): BuildMilestone {
  return { id, name, goal: name, status: "active", tasks };
}

assert(isPlanningOnlyFileChange(["docs/foundation/WEBSITE_PLATFORM_FOUNDATION.md"]), "foundation-only");
assert(!isPlanningOnlyFileChange(["src/App.tsx", "docs/foundation/x.md"]), "mixed files are not planning-only");

const websiteMilestone = milestone("mvp-website-platform", "MVP Website Platform", [
  { id: "t1", title: "Plan theme engine", status: "todo" },
  { id: "t2", title: "Build theme engine", status: "todo" },
  { id: "t3", title: "Build industry template picker shell", status: "todo" },
]);
assert(inferTaskKind(websiteMilestone, websiteMilestone.tasks[0]!) === "planning", "plan task");
assert(inferTaskKind(websiteMilestone, websiteMilestone.tasks[1]!) === "implementation", "build task");
assert(inferTaskKind(websiteMilestone, websiteMilestone.tasks[2]!) === "scaffold", "shell task");

assert(
  !canCompleteTaskWithFiles(websiteMilestone, websiteMilestone.tasks[1]!, [
    "docs/foundation/WEBSITE_PLATFORM_FOUNDATION.md",
  ]),
  "implementation cannot complete on foundation docs only"
);
assert(
  canCompleteTaskWithFiles(websiteMilestone, websiteMilestone.tasks[1]!, ["src/theme/ThemePage.tsx"]),
  "implementation can complete on src files"
);
assert(
  canCompleteTaskWithFiles(websiteMilestone, websiteMilestone.tasks[0]!, [
    "docs/foundation/WEBSITE_PLATFORM_FOUNDATION.md",
  ]),
  "planning can complete on foundation docs"
);

assert(
  taskStepUsedPlanningOnly("founder-mvp-phase", "t1", [
    {
      id: "s1",
      completedAt: "2026-01-01T00:00:00.000Z",
      milestoneId: "founder-mvp-phase",
      taskId: "t1",
      completed: "task",
      filesChanged: ["docs/foundation/WEBSITE_PLATFORM_FOUNDATION.md"],
      worksNow: [],
      stillNeedsWork: [],
      nextRecommendedStep: "",
    },
  ]),
  "detect planning-only completion steps"
);

console.log("task kind regression passed");
