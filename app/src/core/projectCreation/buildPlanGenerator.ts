import type { BuildMilestone, NewProjectDraft, NewProjectPlanPreview, ProjectCommands } from "../types";
import { defaultTasksForMilestone, inferProjectKind } from "./milestoneTasks";

function inferStack(draft: NewProjectDraft): { stack: string[]; commands: ProjectCommands } {
  const text = `${draft.projectName} ${draft.ideaText}`.toLowerCase();
  if (/\b(game|canvas|arcade|platformer|shooter|puzzle)\b/.test(text)) {
    return {
      stack: ["TypeScript", "Vite", "Canvas"],
      commands: { dev: "npm run dev", build: "npm run build" },
    };
  }
  if (/\b(api|backend|server|service)\b/.test(text)) {
    return {
      stack: ["TypeScript", "Node.js"],
      commands: { dev: "npm run dev", build: "npm run build", test: "npm test" },
    };
  }
  return {
    stack: ["TypeScript", "Vite", "React"],
    commands: { dev: "npm run dev", build: "npm run build" },
  };
}

function createMilestones(projectName: string, projectKind: "game" | "web" | "api"): BuildMilestone[] {
  return [
    {
      id: "m1",
      name: "MVP Scaffold",
      goal: `Create the smallest working version of ${projectName}.`,
      status: "active",
      tasks: [
        { id: "m1-t1", title: "Create project scaffold", status: "next" },
        { id: "m1-t2", title: "Add core screen and app structure", status: "todo" },
        { id: "m1-t3", title: "Add first working interaction", status: "todo" },
        { id: "m1-t4", title: "Verify local run/build command", status: "todo" },
      ],
    },
    {
      id: "m2",
      name: "Core Experience",
      goal: "Implement the main user flow end to end.",
      status: "planned",
      tasks: defaultTasksForMilestone("m2", "Core Experience", projectKind),
    },
    {
      id: "m3",
      name: "Polish and Reliability",
      goal: "Improve UX, error states, and basic quality checks.",
      status: "planned",
      tasks: defaultTasksForMilestone("m3", "Polish and Reliability", projectKind),
    },
    {
      id: "m4",
      name: "Testing Phase",
      goal: "Prepare the project for founder testing and quality review.",
      status: "planned",
      tasks: defaultTasksForMilestone("m4", "Testing Phase", projectKind),
    },
  ];
}

export function generateLocalBuildPlan(draft: NewProjectDraft): NewProjectPlanPreview {
  const { stack, commands } = inferStack(draft);
  const projectName = draft.projectName.trim() || "Untitled Project";
  const projectKind = inferProjectKind(`${draft.projectName} ${draft.ideaText}`, stack);
  return {
    mvpDefinition: `${projectName} MVP: a small, working version that demonstrates the core idea without extra features. It should be runnable locally, easy to demo, and focused on the fastest path to user-visible value.`,
    milestones: createMilestones(projectName, projectKind),
    nextRecommendedStep: "Review and approve this plan, then preview the initial files before anything is written.",
    suggestedCommands: commands,
    inferredStack: stack,
    status: "draft",
  };
}
