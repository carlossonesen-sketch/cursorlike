# NF Front-End Generator Design

Status: Blueprint-connected design. The full generator is not implemented yet.

## Goal

The Front-End Generator should become a separate NF engine that converts Project Blueprint data into a structured front-end implementation plan. It should generate or improve user-facing UI without owning backend logic, business rules, data persistence, command execution, or deployment.

This generator exists to help NF move from product intent to usable interface quickly while preserving the current project architecture and phase-gated build process.

## Current State

NF does not currently have a full front-end generation engine.

Current related code:

- `app/src/core/projectCreation/starterFileGenerator.ts`
  - Creates minimal starter file previews for new projects.
  - Supports a small Vite/React screen or Canvas scaffold.
  - Outputs `NewProjectFilePreview`.
  - Does not understand routes, component trees, design systems, user flows, responsive behavior, or existing UI preservation beyond simple starter files.
- `app/src/core/projectCreation/buildPlanGenerator.ts`
  - Creates a local deterministic MVP plan and inferred stack.
  - Does not generate detailed UI architecture.
- `app/src/core/phase/phaseBuildPlan.ts`
  - Creates phase tasks from Blueprint and Gap Analysis.
  - Should eventually consume front-end generator outputs as implementation tasks.
- `app/src/core/product/existingProductAssessment.ts`
  - Inventories existing UI entry points, routes/navigation hints, components/widgets/screens.
  - Should feed the generator so existing UI is preserved.

The current starter-file path should remain as the smallest safe scaffold path. The future Front-End Generator should be a richer engine that can produce a front-end plan before file edits.

## Blueprint Connection

Project Blueprint now has a `frontEndGenerationIntent` section. This is not generator output yet; it is the structured intent that future front-end generation should consume and update.

The section can carry:

- App type
- Target platform
- Founder-readable front-end summary
- Pages/screens
- Routes/navigation intent
- Components
- Layout/style preferences
- User flows
- Responsive needs
- Interaction states
- Validation needs
- Developer notes

This gives NF one stable Blueprint location for front-end planning without mixing front-end intent into backend APIs, data models, integrations, or business logic.

## Non-Goals

- Do not generate backend APIs.
- Do not generate database schemas.
- Do not decide business logic.
- Do not bypass Project Blueprint, Gap Analysis, Phase Build Plan, PatchEngine, or approval gates.
- Do not redesign existing products by default.
- Do not replace Developer Mode manual patch/build/audit workflows.

## Internal Build Engine Boundary

The Front-End Generator is a planning engine, not an execution engine.

It may produce structured front-end intent, plans, tasks, validation needs, and preservation warnings. It must not directly write files, apply patches, run commands, mark tasks complete, update progress, or repair failures.

Existing NF engine boundaries remain authoritative:

- Build plan creation:
  - `app/src/core/projectCreation/buildPlanGenerator.ts`
  - `app/src/core/phase/phaseBuildPlan.ts`
- Phase execution:
  - `app/src/core/phase/executionLoop.ts`
  - `app/src/core/phase/phaseExecutionState.ts`
- Patch preview/apply/revert:
  - `app/src/core/patch/PatchEngine.ts`
  - `app/src/core/phase/executionPatchRunner.ts`
- Build, test, and quality validation:
  - `app/src/core/phase/executionBuildCheckRunner.ts`
  - `app/src/core/phase/executionTestRunner.ts`
  - `QualityGate` data in the phase plan
- Repair attempts:
  - `app/src/core/project/buildRepair.ts`
  - `app/src/core/phase/executionRepairRunner.ts`
- Durable progress and dashboard reporting:
  - `app/src/core/phase/executionProgressRecorder.ts`
  - `app/src/core/project/projectDashboard.ts`

Generated front-end work must enter NF through the same pipeline as all other work:

1. Front-End Generator produces structured UI plan/task data.
2. Project Blueprint stores or references that data.
3. Phase Build Plan turns approved UI work into phase tasks.
4. Execution Loop selects the next approved task.
5. PatchEngine previews, validates, applies, and can revert file changes.
6. Build/test/quality gates validate the result.
7. Repair runners attempt bounded repair only when allowed.
8. Progress recorder updates Blueprint, memory, build plan, and action log.
9. Project Dashboard reports progress, confidence, blockers, quality gate status, and next task.

Guardrails for future implementation:

- Do not call Tauri filesystem commands directly from the Front-End Generator.
- Do not call shell/build/test command runners directly from the Front-End Generator.
- Do not mark phase tasks complete from the Front-End Generator.
- Do not create a separate front-end progress model outside Project Blueprint and PhaseExecutionState.
- Do not bypass preservation rules for imported or half-built products.
- If the generator is unsure whether a UI change is safe, emit a preservation warning or approval-sensitive task instead of assuming it can proceed.

Founder Mode should communicate this as: "NF plans the interface, then NF builds and verifies it through the same safe build system."

Developer Mode should expose the routing trace: front-end intent -> phase task -> patch proposal -> build/test/quality result -> progress/action-log update.

## Proposed Module Boundary

Future module:

`app/src/core/frontend/frontEndGenerator.ts`

Suggested supporting files:

- `app/src/core/frontend/frontEndGenerator.test.ts`
- `app/src/core/frontend/frontEndTypes.ts` if the shared type file becomes too large.
- `app/src/core/frontend/frontEndPlanStore.ts` only if the output becomes durable before it is embedded in Project Blueprint.

The module should be pure and deterministic first. AI-assisted generation can be layered later as a provider behind the same input/output contract.

## Inputs

The generator should accept a single structured request that can be built from Project Blueprint and phase state.

Required inputs:

