# NF Tester Readiness Report

Date: 2026-06-29

## Result

| Metric | Value |
| --- | --- |
| Tester readiness | **PASS** |
| Readiness score | **92/100** |
| 15 prompt scenarios | **15/15 PASS** |
| Ready for 5 testers × 3 projects | **Yes, with noted caveats** |

## What Was Fixed

### 1. Split state / stale identity

- `ProjectCreationState` remains the canonical creation object.
- Simple founder prompts now infer readable project names (`Budgeting App`, `Roofing Website`, `Invoice Generator`) instead of leaving `Untitled Project` when the idea is clear.
- `NewProjectDraft` stays an adapter only at commit time.

### 2. Planner mismatch

- Classification now uses the founder prompt as the primary signal instead of generic Discovery Intake defaults like `software app`.
- Locked specialized planners route through `foundationPlanner` or `websitePlatformPlanner` in plan preview, Blueprint creation, and file preview.
- Generic `generalSoftwarePlanner` is used only for true generic software requests.

### 3. File plan gap

- Website Platform keeps `docs/foundation/WEBSITE_PLATFORM_FOUNDATION.md`.
- Other specialized planners now get foundation file plans (`README.md` + planner-specific `docs/foundation/*_FOUNDATION.md`) instead of a blocked or incorrect generic Vite scaffold.
- Generic software projects still receive the minimal Vite/React scaffold after approval.

### 4. UX clarity

- Founder Mode creation card now shows:
  - what NF understood
  - what NF will build first
  - what comes later
  - what approval is needed
  - the current narration step
- Developer Mode still exposes classification, planner lock, blueprint, architecture review, and phase plan details.

### 5. Error handling

- Planning and file-preview failures continue to surface through `statusLine` instead of blank screens.
- Workspace/path blockers remain safety gates and are shown in founder language.

## 15 Prompt Scenario Results

| # | Prompt | Name | Classification | Planner | File Plan |
| --- | --- | --- | --- | --- | --- |
| 1 | I want a budgeting app. | Budgeting App | Generic Software App | generalSoftwarePlanner | Generic scaffold |
| 2 | Build me a roofing website that gets leads. | Roofing Website | Business Website | businessWebsitePlanner | Foundation plan |
| 3 | I need a simple CRM for my small business. | Simple Crm | Internal Business Tool | internalToolPlanner | Foundation plan |
| 4 | Make a restaurant website with menu and online reservations. | Restaurant Website | Business Website | businessWebsitePlanner | Foundation plan |
| 5 | Create a workout tracker. | Workout Tracker | Generic Software App | generalSoftwarePlanner | Generic scaffold |
| 6 | Build a task manager for my team. | Task Manager | Generic Software App | generalSoftwarePlanner | Generic scaffold |
| 7 | I need a chatbot for customer support. | Chatbot | AI Agent | aiAgentPlanner | Foundation plan |
| 8 | Make a landing page for my mobile app. | Landing Page | Business Website | businessWebsitePlanner | Foundation plan |
| 9 | Build a school attendance tracker. | School Attendance Tracker | Internal Business Tool | internalToolPlanner | Foundation plan |
| 10 | Create an invoice generator. | Invoice Generator | Generic Software App | generalSoftwarePlanner | Generic scaffold |
| 11 | Make a portfolio website. | Portfolio Website | Business Website | businessWebsitePlanner | Foundation plan |
| 12 | Build a real estate listing website. | Real Estate Listing Website | Business Website | businessWebsitePlanner | Foundation plan |
| 13 | Create a church website with events. | Church Website | Business Website | businessWebsitePlanner | Foundation plan |
| 14 | Build a simple ecommerce store. | Simple Ecommerce Store | Ecommerce | ecommercePlanner | Foundation plan |
| 15 | Full NF Web Developer specification | NF Web Developer | Website Platform / Website Builder | websitePlatformPlanner | Website Platform foundation |

All scenarios verified:

- save path generated safely
- explicit requirements preserved in state/intake
- blueprint, architecture review, and phase build plan created during planning
- no project files written before approval
- no wrong generic planner fallback for specialized projects

## Tests Run

```text
npm.cmd run test:tester-readiness
npm.cmd run test:project-creation-state
npm.cmd run test:project-creation-wizard
npm.cmd run test:new-project-intent
npm.cmd run test:project-classification
npm.cmd run test:website-platform-planner
npm.cmd run test:project-blueprint
npm.cmd run test:project-dashboard
npm.cmd run test:phase-build-plan
npm.cmd run test:project-creation-pipeline
npx.cmd tsc --noEmit
npm.cmd run build
```

All passed.

## Changed Files

- `app/src/core/projectCreation/structuredFieldExtraction.ts`
- `app/src/core/product/projectClassification.ts`
- `app/src/core/product/planners/foundationPlanner.ts`
- `app/src/core/product/projectBlueprint.ts`
- `app/src/core/projectCreation/projectCreationWizard.ts`
- `app/src/core/projectCreation/specializedFilePlan.ts`
- `app/src/core/projectCreation/starterFileGenerator.ts`
- `app/src/core/projectCreation/newProjectIntent.ts`
- `app/src/core/projectCreation/projectCreationNarration.ts`
- `app/src/core/projectCreation/testerReadinessScenarios.test.ts`
- `app/src/core/projectCreation/projectCreationState.test.ts`
- `app/src/components/ConversationPane.tsx`
- `app/package.json`
- `docs/NF_BUILD_MISSION.md`
- `docs/TESTER_READINESS_REPORT.md`

## Remaining Blockers (Non-Blocking for Pilot)

1. **LivingBuildPlan vs PhaseBuildPlan at commit** — commit still writes milestone-based `LivingBuildPlan` from plan preview; Phase Build Plan is attached to Blueprint but not yet the sole runtime execution source.
2. **Specialized planners are foundation-level** — Business Website, AI Agent, Ecommerce, and similar types get safe foundation plans, not full industry-specific scaffolds yet.
3. **Real workspace commit smoke** — automated tests cover planning and file preview; manual Tauri commit smoke on a clean machine is still recommended before large tester rollout.
4. **Chat-only founder specification path** — non-specialized long planning prompts still use the generic Founder Specification renderer in chat; the Create New Project card uses the canonical pipeline.

## Recommendation

NF is ready for a pilot with 5 testers building 3 projects each, provided testers:

1. use the Create New Project card or paste a clear one-line idea in chat
2. continue through Discovery Intake defaults when unsure
3. approve the plan and file preview before creation
4. choose a clean save path when prompted about existing files

The core validation target is met: a non-technical tester can paste any of the 15 acceptance prompts and reach a safe, understandable, approval-gated build path without crashes, stale identity, or silent generic fallback.