- Founder idea/spec
- App type
- Target platform
- Product Brief
- User flows
- Feature list
- Current Phase Build Plan
- Gap Analysis
- Existing Product Assessment
- Current Product Inventory
- Preservation Rules

Optional inputs:

- Design preferences
- Brand notes
- Accessibility preferences
- Responsive targets
- Current source file inventory
- Existing route/component map
- Founder-approved constraints
- Developer preferences

Example TypeScript shape:

```ts
export interface FrontEndGeneratorInput {
  blueprintId: string;
  projectName: string;
  founderSpec: string;
  appType: string;
  targetPlatform: string;
  productBrief: ProductBrief | null;
  userFlows: UserFlowSpec[];
  features: FeatureSpec[];
  designPreferences: DesignPreferenceSpec[];
  phaseBuildPlan: PhaseBuildPlan | null;
  gapAnalysis: GapAnalysis | null;
  existingProductAssessment: ExistingProductAssessment | null;
  currentProductInventory: CurrentProductInventory | null;
  preservationRules: PreservationRules | null;
}
```

## Outputs

The generator should not write files directly. It should output a front-end plan that later phases can preview, approve, convert into patch proposals, and validate.

Required outputs:

- Front-end file plan
- Component tree
- Route map
- Layout plan
- Styling/design system notes
- Responsive behavior plan
- Basic interaction states
- Implementation tasks
- Validation checklist
- Preservation warnings

Example TypeScript shape:

```ts
export interface FrontEndGeneratorOutput {
  summary: string;
  filePlan: FrontEndFilePlanItem[];
  componentTree: FrontEndComponentNode[];
  routeMap: FrontEndRoute[];
  layoutPlan: FrontEndLayoutPlan;
  designSystem: FrontEndDesignSystemNotes;
  interactionStates: FrontEndInteractionState[];
  implementationTasks: PhaseTask[];
  validationChecklist: FrontEndValidationCheck[];
  preservationWarnings: string[];
  confidenceLevel: IntakeConfidenceLevel;
}
```

## Engine Responsibilities

The Front-End Generator should create plans for:

- Pages
- Components
- Routes
- Layout
- Styling
- Responsive behavior
- Empty/loading/error states
- Basic interaction states
- Accessibility checkpoints
- UI validation checklist

It should also decide:

- Whether to extend existing screens or create new ones.
- Which components should be shared.
- Which routes/screens support each MVP feature.
- Which UI work belongs in Foundation, MVP Features, Testing/Stabilization, or Polish.

## Separation From Backend and Business Logic

The generator may reference backend needs, but it should not implement them.

Allowed:

- "This screen needs an expense list data source."
- "This form needs create/update handlers."
- "This dashboard needs chart data."

Not allowed:

- Creating API implementations.
- Choosing database schema as final truth.
- Writing auth/payment/legal behavior.
- Replacing service architecture.

Backend/API/data tasks should remain in Blueprint, Gap Analysis, Phase Build Plan, and later backend/integration engines.

## Existing Product Preservation

For imported or half-built products, the generator must consume:

- `ExistingProductAssessment`
- `CurrentProductInventory`
- `PreservationRules`
- Existing UI entry points
- Existing routes/navigation hints
- Existing components/widgets/screens

Default behavior:

- Preserve current UI language.
- Preserve current workflows.
- Extend existing screens/components before replacing them.
- Defer visual redesign to Polish unless UI blocks MVP usability.
- Emit preservation warnings when proposed UI changes touch existing flows.

## Founder Mode Output

Founder Mode should show a plain-language summary:

- What screens NF plans to build or improve.
- What the main user flow will feel like.
- What NF will preserve in an existing product.
- What UI assumptions NF is making.
- What decisions need founder approval.
- What will be built in this phase versus delayed.

Founder Mode should not show raw file paths, component ids, or implementation details by default.

Example:

"NF will create a simple budgeting dashboard with income, expenses, categories, and a monthly summary. It will default to a responsive web app first so you can demo it quickly. Account sync is delayed unless you approve it."

## Developer Mode Output

Developer Mode should expose the raw structure:

- File plan
- Route map
- Component tree
- Component props/data dependencies
- Design token notes
- Responsive breakpoints
- Interaction states
- Validation checklist
- Preservation warnings
- Source Blueprint/GAP ids
- Phase task ids

Developer Mode should also make it clear which outputs are plans and which have become patch proposals.

## Integration With Existing NF Flow

Recommended future flow:

1. Discovery Intake captures the idea.
2. Project Blueprint stores product truth.
3. Existing Product Assessment inventories current UI if importing.
4. Gap Analysis identifies missing screens/features.
5. Front-End Generator creates a front-end plan.
6. Phase Build Plan turns front-end plan items into phase tasks.
7. Execution Loop converts approved tasks into patch proposals.
8. PatchEngine previews/applies/reverts changes.
9. Build/test/quality gates validate the result.

The generator should not directly call PatchEngine. It should produce structured implementation tasks that later execution can turn into patches.

## Validation Checklist

Every generated front-end plan should include checks for:

- Required screens exist.
- Main user flow is navigable.
- Empty/loading/error states are defined.
- Basic accessibility is addressed.
- Mobile/responsive behavior is specified.
- Existing product UI/workflows are preserved where required.
- No backend/auth/payment/deployment work is silently assumed complete.
- MVP scope is separated from polish.

## First Implementation Step Later

When generator implementation starts, continue from the Blueprint-connected intent:

1. Add `frontEndGenerator.ts`.
2. Convert `frontEndGenerationIntent` into a richer front-end plan.
3. Add tests for a simple web app and an imported existing app.
4. Attach generated front-end plan output to Project Blueprint or Phase Build Plan without writing files.
5. Add dashboard/Founder Mode rendering only after the model is stable.

Do not begin with AI calls or file writes.
