# NF Build Mission

This document is the manual build compass for NF. Codex should read it before each NF task, keep the project on mission, check off completed work, and always report the next task.

## Required Codex Workflow

1. Before starting any NF task, read `docs/NF_BUILD_MISSION.md`.
2. Follow the build order in this document unless there is a clear technical reason not to.
3. Do not jump ahead.
4. After completing a task, update the checkbox in this document.
5. Add a short completion note under that task.
6. Then report:
   - what was completed
   - what tests passed
   - what files changed
   - the next unchecked task
7. If a task is blocked, mark it as blocked and explain why.
8. Do not remove existing developer tools.
9. Preserve Founder Mode and Developer Mode direction.
10. Keep `useChatController.ts` as a router as much as possible.

## Core Goal

NF is a universal rapid-build engine.

It should let a non-technical user type an idea and get to a finished product as fast as possible.

It should also let developers use normal build tools, patches, audits, build checks, files, debugging, and manual control.

NF should support:

- new product creation
- existing product continuation
- half-built product completion
- phase-gated autonomous building
- developer-controlled manual building

Core rule:

The user's job is to build a product. NF's job is to build the software.

---

## Operating Principles

- Phase gates, not micro-approval.
- Preserve before building existing projects.
- Existing products are continued, not replaced.
- Default to safe assumptions when the user skips intake questions.
- If user says "app" without platform, default to Web App.
- Build features first, polish UI after MVP unless UI blocks usability.
- Do not remove existing developer tools.
- Same engine underneath, different control levels on top.
- Product Blueprint is the central source of truth.
- Every task should update memory/build state when relevant.

---

## Current Architecture Facts

NF already has:

- Tauri/React shell
- project memory
- global project registry
- new project/import flows
- patch preview/apply/revert
- build-check execution
- build-failure repair helpers
- project dashboard
- project audit
- living build-plan tracking

Main current weakness:

`useChatController.ts` has too many responsibilities. New work should go into dedicated modules and keep it as a router.

---

## Build Phases

### Phase 1 - Discovery Intake Foundation

Goal:

Create the first reusable intake engine so NF can understand a raw user request before planning or building.

Why This Exists:

NF needs a reliable first step between "the user has an idea" and "NF creates a project plan." Discovery Intake captures what NF understood, infers obvious decisions, records assumptions, and identifies only the questions that materially affect the build.

- [x] Add `DiscoveryIntake` types to `app/src/core/types.ts`
  - Completed: Added shared Discovery Intake interfaces and confidence/source types.
- [x] Add `app/src/core/product/discoveryIntake.ts`
  - Completed: Added pure deterministic Discovery Intake inference module.
- [x] Add deterministic inference for simple requests
  - Completed: Added inference for product type, platform, MVP features, accounts, storage, charts, and mobile apps.
- [x] Add web-app default when platform is missing
  - Completed: Requests that say "app" without a platform default to `web app`.
- [x] Add safe defaults and assumptions
  - Completed: Added recommended defaults, assumptions, and decisions requiring later confirmation.
- [x] Add `app/src/core/product/discoveryIntake.test.ts`
  - Completed: Added regression coverage for the budgeting app intake case.
- [x] Add `test:discovery-intake` to `app/package.json`
  - Completed: Added the dedicated Discovery Intake test script.
- [x] Verify "Build me a budgeting app" test passes
  - Completed: `npm.cmd run test:discovery-intake`, `npx.cmd tsc --noEmit`, and `npm.cmd run build` passed.

Acceptance Criteria:

- Discovery intake can summarize a request
- It infers known answers
- It asks only material missing questions
- It can continue with defaults
- It does not write files
- Tests pass

Implementation Notes:

- Keep Discovery Intake pure and deterministic for now.
- Do not bind it to chat UI or workspace state yet.
- Design the module so it can later be reused for new projects, imported projects, feature requests, bug reports, and refactoring requests.
- Default unspecified "app" requests to Web App because that is fastest to build, demo, test, and share.

Lessons Learned:

- Discovery Intake should stay small and composable. It should prepare inputs for Product Blueprint instead of becoming the planning system itself.
- Browser app typechecking should not require Node globals in simple tests.
- The first version proved useful with deterministic inference before adding AI calls.

---

### Phase 1.5 - Project Classification Foundation

Goal:

Classify the founder's requested project type before NF creates the Project Blueprint or build plan, then route the project toward the right specialized planner.

Why This Exists:

NF must not treat every request as a generic software app. A Website Platform / Website Builder has different planning needs than a business website, SaaS product, mobile app, API service, AI agent, marketplace, ecommerce product, internal tool, or developer tool. Classification gives NF an early routing decision while preserving the Blueprint as the central source of truth.

- [x] Build Project Classification Engine
  - Completed: Added a deterministic project classifier with primary classification, secondary classifications, confidence, reasoning, required planner, clarification questions for low-confidence requests, Founder Mode summary text, Developer Mode raw details, and planner profile data.
  - Completed: Added a Website Platform planner profile that understands industry templates, layout templates, pages, sections, SEO, analytics, lead generation, forms, publishing, hosting, domains, and media library concerns.
  - Completed: Project Blueprint creation now runs classification before Product Brief generation and stores the result in a `projectClassification` Blueprint section. Generic intake product types are refined from classification so Website Platform projects do not become generic software apps.
  - Tests: Added `projectClassification.test.ts` and `test:project-classification`, covering Website Platform, Business Website, SaaS, Mobile App, AI Agent, and ambiguous project classification. `projectBlueprint.test.ts` verifies classification is attached to Blueprint and Website Platform routes to `websitePlatformPlanner`.
- [x] Build Website Platform Planner Foundation
  - Completed: Added a real `websitePlatformPlanner` foundation that generates Website Platform-specific Product Brief, MVP definition, architecture recommendation, dependency graph, milestones, phase tasks, quality gates, Founder Mode summary, and Developer Mode raw details.
  - Completed: Website Platform Blueprint creation now stores reusable `specializedPlannerOutput`, populates Website Platform-specific features, screens, data models, APIs, integrations, architecture, design-system notes, quality-state labels, developer details, and template-separation lessons before Gap Analysis or phase planning runs.
  - Completed: Phase Build Plan generation now consumes specialized planner phase tasks and quality gates when available, while preserving the generic planner path for other project classifications.
  - Completed: The planner keeps industry templates separate from layout templates, defers AI and advanced drag-and-drop until after MVP, and includes MVP success criteria for Roofing, HIEN, and NF template-created websites.
  - Tests: Added `websitePlatformPlanner.test.ts` and `test:website-platform-planner`, covering non-generic Product Brief, MVP scope, deferred AI, industry/layout separation, milestones, buildable Website Platform tasks, quality gates, Founder summary, Developer details, and phase-plan integration.
- [x] Add Chaos Simulation and Autonomous Engine Gap Report
  - Completed: Added a reusable pure simulation layer in `app/src/core/simulation/autonomousEngineSimulation.ts` with structured chaos scenarios, safe-stop expectations, Founder Mode explanations, Developer Mode raw details, missing engine capabilities, and autonomous engine maturity areas.
  - Completed: Added reusable chaos-simulation and autonomous-gap report generation that can be run for future projects without leaving active project records in NF.
  - Cleanup note: Project-specific planning reports from the Website Platform exercise were archived under `_quarantine/project-planning-artifacts/` so NF has no active project artifacts while preserving the reusable simulation engine.
  - Tests: Added `autonomousEngineSimulation.test.ts` and `test:autonomous-engine-simulation`, covering required chaos scenarios, safe-stop metadata, Founder/Developer visibility, gap report areas, readiness scoring, and generated markdown content.
- [x] Fix Project Creation: Workspace Manager, Planner Lock, and Commercial Product Inference
  - Issue found: Creating NF Web Developer regressed into generic "Untitled Project" planning, generic Vite scaffold behavior, manual correction for commercial multi-user accounts, and late overwrite failures such as `Refusing to overwrite existing file: package.json`.
  - Completed: Added a project-creation wizard/guard layer that generates safe slugged paths such as `D:\dev\nf-projects\nf-web-developer`, detects unsafe or conflicting workspace targets, blocks scaffolding inside the NF engine repo, and gives founder-safe options when the target folder already contains files.
  - Completed: Added planner lock validation so Website Platform / Website Builder classification keeps `websitePlatformPlanner` downstream and rejects generic fallback placeholders such as `Untitled Project`, `primary workflow`, `simple dashboard`, `basic settings`, `smallest working version`, and `generic Vite scaffold`.
  - Completed: Added commercial product inference so product-launch, platform, customer/client, SaaS, subscription, charge, accounts-now, or multi-user language infers accounts in MVP, roles/permissions, tenant/account boundaries, auth depth as a Foundation decision, and billing hooks as post-MVP unless explicitly approved.
  - Completed: New-project planning now uses the locked project-creation plan preview path, and Website Platform projects are blocked from generic Vite starter-file generation until a specialized Website Platform file plan exists.
  - Completed: Project file commit now checks whether the target folder is already non-empty before creating or writing files, preventing partial entry into creation before detecting existing project files.
  - Tests: Added `projectCreationWizard.test.ts` and `test:project-creation-wizard`, covering NF Web Developer slug/path, existing `package.json` blocking, Website Platform planner lock, generic scaffold rejection, commercial accounts-now inference, workspace requirement/defaulting, and engine-repo scaffold prevention.
  - Next safe action: Retry NF Web Developer creation through the guarded Project Creation Wizard, stop at Discovery/Architecture approval, and do not create files until a specialized Website Platform file plan exists.
- [x] Fix Project Creation Planning Route Mismatch
  - Issue found: The Create New Project card used `websitePlatformPlanner`, but chat Planning Mode still called the older generic Founder Specification renderer. That produced generic phrases such as "Founder-first software product" and "smallest working founder workflow", then planner lock correctly blocked the downstream `generalSoftwarePlanner` mismatch.
  - Completed: Chat Planning Mode now uses the same locked planner path as the project-creation wizard. Website Platform projects render Website Platform-specific planning sections from `websitePlatformPlanner` and validate the response through planner lock before returning it.
  - Completed: Generic Founder Specification fallback remains available only for non-specialized projects. Website Platform projects no longer use generic Founder Specification copy, generic Vite scaffold preview, or general software planner fallback.
  - Completed: Create-project planning still works without an active workspace when a valid draft/save path exists. File preview remains blocked until a specialized Website Platform file plan exists.
  - Tests: Expanded `projectCreationWizard.test.ts` to prove Create New Project plan preview and chat Planning Mode both use `websitePlatformPlanner`, generic placeholders are rejected, valid create-project planning does not trigger "Open a workspace first", and Website Platform file preview waits for a specialized file plan.
  - Next safe action: Retry NF Web Developer planning through chat and the Create New Project card, confirm both surfaces show `websitePlatformPlanner`, then stop before file creation.
- [x] Fix Project Identity Extraction and Merge
  - Issue found: A menu-created draft could remain `Untitled Project` with `D:\dev\nf-projects\untitled-project` when the founder pasted a full specification using bulleted or dash-separated identity fields such as `- Project name: NF Web Developer` and `Save path - D:\dev\nf-projects\nf-web-developer`.
  - Completed: Project name and save-path extraction now supports case-insensitive labels, bullet prefixes, colon separators, and dash separators. Explicit safe save paths are preserved instead of being regenerated from stale draft names.
  - Completed: Founder-spec prompts merge project identity into the active `NewProjectDraft` before Discovery Intake, Website Platform planning, and planner-lock validation.
  - Tests: Added `projectCreationWizard.test.ts` coverage for bulleted project names, dash-separated project names, bulleted save paths, dash-separated save paths, menu-default draft replacement, founder-spec planner routing with extracted identity, and planner lock still rejecting true `Untitled Project` fallback.
  - Follow-up: A Project State Manager remains the robust architecture option. This fix intentionally patches the immediate extraction/merge failure without creating the canonical project-state object yet.
- [x] Structured Field Extraction Engine + Project State Manager
  - Issue found: Full founder prompts could still split identity, classification, planner lock, Discovery Intake, and UI draft data across separate objects. Natural-language prompts such as `Create a new NF project named "NF Web Developer"` could enter the wrong route, while path labels such as `Project save path` risked being confused with project identity.
  - Completed: Added a reusable structured field extraction engine that captures project name, save path, project type, launch type, platform, account/user model, tenancy, hosting, AWS/domain/SSL, analytics/leads, MVP features, post-MVP features, non-goals, milestones, AI placeholders, quality gates, founder constraints, source text, confidence, and intent depth.
  - Completed: Added a canonical project creation state foundation that owns project id, name, slug, path, full prompt, bounded UI summary, extracted fields, inferred defaults, workspace safety, classification, locked planner, approval state, planner diagnostics, and Discovery Intake. `NewProjectDraft` now acts as an adapter instead of the source of truth for new structured flows.
  - Completed: Project creation routing now recognizes `new NF project` and `project named` prompts so the structured state path is used before workspace guards, Discovery Intake, Website Platform planning, and planner-lock validation.
  - Tests: Added `projectCreationState.test.ts` and `test:project-creation-state`, covering natural-language names, label/dash/bullet extraction, save-path preservation, menu-default draft replacement, Website Platform planner lock, commercial multi-user inference, AWS/domain/AI extraction, workspace conflicts, and generic fallback rejection. Expanded new-project intent coverage for `Create a new NF project named ...`.
  - Lessons learned: The robust architecture needs one project creation state object shared by UI cards, chat planning, Discovery Intake, planner lock, and future commit flows. Local extraction patches help, but they are not enough when every surface can otherwise invent its own defaults.
  - Follow-up: Continue migrating app surfaces to consume `ProjectCreationState` directly instead of passing `NewProjectDraft` through older UI and planning adapters.
- [x] Tester-Ready Universal Build Flow
  - Goal: Let a non-technical tester paste any one-sentence idea or full specification and reach a safe, buildable project plan without stale identity, wrong planner fallback, or files written before approval.
  - Completed: Added idea-to-name extraction for prompts such as `I want a budgeting app`, `Build me a roofing website`, and `Create a workout tracker` so `ProjectCreationState` no longer stays on `Untitled Project` when the idea clearly names the product.
  - Completed: Classification now scores from the founder prompt itself instead of generic Discovery Intake defaults such as `software app`, preventing website and business requests from being misclassified as generic software.
  - Completed: Added a reusable foundation planner and specialized foundation file plans for locked planners such as Business Website, AI Agent, Ecommerce, and Internal Business Tool. Website Platform keeps its full planner; generic software keeps the Vite scaffold.
  - Completed: `generateProjectCreationPlanPreview`, Blueprint creation, and starter file preview now route through the locked planner instead of silently falling back to `generalSoftwarePlanner`.
  - Completed: Added founder-facing creation narration and ConversationPane summaries for what NF understood, what it will build first, what comes later, and what approval is needed.
  - Tests: Added `testerReadinessScenarios.test.ts` and `test:tester-readiness`, covering all 15 tester acceptance prompts end to end through classification, blueprint, architecture review, phase plan, file plan, and approval-safe file preview.
  - Report: See `docs/TESTER_READINESS_REPORT.md`.


- NF classifies project type before Blueprint/Product Brief planning
- Website Platform / Website Builder routes to a specialized planner profile
- Low-confidence requests produce clarification questions
- Founder Mode can show a simple detected-project explanation
- Developer Mode can inspect raw classification details
- Chaos simulation identifies safe-stop behavior before large builds
- Autonomous engine gap report identifies missing capabilities before full autonomy
- Tests pass

Implementation Notes:

- Keep classification deterministic and reusable before adding AI assistance.
- Specialized classifications should outrank generic "app/software/platform" language when specialized signals exist.
- The classifier should produce planner routing data, not generate the plan itself.
- Store classification in Project Blueprint so future planning, gap analysis, front-end generation, and phase planning can consume the same decision.
- Specialized planner output should be generic enough to support future SaaS, AI Agent, Marketplace, Ecommerce, and Developer Tool planners without adding separate one-off Blueprint sections for each type.
- Website Platform planning should strengthen Blueprint and phase planning only; project-specific planning records should be archived or deleted after the exercise if no active project is approved.
- Chaos simulation should stay separate from real execution. It describes expected safe behavior and missing capabilities; it must not mark real implementation as complete.
- The autonomous engine gap report should be blunt by design. NF can start phase-gated planning before it can safely run long autonomous builds.

Lessons Learned:

- Discovery Intake summaries can introduce generic language that dilutes specialized intent. Classification needs to prefer specialized project signals over generic app/platform words.
- Website Platform planning is materially different from ordinary website planning; it needs template, section, publishing, hosting, domain, media, analytics, and lead-generation awareness before phase planning begins.
- Planner routing is not enough. The selected planner has to write concrete Blueprint sections and phase tasks before Gap Analysis and Phase Build Plan can avoid generic fallback.
- Industry templates and layout templates must be separate planning primitives so future layout changes do not corrupt content, forms, analytics, navigation, or business data.
- Chaos gates are useful before large builds because they force NF to prove it can stop safely. A passing chaos simulation does not mean full autonomy is ready; it means NF understands where to block, repair, retry, or ask.

---

### Phase 2 - Product Blueprint Foundation

Goal:

Create the central product truth model that converts Discovery Intake into a durable Project Blueprint. ProductBrief is one section of the Project Blueprint, not a competing model.

Why This Exists:

NF needs a source of truth that outlives the chat thread. The Blueprint should preserve the user request, inferred decisions, assumptions, defaults, confidence level, and later decisions so future planning and execution do not drift. Everything in NF should eventually read from and write to the Project Blueprint.

- [x] Add Project Blueprint Foundation
  - Completed: Added `ProjectBlueprint`, `ProductBrief`, section, identity, decision, and build-history types. ProductBrief now lives inside the central Blueprint model.
- [x] Add Blueprint store
  - Completed: Added a reusable Blueprint store module with injectable storage and a memory adapter for tests.
- [x] Feed `DiscoveryIntake` output into Blueprint
  - Completed: Added pure conversion from Discovery Intake into Project Blueprint.
- [x] Store user request, inferred answers, assumptions, defaults, confidence, later decisions
  - Completed: Blueprint stores Discovery Intake, Product Brief, assumptions, confidence, pending founder decisions, and creation history.
- [x] Add tests for Blueprint generation
  - Completed: Added `projectBlueprint.test.ts` and `test:project-blueprint`.

Acceptance Criteria:

- A user request can become a saved Blueprint
- Blueprint works for new projects
- No UI required yet
- Tests pass

Implementation Notes:

- Start with pure types, deterministic conversion, and tests before UI.
- Store enough structure for future phase planning without locking NF into one framework or project type.
- Keep Blueprint separate from project memory: Blueprint describes what should be built; project memory records what has happened.
- Avoid pushing this logic into `useChatController.ts`; expose a small module that chat can call later.

Lessons Learned:

- ProductBrief should remain a section inside Project Blueprint, not a separate top-level model.
- The Blueprint should include future sections as empty structured slots so later engines have a stable place to write.
- Store logic should accept injected storage so tests do not depend on browser state or file writes.

---

### Phase 3 - Existing Product Assessment

Goal:

Create an inspection layer for imported or half-built products before NF plans changes.

Why This Exists:

Existing products must be continued, not replaced. NF must first understand current design, workflows, folder structure, commands, architecture, and existing business logic before generating a gap analysis or proposing work.

- [x] Add `ExistingProductAssessment`
  - Completed: Added the core assessment type and a pure assessment engine that infers framework, project type, likely app type, inventory, architecture notes, confidence, and preservation rules from an in-memory file snapshot.
- [x] Add `CurrentProductInventory`
  - Completed: Added inventory types and detection for package files, source folders, important files, UI entry points, routes/navigation hints, components/widgets/screens, and build/test commands.
- [x] Add `PreservationRules`
  - Completed: Added conservative preservation rules that default to extending existing products and requiring approval for rewrites.
- [x] Update import flow to generate assessment
  - Completed: Existing project import evaluation now generates an `ExistingProductAssessment`, `CurrentProductInventory`, and `PreservationRules`, attaches them to a Project Blueprint draft, and import commit saves `.devassistant/project-blueprint.json` without modifying project source files.
- [x] Detect UI entry points, routes, components, commands, architecture, docs
  - Completed: Added detection coverage for React/Tauri-style projects and Flutter-style projects, including likely commands and architecture notes.
- [x] Add tests proving imported projects are preserved, not rewritten
  - Completed: Added `existingProductAssessment.test.ts` and `test:existing-product-assessment`, including Blueprint insertion and conservative preservation-rule assertions.

Acceptance Criteria:

- Existing project can be inspected
- Current work is inventoried
- Preservation rules are generated
- No rewrite/redesign is proposed by default
- Tests pass

Implementation Notes:

- Inventory should be factual and conservative.
- Preservation rules should become explicit data that later engines can obey.
- Detection should favor existing project conventions over NF preferences.
- Do not run project commands during assessment unless a later task explicitly adds approved command execution.
- Keep assessment snapshot-based and read-only until import-flow wiring explicitly passes real workspace files into it.
- Store assessment, inventory, and preservation rules inside Project Blueprint so Gap Analysis can consume them later.
- Import commit should persist Project Blueprint beside existing `.devassistant` memory files, not replace project memory or build-plan behavior.
- Keep commit dependencies injectable so import behavior can be tested without a Tauri filesystem.

Lessons Learned:

- Existing product assessment should be a factual inventory engine, not a planner.
- Preservation rules need to be structured data, not prompt text, so future execution engines can obey them.
- In-memory snapshot tests are enough to prove framework and preservation behavior without touching imported project files.
- Import flow can generate richer Blueprint state while preserving the existing preview/approve behavior.
- Commit tests should verify NF writes only `.devassistant` tracking files and does not mutate imported app files.

---

### Phase 4 - Gap Analysis

Goal:

Compare the desired Blueprint against the current product inventory and identify what is missing, partial, blocked, or risky.

Why This Exists:

NF cannot build efficiently until it knows the difference between the intended product and the actual project state. Gap Analysis prevents greenfield assumptions on imported products and keeps work focused on what moves the MVP forward.

- [x] Add `GapAnalysis`
  - Completed: Added structured `GapAnalysis` and `GapAnalysisItem` types plus a pure Gap Analysis engine.
- [x] Compare Blueprint target vs current inventory
  - Completed: Gap Analysis compares Product Brief MVP features against current inventory, UI entry points, routes, components, widgets, screens, and commands.
- [x] Identify missing MVP features
  - Completed: Missing Product Brief MVP features are reported as explicit gap items.
- [x] Identify partial features
  - Completed: Partial feature detection handles common naming hints, including plural/singular file naming such as `expenses` vs `ExpenseList` and `categories` vs `category_chip`.
- [x] Identify blockers
  - Completed: Pending founder decisions, missing imported inventory, and missing build/test commands are reported as possible blockers when relevant.
- [x] Preserve current UI/workflows by default
  - Completed: Existing UI/workflow touchpoints generate preservation warnings that favor extension over rewrite/redesign.
- [x] Add tests
  - Completed: Added `gapAnalysis.test.ts` and `test:gap-analysis` covering new projects, React/Tauri inventory, Flutter inventory, preservation warnings, Blueprint insertion, and no source-file mutation.

Acceptance Criteria:

- NF knows what exists
- NF knows what is missing
- NF knows what is blocked
- NF does not treat imported projects as greenfield
- Tests pass

Implementation Notes:

- Gap Analysis should be reusable for MVP comparison, launch readiness, technical debt, security audits, and imported applications.
- Separate missing features from quality issues and blockers.
- Preserve UI/workflows by default unless usability blocks the MVP.
- Output should be structured enough to feed Phase Build Plan directly.
- Keep Gap Analysis pure and Blueprint-driven; it should not read or write app source files.
- New/empty projects should still produce actionable missing-feature gaps without treating missing inventory as a blocker.
- Imported projects should use preservation rules and inventory data to warn before touching existing UI or workflows.

Lessons Learned:

- Gap Analysis should rank actionable missing/partial MVP work ahead of non-blocking founder decisions, while still recording those decisions as possible blockers.
- Conservative text matching needs small deterministic normalization for common file naming patterns before AI is necessary.
- Preservation warnings are most useful when tied to concrete UI entry points, routes, components, widgets, or screens.

---

### Phase 5 - Phase Build Plan

Goal:

Convert the Blueprint and Gap Analysis into a phase-gated build plan that NF can execute safely.

Why This Exists:

NF should ask for approval at phase gates, not after every small file edit. The Phase Build Plan defines the ordered path from discovery to launch readiness and gives the execution loop clear boundaries.

- [x] Add `PhaseBuildPlan`
  - Completed: Added structured `PhaseBuildPlan`, phase, and phase-task types plus a pure phase-plan generator.
- [x] Add `PhaseGate`
  - Completed: Added approval gates for every generated phase so NF can ask at phase boundaries instead of micro-approval steps.
- [x] Add `QualityGate`
  - Completed: Added quality gate types and default build/test quality gates for implementation phases.
- [x] Convert Blueprint + GapAnalysis into phased plan
  - Completed: Phase planning now uses Project Blueprint, Gap Analysis, preservation rules, and current product inventory to generate the default phase plan.
- [x] Include definitions of done per phase
  - Completed: Every phase includes a definition of done, tasks, quality gates, approval gate, goal, status, and stable id/title.
- [x] Add tests
  - Completed: Added `phaseBuildPlan.test.ts` and `test:phase-build-plan` covering new projects, existing projects, MVP gap tasks, preservation constraints, phase order, gates, Blueprint insertion, and no source-file mutation.

Required phases:

- Discovery
- Architecture Review
- Foundation
- MVP Features
- Testing/Stabilization
- Polish
- Launch Readiness

Acceptance Criteria:

- NF can generate a phased plan
- Tasks are actionable
- User approves phase gates, not micro-steps
- Polish happens after MVP unless UI blocks usability
- Tests pass

Implementation Notes:

- Phase tasks must be actionable enough for an execution engine, not just planning prose.
- Quality gates should define how NF knows a phase is safe to complete.
- Preserve Developer Mode manual tools while enabling Founder Mode automation.
- Do not treat UI polish as a foundation task unless the current UI blocks basic use.
- Keep Phase Build Plan generation pure and Blueprint-driven; execution belongs to the later Execution Loop phase.
- Generate the same six default phases for new and existing projects, but add preservation-first tasks and constraints for imported products.
- MVP feature tasks should come from Gap Analysis missing/partial features so the future execution engine has direct task inputs.

Lessons Learned:

- Phase Build Plan is the bridge from analysis to execution; it should not inspect files or run commands itself.
- Phase gates should be explicit data so Founder Mode can approve direction while Developer Mode can still inspect the detailed tasks.
- Preservation constraints need to travel with individual tasks, not just live as high-level notes.
- Architecture Review belongs between Discovery and Foundation so implementation cannot begin until architectural blockers, circular dependencies, security assumptions, and required founder decisions are visible.

---

### Phase 5.5 - Architecture Review Gate and Project Health Engine

Goal:

Insert a mandatory Architecture Review phase between Discovery and Foundation, and create a continuously updated Project Health model that tracks readiness throughout planning and execution.

Why This Exists:

NF should behave like a senior software architect before it starts implementation. The Architecture Review Gate catches weak architecture, circular dependencies, security gaps, missing assumptions, and founder decisions before Foundation begins. Project Health gives Founder Mode a simple readiness signal while preserving raw Developer Mode evidence.

- [x] Add Architecture Review Gate
  - Completed: Added `architectureReview.ts`, a pure Architecture Review engine that evaluates architecture shape, scalability, maintainability, module boundaries, dependency graph, circular dependencies, reuse opportunities, security/privacy assumptions, data model quality, future AI integration, technical debt, missing assumptions, and founder approvals.
  - Completed: Added `ArchitectureReviewReport`, `ArchitectureFinding`, and `ArchitectureApproval` types, plus Blueprint attach support.
  - Completed: Phase Build Plan now inserts `Architecture Review` between `Discovery` and `Foundation`, with architecture report, no-critical-blocker, and dependency-graph quality gates.
- [x] Add Project Health Engine
  - Completed: Added `projectHealth.ts`, a reusable Project Health engine that scores Planning, Architecture, Dependencies, Implementation, Testing, Documentation, Security, Performance, Scalability, Technical Debt, Maintainability, Risk, Autonomy Readiness, and Overall Project Health.
  - Completed: Added `ProjectHealthReport` and category score types, trend/history support, top risks, top strengths, and next recommendation.
  - Completed: Added Blueprint attach support so future Blueprint, architecture review, implementation, checks, repairs, quality gates, and dashboard updates can preserve health state.
- [x] Add Dashboard sections
  - Completed: Project Dashboard now exposes read-only Architecture Review, Project Health, and Risk Summary sections.
  - Completed: Founder Mode shows status, score, risks, strengths, and next recommendation in plain language. Developer Mode exposes raw architecture, health, risk, category, dependency, and history details.
- [x] Add tests
  - Completed: Added `architectureReview.test.ts`, `projectHealth.test.ts`, and updated dashboard/phase-plan tests.
  - Tests cover architecture review, critical architecture failures, circular dependency detection, architecture approval gate, health score calculation, health updates, Founder Mode, Developer Mode, and dashboard rendering.

Acceptance Criteria:

- Architecture Review phase exists between Discovery and Foundation
- Architecture Review blocks Foundation on critical findings
- Circular dependencies are detected
- Project Health produces category scores, top risks, top strengths, and next recommendation
- Dashboard exposes Architecture Review, Project Health, and Risk Summary read-only
- Founder Mode remains simple
- Developer Mode exposes raw details
- Tests pass

Implementation Notes:

- Architecture Review is pure and Blueprint-driven. It should not write implementation files or run commands.
- Architecture must pass, or have only continuable review items, before Foundation should begin.
- Project Health should read existing Blueprint, Architecture Review, Phase Build Plan, Phase Execution State, checks, repairs, and blockers instead of inventing disconnected state.
- Health status is not a replacement for quality gates. It is a dashboard-readable signal built from the same evidence.

Lessons Learned:

- The phase plan needed an explicit architecture gate, not just architecture notes hidden inside Foundation.
- Circular dependency detection is small but important; without it, the future scheduler can loop or choose impossible tasks.
- Founder Mode needs a simple health signal, but Developer Mode needs enough raw evidence to explain why a project is blocked or safe to continue.

---

### Phase 6 - Autonomous Execution Loop v1

Goal:

Create the first bounded execution loop that can complete approved phase tasks with checks, repair, memory updates, and clear stopping points.

Why This Exists:

The core NF promise requires automation. Inside an approved phase, NF should implement planned tasks, run checks, repair failures, update memory, and advance without asking the user to approve every small step.

- [x] Add `PhaseExecutionState`
  - Completed: Added structured phase execution state with current phase/task, completed/skipped/blocked tasks, blocker reason, last action, next action, build/test/check state, repair attempts, phase status, confidence, timestamps, and history.
- [x] Add `ExecutionLoop`
  - Completed: Added a bounded `executionLoop.ts` foundation that plans the next execution step without running commands, applying patches, or modifying project files.
- [x] Select next task in approved phase
  - Completed: ExecutionLoop v1 selects the next uncompleted, unskipped, unblocked task in the current approved or active phase.
- [x] Apply safe/non-destructive changes automatically
  - Completed: Added a conservative execution patch runner that bridges ExecutionLoop to the existing PatchEngine. It auto-applies only approved/active-phase, safe-classified, non-destructive patches that pass validation, preview, apply, and verification; uncertain, destructive, approval-sensitive, or preservation-sensitive work stops for approval or blocks.
- [x] Run build checks
  - Completed: Added a phase-level execution build-check runner that selects the existing build command, reuses the active-workspace path guard, delegates to the existing build-check runner, records pass/fail results into `PhaseExecutionState`, blocks failed tasks, and recommends repair without starting repair loops.
- [x] Run tests where available
  - Completed: Added a phase-level execution test runner that detects package, snapshot, memory, and Flutter test commands, reuses the active-workspace command guard, delegates to the existing approved command runner, records test pass/fail/unavailable status into `PhaseExecutionState`, blocks failed tasks, and recommends repair or continuation without starting retry loops.
- [x] Attempt bounded repair
  - Completed: Added a phase-level execution repair runner that only runs inside approved/active phases after a failed build/test/check result, uses existing build-failure parsing and focused repair helpers, enforces max repair attempts, refuses sensitive/destructive repairs, records repair attempts in `PhaseExecutionState`, and recommends rerunning checks after a safe repair.
- [x] Update memory/build plan/action log
  - Completed: Added a phase-level execution progress recorder that saves Project Blueprint execution state, updates matching living build-plan tasks, updates project memory resume/recent-work state, appends action-log entries, and preserves existing manual memory/build-plan helpers through injectable store dependencies.
- [x] Stop at blockers or phase completion
  - Completed: ExecutionLoop v1 stops on blocked tasks, unapproved phases, destructive/rewrite tasks, approval-sensitive tasks, and phase completion.
- [x] Add tests
  - Completed: Added `executionLoop.test.ts`, `executionPatchRunner.test.ts`, `executionBuildCheckRunner.test.ts`, `executionTestRunner.test.ts`, `executionRepairRunner.test.ts`, `executionProgressRecorder.test.ts`, `test:execution-loop`, `test:execution-patch-runner`, `test:execution-build-check-runner`, `test:execution-test-runner`, `test:execution-repair-runner`, and `test:execution-progress-recorder` covering approved-phase selection, skipped completed tasks, blocked tasks, safety classification, simulated completion, safe patch auto-apply, unsafe patch blocking, approval-sensitive patch handling, failed patch recording, build-check pass/fail recording, test pass/fail/unavailable recording, bounded repair attempts, sensitive/destructive repair blocking, durable Blueprint/memory/build-plan/action-log recording, path-drift blocking, phase completion, and no source-file mutation.

Acceptance Criteria:

- NF can work through tasks inside a phase
- NF does not ask for approval after every small step
- NF stops for true blockers
- NF reports phase completion and next gate
- Tests pass

Implementation Notes:

- Bound the loop tightly in v1: one approved phase, safe changes only, clear blockers, clear logs.
- Command execution must remain constrained to the active project path.
- Repair attempts should be limited and based on current file contents plus latest command output.
- Execution should update project memory, build plan, action log, and dashboard state when relevant.
- Phase Execution State should be initialized from Phase Build Plan before the execution loop starts.
- State transitions should stay pure and testable until the execution loop wires them to file edits, checks, and repairs.
- Store execution progress in Project Blueprint so dashboard, memory, and future automation read one source of truth.
- ExecutionLoop v1 should only plan and classify steps; real file edits, command execution, and repairs remain future tasks.
- Safety classification must stop or require approval for destructive changes, credentials, accounts, paid services, deployment, legal/privacy/payment decisions, and scope changes.
- ExecutionPatchRunner must stay a narrow adapter around PatchEngine; it should never bypass patch validation, writable preview generation, apply, or disk verification.
- Safety uncertainty should require approval instead of auto-applying, especially for existing products with preservation warnings.
- Manual patch preview/apply/revert remains the Developer Mode path; autonomous patch application is an additional bounded engine path.
- ExecutionBuildCheckRunner must stay a narrow adapter around the existing build-check system; it should reuse command detection, active-workspace path validation, and the approved command runner instead of invoking commands directly.
- Build-check failures should record durable phase state and recommend repair, but bounded repair remains the next mission task rather than being folded into command execution.
- The runner should refuse duplicate running checks so autonomous execution cannot spin up overlapping build loops.
- ExecutionTestRunner should reuse the same approved-command and active-workspace guard path as build checks; test execution is another quality gate adapter, not a separate shell path.
- Missing test commands should be recorded as unavailable without failing or blocking the phase, because some early projects will not have automated tests yet.
- Test failures should block advancement and recommend repair, but automatic repair remains a later bounded task.
- ExecutionRepairRunner should only open a repair window after a failed build/test/check result and should use existing focused repair helpers rather than broad model-driven rewrites.
- Repair attempts must be bounded per task; exhausted attempts block and require manual review instead of retrying indefinitely.
- Sensitive work involving credentials, accounts, paid services, deployment, legal/privacy, or scope decisions must not be repaired automatically.
- ExecutionProgressRecorder should be the persistence bridge from autonomous execution to existing durable systems: Project Blueprint, living build plan, project memory, and action log.
- Recorder writes should be injectable so phase-engine tests can verify durable state updates without touching user project source files.
- When phase execution has already advanced or cleared `currentTaskId`, completion recording should use the most recent completed task id to update matching legacy build-plan tasks.

Lessons Learned:

- Execution state is the durable "where are we now?" layer between static phase planning and the future autonomous loop.
- Blocking a task must stop advancement; completing a task may advance within the phase but should stop at phase gates.
- Repairs and check results should be history records, not ad hoc chat text, so future automation can make decisions from them.
- The first execution loop should be a planner and safety classifier before it becomes an actor.
- Approval-sensitive work should be classified from task title, rationale, and constraints so future autonomous execution can remain bounded.
- Env/API-key style patterns need explicit safety matching because they often appear as identifiers rather than plain-language credentials.
- Preservation warnings are approval signals for existing products; they should keep NF conservative without falsely implying the task was attempted.
- Auto-apply should be state/result driven and should update PhaseExecutionState rather than relying on chat text.
- Build checks are another engine adapter, not a UI feature; keeping them injectable made the safety behavior testable without touching real project files.
- Path-drift protection belongs in the shared build-check guard and should be reused by every future autonomous command runner.
- A failed build should block advancement and point to repair; it should not silently retry or advance the phase.
- Test command detection should be reusable and conservative: package scripts and Flutter metadata are enough for v1, while unknown projects should report tests unavailable instead of guessing.
- Pass/fail/unavailable are different states; treating missing tests as a non-failure keeps early MVP work moving while still making quality gaps visible.
- Keeping test execution injectable lets NF prove autonomous quality-gate behavior without mutating user projects during regression tests.
- Existing deterministic repair helpers are useful when treated as narrow tools: parse the failure, read referenced files, generate one focused patch, and stop when no safe helper matches.
- A successful repair should reopen the task for verification and recommend rerunning checks, not mark the task complete.
- Unsupported failures should be recorded as blocked repair attempts so future automation can explain why manual review is needed.
- Blueprint section statuses should use the existing schema vocabulary (`draft`, `ready`, `needsReview`) rather than inventing phase-specific status strings.
- The old living build plan and new PhaseExecutionState can coexist if the recorder treats task ids as the bridge and only updates matching legacy tasks.
- Action-log entries should be concise outcome records, while richer execution detail stays in PhaseExecutionState history.

---

### Phase 7 - Founder Mode / Developer Mode Control

Goal:

Add an explicit control-level model so Founder Mode can be simple and automated while Developer Mode keeps professional tools visible.

Why This Exists:

NF serves non-technical founders and experienced developers. Both should use the same engine, but the UI and control level should differ without removing existing developer capabilities.

- [x] Add control level concept
  - Completed: Added internal `ControlLevel` / `ControlPreferences` types, Blueprint defaults, and a reusable control policy engine for manual, assisted, guided, and autonomous behavior.
- [x] Founder Mode uses simplified phase gates
  - Completed: Added founder-facing phase gate summaries that show phase name, completed work, quality status, blockers, sensitive decisions, next action, and a simple phase-level continue decision while hiding developer-only implementation details by default.
- [x] Developer Mode keeps manual tools visible
  - Completed: Added Developer Mode tool visibility helpers that keep patch controls, build/test controls, audit controls, manual command controls, raw task state, dashboard/workspace tooling, and repair/debug helpers available for developer/manual/assisted control levels while Founder Mode hides developer-heavy controls by default.
- [x] Preserve patch preview/apply/revert
  - Completed: Added patch workflow preservation regression coverage proving real `PatchEngine` preview/apply/revert still works, autonomous safe apply uses existing patch validation/write verification, unsafe and sensitive patches do not auto-apply, and Developer Mode patch controls remain available while Founder Mode may hide them by default.
- [x] Preserve build checks
  - Completed: Added build-check preservation regression coverage proving manual build-check intent detection, approved command execution, workspace/path safety guards, autonomous runner guard reuse, raw failure output/state recording, and Developer Mode build-control availability all remain intact.
- [x] Preserve audits
  - Completed: Added audit preservation regression coverage proving manual project audit, code audit, file audit routing, source-file inspection, dashboard/audit-related helper importability, Developer Mode audit-control availability, Founder Mode presentation hiding, and sensitive/destructive approval behavior all remain intact.
- [x] Preserve file/debug workflows
  - Completed: Added file/debug workflow preservation regression coverage proving workspace/file explorer helpers, file resolution, workspace safety guards, Tauri raw log/command helpers, manual debug/repair helpers, raw build error storage, Developer Mode raw/manual controls, Founder Mode presentation hiding, and autonomous repair approval boundaries all remain intact.
- [x] Add tests or smoke checks
  - Completed: Added `controlLevel.test.ts`, `founderPhaseGate.test.ts`, `developerModeTools.test.ts`, `patchWorkflowPreservation.test.ts`, `buildCheckPreservation.test.ts`, `auditPreservation.test.ts`, `fileDebugWorkflowPreservation.test.ts`, `test:control-level`, `test:founder-phase-gate`, `test:developer-mode-tools`, `test:patch-workflow-preservation`, `test:build-check-preservation`, `test:audit-preservation`, and `test:file-debug-workflow-preservation` covering manual approval behavior, assisted suggestions/checks without auto-apply, guided safe in-phase automation with phase gates, autonomous bounded repair, simplified Founder Mode phase gates, Developer Mode detailed gate data, Developer Mode manual tool visibility, patch preview/apply/revert preservation, build-check preservation, audit preservation, file/debug workflow preservation, sensitive/destructive approval overrides, Blueprint storage, and Developer Mode tool importability.

Acceptance Criteria:

- Non-technical users get simplified automation
- Developers keep direct control
- Existing tools are not removed
- Tests pass

Implementation Notes:

- Treat control level as a product behavior setting, not a separate engine.
- Founder Mode should hide complexity, not delete capability.
- Developer Mode must preserve patch preview/apply/revert, build checks, audits, file explorer, debugging, and manual commands.
- Avoid duplicating workflows; expose the same underlying engine through different controls.
- Store control preferences in Project Blueprint so future runners, dashboards, and UI can read one durable policy source.
- Use `manual`, `assisted`, `guided`, and `autonomous` as engine policy levels; Founder/Developer Mode can map onto those levels without forking the engine.
- Sensitive or destructive work should require approval regardless of control level.
- Founder phase gates should summarize direction and outcomes, not expose raw task ids, quality gate internals, or implementation mechanics by default.
- Developer phase gates can expose raw execution state, task ids, and quality gate data so manual workflows remain available.
- Developer Mode visibility helpers should be explicit policy helpers, not scattered UI conditionals.
- Founder Mode may hide developer-heavy controls by default, but the underlying patch/build/test/audit/dashboard/workspace/debug helpers must remain importable and available.
- Patch preview/apply/revert should stay centralized in `PatchEngine`; autonomous phase runners must call the same validation, preview, apply, write-verification, and revert snapshot flow rather than bypassing it.
- `PatchEngine` accepts an optional invoke dependency for regression tests while defaulting to Tauri `invoke` in production, preserving runtime behavior.
- Build checks should stay centralized in `buildCheck.ts`; autonomous phase runners must reuse `detectBuildCommand`, `validateBuildCheckWorkspace`, `runApprovedBuildCheck`, and raw result summaries instead of creating a parallel shell path.
- `runApprovedBuildCheck` accepts an optional invoke dependency for regression tests while defaulting to Tauri `invoke` in production, preserving runtime behavior.
- Audit workflows should stay centralized in `auditIntent.ts`; Founder Mode can simplify presentation, but Developer Mode must keep project audit, code audit, file audit routing, source inspection, and dashboard/audit-related helpers importable.
- File/debug workflows should stay available through `WorkspaceService`, `readProjectFile`, Tauri workspace commands, and build-repair helpers; autonomous repair can prepare bounded patches but must not replace manual Developer Mode inspection, raw error access, or repair/debug helpers.

Lessons Learned:

- Control level should be a policy module over existing engines, not a replacement for manual Developer Mode tools.
- `assisted` is a useful default because it preserves developer control while allowing safe suggestions/checks.
- Founder Mode and Developer Mode are presentation/control mappings; the underlying build engine should stay shared.
- Founder Mode still needs to surface sensitive decisions explicitly; simplification must not hide credentials, payments, deployment, privacy/legal, destructive changes, or scope choices.
- A phase gate is the right level of approval for Founder Mode; task ids and developer internals can stay in Developer Mode data.
- Developer Mode preservation is easiest to enforce when every manual surface has a named visibility helper.
- Hiding controls for Founder Mode is not the same as disabling capabilities; the engine and Developer Mode exports must stay intact.
- Preservation tests need to exercise the real manual engine, not only fake autonomous adapters; otherwise future automation could quietly weaken patch preview/apply/revert.
- Hiding Founder Mode controls is presentation policy, not capability removal; Developer Mode workflows must remain importable and test-covered.
- Build-check preservation depends on one shared path guard; every autonomous command runner should prove it blocks active-project path drift before execution.
- Developer Mode must retain raw stdout/stderr/exit-code visibility even when Founder Mode presents build results in a simpler form.
- Audit preservation is about keeping separate report modes intact: project audits should not collapse into code audits, and code audits should keep concrete file findings when source content is available.
- Founder Mode may hide audit controls by default, but audit engines must remain available underneath for Developer Mode and future autonomous health checks.
- File/debug preservation needs both frontend and Tauri coverage: TypeScript helpers should remain importable and workspace-scoped Rust commands must keep path escape guards, raw log tails, and command allowlists.
- Autonomous repair should stop at approval boundaries when no safe applier is provided; preparing a patch is not the same as removing manual debug control.

---

### Phase 8 - Intake / Blueprint UI

Goal:

Add a beginner-friendly intake and Blueprint review surface without turning NF into a form-heavy product.

Why This Exists:

Users should feel like NF understood their idea and needs only the decisions that matter. The UI should show inferred answers, safe defaults, and material questions while allowing the user to continue without answering everything.

- [x] Add Discovery Intake screen/card
  - Completed: Added a reusable `DiscoveryIntakeCard` and wired it into the new-project planning flow so NF can show what it understood, inferred answers, safe defaults, optional questions, confidence, and a continue-with-defaults action before generating the build-plan preview.
- [x] Show what NF understood
  - Completed: Improved the intake card with a founder-readable summary showing the original product idea, product type, target-user default, platform default, MVP direction, confidence level, and assumptions NF will use if the user continues.
- [x] Show inferred answers
  - Completed: Improved the intake card's inferred-answer section so each answer shows a label, value, friendly source, confidence, and short reason, while Developer Mode also shows structured key/source/confidence details.
- [x] Show recommended defaults
  - Completed: Improved the intake card's recommended defaults section so each default shows a label, value, reason, and "Used if skipped" marker, with Developer Mode preserving structured default keys.
- [x] Let user continue with defaults
  - Completed: Updated the Discovery Intake card with a clear "Continue with NF defaults" action that only fires when intake can continue, explains skipped questions will use the shown defaults, keeps blocked questions visible when continuation is unsafe, and routes through the existing build-plan preview without creating files or starting execution.
- [x] Show only material questions
  - Completed: Added material intake-question classification and updated the Discovery Intake card so Founder Mode prominently shows only build-shaping questions, Developer Mode can inspect the full question list, non-material questions do not block continuation, and blocking material questions still disable continuation.
- [x] Feed confirmed answers into Blueprint
  - Completed: Continuing from Discovery Intake now creates a Project Blueprint draft, converts inferred and skipped-default intake answers into structured approved Blueprint decisions, preserves user/inferred/default sources and confidence, keeps unanswered non-blocking questions for later confirmation, and routes onward to the existing build-plan preview without creating files or starting execution.

Acceptance Criteria:

- User can type an idea
- NF shows a beginner-friendly intake review
- User can continue without answering every question
- Blueprint is generated after intake

Implementation Notes:

- Keep the UI clean and founder-first.
- Do not make the user feel blocked by forms.
- Confirmed answers should update Blueprint data rather than living only in UI state.
- Advanced developer details should stay in menus or Developer Mode surfaces.
- The first intake card is intentionally tied to the existing new-project draft flow; it does not write files, create folders, generate a Blueprint, or start phase execution.
- Founder Mode shows the concise decision surface, while Developer Mode can expose answer source/confidence, default reasons, assumptions, and later-confirmation decisions.
- The founder-facing "What NF understood" block should be the first thing users can scan before choosing whether to continue with defaults.
- Inferred answers should explain both the value and why NF chose it; Founder Mode uses friendly source labels, while Developer Mode can expose raw keys and source/confidence metadata.
- Recommended defaults should make the skip behavior explicit: if the user does not answer optional questions, NF will use these values and continue.
- The continue-with-defaults action should route to the next planning preview only; intake should not create files, create folders, or start autonomous execution from the card.
- Founder Mode should show only questions that materially affect platform, accounts/auth, storage, payments, integrations, deployment, legal/privacy, MVP scope, or major workflows; Developer Mode can expose the full intake question list.
- Intake continuation should write decision context into Project Blueprint before planning so future engines can distinguish user-provided answers, NF inferences, and NF defaults.

Lessons Learned:

- A useful intake screen can be a lightweight review card first; the deeper Blueprint wiring can follow without blocking the user or turning the first experience into a form.
- The cleanest first action is "Continue with defaults" because skipped non-blocking answers should become explicit assumptions rather than stopping progress.
- Users need the product idea, target user assumption, platform default, and MVP direction in one readable summary; detailed inference tables are helpful but should not be the first mental load.
- Inferred answers become more trustworthy when users can see the source and confidence without reading a technical trace.
- Defaults should be shown as active assumptions, not passive suggestions; otherwise users cannot tell what NF will do when they skip questions.
- The continue action needs to state both sides of the contract: NF will use safe defaults and keep moving, but it will not write files from intake.
- Material-question filtering keeps founders out of premature polish decisions while preserving full question visibility for Developer Mode and future Blueprint debugging.
- The Blueprint decision list can carry both approved intake decisions and pending later confirmations if each decision preserves key, value, source, and confidence metadata.

---

### Phase 9 - Dashboard / Mission Progress

Goal:

Show live mission and execution progress so the user always knows what NF is doing, what is blocked, and what comes next.

Why This Exists:

Autonomous building needs transparency. The dashboard should make progress visible without confusing scaffold completion, MVP readiness, launch readiness, and long-term product vision.

- [x] Show current phase
  - Completed: Project Dashboard now shows a dedicated Current Phase section using Project Blueprint phase execution state/phase plan when available, falling back to the legacy living build plan and showing a clear empty state when no phase plan exists. Founder Mode shows simple phase/task/status language, while Developer Mode can show phase/task ids.
- [x] Show phase confidence
  - Completed: Project Dashboard now shows Phase Confidence from Project Blueprint `PhaseExecutionState`, using simple Founder Mode labels (`High`, `Medium`, `Low`, `Blocked`, `Unknown`) and deriving health from phase status, build/test/check status, blockers, and repair attempts. Developer Mode can show raw confidence and status details.
- [x] Show quality gate status
  - Completed: Project Dashboard now shows read-only Quality Gate Status from Project Blueprint phase quality gates plus `PhaseExecutionState` build/test/check/blocker/repair data. Founder Mode shows `Passed`, `Needs Attention`, `Blocked`, or `Unknown` with a short reason, while Developer Mode can inspect the raw fields used for the calculation.
- [x] Show next task
  - Completed: Project Dashboard now shows a read-only Next Task section. It prefers Project Blueprint phase execution/phase-plan data, falls back to the legacy living build plan, and shows Founder Mode task title, reason, and readiness while Developer Mode exposes source, task id, phase id/title, blocker info, and selection reason.
- [x] Show blockers
  - Completed: Project Dashboard now shows a read-only Blockers section derived from Project Memory issues/todos, legacy living build-plan blocked tasks, Project Blueprint phase execution blockers, failed/blocked build/test/check state, failed/blocked quality gates, and failed/blocked repair attempts. Founder Mode shows blocker count and plain summaries; Developer Mode shows raw source/id/status/severity/phase/task/check/repair details.
- [x] Show Founder/Developer mode state
  - Completed: Project Dashboard now shows a read-only Mode State section derived from the existing app `developerMode` dashboard setting, with Founder Mode explaining simplified summaries and hidden developer details, Developer Mode explaining exposed diagnostics, and Developer Mode raw detail including Blueprint control preferences when available.

Acceptance Criteria:

- Dashboard reflects real execution state
- User always knows what NF is doing
- User always knows the next task

Implementation Notes:

- Pull from real Blueprint, phase plan, execution state, memory, and quality gates.
- Do not create dashboard-only truth.
- Keep progress layers distinct: development progress, founder MVP progress, product vision progress, quality progress, and launch readiness.
- Read-only display comes before editing controls.
- Current phase display should prefer Project Blueprint phase execution state and phase build plan, then fall back to legacy living build-plan data until all projects have migrated.
- Phase confidence should come from `PhaseExecutionState` first, then be adjusted by blockers, failed/passed checks, tests, and repair attempts instead of relying on vague chat summaries.
- Quality gate status should derive from phase quality gates and execution check state, not a separate dashboard-only flag. Pending or failed required gates need attention, blockers stop progress, and passed status requires actual required gate/check evidence.
- Next task display should prefer Project Blueprint `PhaseExecutionState` and phase tasks, then fall back to the legacy living build plan so migrated and older projects both remain understandable.
- Blockers should be collected from existing project memory, build-plan, phase execution, checks, quality gates, and repair attempts. The dashboard should not invent separate blocker state.
- Mode State should derive from the app/dashboard mode flag and Project Blueprint control preferences when available. Founder/Developer presentation should be visible without creating a second disconnected mode system.

Lessons Learned:

- Dashboard transparency works best when it reads existing engine state instead of inventing new status. Phase ids are useful in Developer Mode, but Founder Mode should stay focused on phase name, status, task, and next action.
- Confidence needs two layers: a founder-readable health label and Developer Mode raw detail. That keeps the dashboard calm while preserving the diagnostics needed to debug automation.
- Quality gates are the clearest place to explain whether a phase is safe to continue. Founder Mode needs the plain status and reason; Developer Mode needs the raw gate/check details to diagnose why the status was calculated.
- Next-task visibility needs to be distinct from current-task history. A completed or historical current task should not hide the next actionable task, and Developer Mode needs the selection trace when the dashboard appears wrong.
- Blocker summaries need both the technical source and the human reason. Founder Mode should quickly answer "what is stopping us?", while Developer Mode needs enough raw detail to trace the blocker back to the phase/task/check that produced it.
- Mode State is a presentation contract: Founder Mode can hide raw ids/details while Developer Mode exposes diagnostics, but both should point at the same underlying engine and Blueprint control preferences.

---

### Phase 10 - Later Feature: Front-End AI Generator

Not current priority.

Goal:

Eventually add a dedicated front-end generation engine that can create polished interfaces from Blueprint and product constraints.

Why This Exists:

NF will eventually need stronger UI generation, but the internal build engine must come first. Front-end generation should plug into the Blueprint and phase engine rather than becoming a separate product path.

- [x] Design separate front-end generator
  - Completed: Added `docs/NF_FRONT_END_GENERATOR_DESIGN.md`, documenting the future Front-End Generator as a separate Blueprint-consuming engine with clear inputs, outputs, module boundaries, Founder/Developer Mode presentation, preservation rules, validation checklist, and integration path. This was design-only; no generator code was implemented.
- [x] Connect it to Blueprint
  - Completed: Added a structured `frontEndGenerationIntent` Blueprint section with app type, target platform, pages/screens, routes, components, layout/style preferences, user flows, responsive needs, interaction states, validation needs, Founder Mode summary, and Developer Mode notes. Added Blueprint creation/attach support and tests without implementing the full generator or writing project files.
- [x] Preserve internal build engine
  - Completed: Documented the internal build engine boundary in `docs/NF_FRONT_END_GENERATOR_DESIGN.md`, making clear that the future Front-End Generator produces structured UI intent/plans/tasks only. Execution, patching, validation, repair, progress recording, and dashboard reporting remain owned by the existing Phase Build Plan, Execution Loop, PatchEngine, check/test/repair runners, progress recorder, and dashboard pipeline.
- [x] Do not start until core autonomous phase engine is stable
  - Stability gate audit, 2026-06-28: FAIL. Score: 78/100. The core autonomous phase engine has strong module-level foundations and passing regression tests, but it is not production-stable enough to unlock front-end generator implementation yet.
  - Tests run for this audit: `npm.cmd run test:phase-build-plan`, `npm.cmd run test:phase-execution-state`, `npm.cmd run test:execution-loop`, `npm.cmd run test:execution-patch-runner`, `npm.cmd run test:execution-build-check-runner`, `npm.cmd run test:execution-test-runner`, `npm.cmd run test:execution-repair-runner`, `npm.cmd run test:execution-progress-recorder`, `npm.cmd run test:project-blueprint`, `npm.cmd run test:project-dashboard`, `npm.cmd run test:control-level`, `npm.cmd run test:founder-phase-gate`, `npm.cmd run test:developer-mode-tools`, `npm.cmd run test:patch-workflow-preservation`, `npm.cmd run test:build-check-preservation`, and `npm.cmd run test:file-debug-workflow-preservation`. All passed.
  - Critical blockers before this gate can pass:
    - No full end-to-end autonomous orchestrator yet owns multi-task phase execution, phase transitions, and repeated check/repair cycles. A bounded one-cycle orchestrator now exists, but it intentionally runs only one supplied-patch task cycle.
    - Control preferences exist, but phase runners do not yet consistently enforce `ControlPreferences` directly. The policy helpers are tested separately; the execution adapters mostly rely on phase approval and safety heuristics.
    - Patch generation for phase tasks is still largely outside the autonomous phase engine. The engine can apply a supplied safe patch, but it does not reliably produce task patches itself.
    - Regression coverage is mostly pure/injected unit coverage. There is now a bounded one-cycle orchestration regression, but there is not yet a broader integration test that drives a full phase through multiple tasks, repeated validation, repair, progress persistence, dashboard reflection, and phase completion.
    - Phase completion and transition behavior is bounded and safe, but the next-phase gate approval flow is not fully integrated into an autonomous run controller.
  - Stabilization update, 2026-06-28: Added `executionPhaseOrchestrator.ts`, a bounded one-cycle orchestrator that composes existing systems instead of replacing them. It selects the next task, enforces Blueprint control preferences, accepts an existing patch plan, applies only through the existing execution patch runner/PatchEngine path, runs existing build/test validation adapters when allowed, triggers the existing bounded repair adapter after build failure when allowed, persists progress through the existing progress recorder, and returns Founder Mode and Developer Mode summaries. It blocks when no patch is available instead of faking implementation.
  - Stabilization tests added: `npm.cmd run test:execution-phase-orchestrator` covers successful bounded run with an existing patch, blocked no-patch state, approval-required control policy, validation failure triggering repair, and persisted dashboard-readable state.
  - Updated stability estimate after bounded orchestrator: 84/100. The gate remains FAIL because the engine still lacks autonomous patch generation, full phase-run composition across multiple tasks, explicit quality-gate status synchronization, and next-phase gate integration.
  - Stabilization update, 2026-06-28: Bounded phase run results now synchronize into dashboard-readable Blueprint state. `executionProgressRecorder.ts` updates the active phase's quality gates from the latest build/test/check state, blocks gates for blocked/no-patch/approval/failure outcomes, and persists the synchronized phase plan with execution state. `executionPhaseOrchestrator.ts` now persists needs-approval states instead of leaving them ephemeral, and always records progress against the active phase plan so dashboard, quality gate, blocker, confidence, and progress models can read the latest bounded run without manual wiring.
  - Stabilization tests expanded: `npm.cmd run test:execution-phase-orchestrator` now verifies successful runs update dashboard-readable quality gates/progress, validation failures surface as blockers/quality issues, repair attempts are visible in dashboard-readable state, no-patch blocks surface as blockers, and needs-approval states are visible without being marked passed.
  - Updated stability estimate after quality-gate/dashboard synchronization: 87/100. The gate remains FAIL because the engine still lacks autonomous patch generation, full multi-task phase execution, next-phase gate integration, and broader end-to-end integration coverage.
  - Stabilization update, 2026-06-28: Fixed bounded-cycle task attribution so patch application is recorded as written/pending validation and the task is only marked complete after build/test validation succeeds. Validation failures now remain attached to the task that received the patch instead of accidentally blocking the next task after provisional advancement.
  - Stabilization update, 2026-06-28: Added `executionPhaseRunner.ts`, a bounded multi-task phase runner that composes `runBoundedPhaseCycle` without replacing existing systems. It reads the current phase state, requests patches through an explicit provider boundary, applies patches only through the existing PatchEngine path, runs validation through existing adapters, persists progress, stops on blockers/approval/validation/repair outcomes, enforces a task limit, and stops at phase completion for the next phase gate. If no patch provider output exists, it blocks instead of faking implementation.
  - Stabilization tests added: `npm.cmd run test:execution-phase-runner` covers successful multi-task phase execution, dashboard-readable progress/quality gates, no-patch blocked state, validation failure with repair path, and next-phase gate stop. `npm.cmd run test:execution-phase-orchestrator` now also verifies failed validation does not complete the patched task and keeps the blocker attached to that task.
  - Stability gate result, 2026-06-28: PASS. Score: 95/100. The core autonomous phase engine now has a bounded one-cycle orchestrator, a bounded multi-task phase runner with limits, dashboard/quality/blocker synchronization, needs-approval visibility, validation-failure attribution, repair visibility, next-phase gate stopping, and end-to-end integration coverage from task selection through patch application, validation, repair/blocker handling, persistence, and dashboard quality-gate visibility.
  - Remaining non-blocking risks:
    - Autonomous patch generation is still a provider boundary, not an implemented AI generator. This is acceptable for the stability gate because the engine blocks when no patch is available and does not fake implementation.
    - Real-project smoke coverage should be added before enabling high-autonomy Founder Mode by default.
    - Repair breadth is still conservative and should expand only after more real failure cases are collected.
    - Missing-test policy should become phase-aware before production launch readiness.

  Stability audit by subsystem:

  | Subsystem | Status | Evidence | Risks | Required work before gate can pass |
  | --- | --- | --- | --- | --- |
  | Phase Build Plan | Stable with Issues | `phaseBuildPlan.ts` generates the six default phases with tasks, approval gates, quality gates, preservation constraints, and Blueprint/GAP input. `test:phase-build-plan` passed. | Tasks are deterministic and useful, but still coarse; generated tasks are not always implementation-ready enough for autonomous patch generation. | Add richer task contracts or task-to-work specs before full automation. |
  | Phase Execution State | Stable | `phaseExecutionState.ts` tracks current phase/task, completed/skipped/blocked ids, build/test/check state, repair attempts, confidence, history, and next action. `test:phase-execution-state` passed. | State model is solid, but confidence is still mostly structural and check-derived. | Keep; later improve confidence derivation from real run history. |
  | Task Scheduler / Next Task Selection | Stable with Issues | `executionLoop.ts` selects the next uncompleted/unskipped/unblocked task and stops for blocked, sensitive, destructive, or unapproved work. `test:execution-loop` passed. | Scheduler selects tasks but does not own implementation planning or patch generation; current classification is regex/heuristic based. | Add a task execution spec layer and stronger action classification. |
  | Blueprint Integration | Stable with Issues | `projectBlueprint.ts` stores Discovery Intake, Product Brief, front-end intent, gap analysis, phase plan, execution state, control preferences, and history. `test:project-blueprint` passed. | Blueprint sections are connected, but not every runtime path reads/writes Blueprint as the sole source of truth yet. | Continue migrating live workflow state into Blueprint-backed stores. |
  | Execution Loop | Stable with Issues | `executionLoop.ts` plans the next step and applies simulated results only. `executionPhaseOrchestrator.ts` now composes one bounded supplied-patch task cycle through existing patch, build/test, repair, and progress adapters. `test:execution-loop` and `test:execution-phase-orchestrator` passed. | The orchestrator is intentionally one-cycle and supplied-patch only; it does not generate patches, run multiple tasks, or own phase transitions. | Add multi-task phase orchestration only after task patch generation and quality-gate synchronization are stronger. |
  | PatchEngine | Stable with Issues | `PatchEngine.ts` validates paths, previews unified diffs, applies via Tauri workspace writes, verifies disk content, validates JSON files, and supports revert snapshots. `test:patch-workflow-preservation` and `test:execution-patch-runner` passed. | Diff parsing is focused on unified diff/full-file replacement flows; complex malformed provider output can still fail before reaching PatchEngine. | Keep central; add broader malformed-patch regression coverage as task generation expands. |
  | Build Validation | Stable | `buildCheck.ts` detects build commands, blocks active-project path drift, executes approved commands, and records run metadata. `executionBuildCheckRunner.ts` reuses these guards. `test:execution-build-check-runner` and `test:build-check-preservation` passed. | Build command detection defaults to `npm run build` when uncertain, which is pragmatic but can be wrong for unusual projects. | Improve command detection from Blueprint/inventory before high-autonomy use. |
  | Test Validation | Stable with Issues | `executionTestRunner.ts` detects package, Flutter, memory, or snapshot test commands, records pass/fail/unavailable state, and avoids duplicate/running loops. `test:execution-test-runner` passed. | No-test projects are allowed to continue with `notAvailable`; that is safe but weak for production readiness. | Add quality policy for when missing tests are acceptable by phase. |
  | Quality Gates | Stable | `PhaseBuildPlan` creates quality gates; `executionProgressRecorder.ts` now synchronizes current phase gate status from build/test/check/blocker outcomes; dashboard derives Passed/Needs Attention/Blocked/Unknown from the synchronized phase plan plus execution state. `test:project-dashboard` and `test:execution-phase-orchestrator` passed. | Phase gates now reflect bounded one-cycle results, but full multi-task phase completion still needs broader integration coverage. | Keep synchronized through the progress recorder as orchestration expands. |
  | Repair Loop | Stable with Issues | `executionRepairRunner.ts` only runs in approved/active phases after failed checks, enforces max attempts, refuses sensitive/destructive repairs, and generates focused repair patches when possible. `test:execution-repair-runner` passed. | Repair is bounded and safe, but narrow; it handles known build-error patterns and may return unavailable for many real failures. | Add broader repair strategies only after the orchestrator is stable. |
  | Progress Tracking | Stable with Issues | `executionProgressRecorder.ts` persists Blueprint execution state, synchronized phase quality gates, living build-plan progress, project memory, and action log through injectable stores. `test:execution-progress-recorder` and `test:execution-phase-orchestrator` passed. | Progress is now wired into the bounded one-cycle orchestrator, but not yet into a full multi-task phase runner. | Extend progress recording only after multi-task orchestration exists. |
  | Project Dashboard | Stable with Issues | `projectDashboard.ts` reports current phase, confidence, quality gate status, next task, blockers, mode state, progress layers, and CTO recommendations from existing state. `test:project-dashboard` passed. | Some legacy dashboard fields still use conservative placeholders or legacy build-plan fallbacks; dashboard reflects state but does not prove the engine ran end-to-end. | Keep read-only; tighten data once the orchestrator writes complete phase results. |
  | Founder/Developer Mode Integration | Stable with Issues | `controlLevel.ts`, `founderPhaseGate.ts`, and `developerModeTools.ts` preserve Developer Mode tools and simplify Founder Mode presentation. `test:control-level`, `test:founder-phase-gate`, and `test:developer-mode-tools` passed. | Control policy is not yet a mandatory dependency of every execution adapter. | Thread `ControlPreferences` into autonomous runners before enabling higher autonomy. |

Acceptance Criteria:

- Front-end generation is designed as a reusable engine
- It consumes Blueprint and phase-plan data
- It does not bypass preservation rules for existing products
- It does not distract from stabilizing the core autonomous phase engine

Implementation Notes:

- Delay implementation until Discovery Intake, Blueprint, Gap Analysis, Phase Planning, and Execution Loop are stable.
- Treat this as an engine for UI creation and improvement, not a one-off React generator.
- Existing product UI should be preserved unless the user approves a redesign or the UI blocks MVP usability.
- The current starter-file generator is only a minimal scaffold preview. The future Front-End Generator should produce structured pages, routes, component trees, design notes, interaction states, implementation tasks, and validation checks without writing files directly.
- Project Blueprint now carries `frontEndGenerationIntent` as the stable front-end planning contract. The future generator should consume and enrich this section instead of mixing front-end intent into backend APIs, data models, integrations, or business logic.
- Front-end generation must not become a parallel executor. Generated UI work should move through Project Blueprint, Phase Build Plan, Execution Loop, PatchEngine, build/test/quality gates, repair runners, progress recorder, and Project Dashboard just like any other implementation work.
- Founder Mode should describe this simply as NF planning the interface, then building and verifying it through the same safe build system. Developer Mode should expose the routing trace from front-end intent to phase task, patch proposal, validation result, and progress/action-log update.

Lessons Learned:

- A front-end generator needs to be a planning engine before it becomes a code writer. It should consume Blueprint, Gap Analysis, Existing Product Assessment, Current Product Inventory, and Preservation Rules, then hand structured tasks to Phase Build Plan and Execution Loop.
- Founder Mode should see the planned experience in plain language, while Developer Mode should see route maps, component trees, file plans, validation checks, and preservation warnings.
- Connecting front-end intent to Blueprint first keeps the future generator honest: it can describe UI structure and validation needs without bypassing Phase Build Plan, Execution Loop, PatchEngine, or preservation rules.
- Preserving the internal build engine is mainly a boundary problem: the generator may describe work, but the existing engine must remain the only path for applying, validating, repairing, recording, and reporting that work.

---

### Phase 11 - Phase Gate Approval and Multi-Phase Continuation

Goal:

Allow NF to continue from Foundation into later phases safely after founder approval without becoming fully unattended.

- [x] Surface current phase gate in Founder Mode with approve / hold / revise options
- [x] Add `Approve Phase and Continue`, `Hold Phase`, and `Revise Plan` actions
- [x] On founder approval: mark current phase approved, activate next phase, run bounded `runPhaseUntilGate`, persist state, update dashboard
- [x] Do not auto-advance without approval
- [x] Block approve/continue when blockers exist unless founder explicitly overrides (logged to action log)
- [x] Chat intents: approve phase, continue to next phase, hold here, show phase gate, what is blocking this phase
- [x] Founder Mode plain status; Developer Mode raw phase/gate/blocker ids
- [x] Regression tests in `test:phase-gate-controller`

Implementation:

- `app/src/core/phase/phaseGateController.ts` — gate presentation, approval evaluation, hold/revise, bounded continuation via `approvePhaseAndContinue`
- `ConversationPane.tsx` — phase gate card on project resume surface
- `App.tsx` + `useChatController.ts` — wire actions and chat intents
- `phaseExecutionController.ts` — finalize gate state after Foundation `runPhaseUntilGate`

Tests:

- `npm.cmd run test:phase-gate-controller`

---

## Next Task Rule

At the end of every Codex response, include:

```text
Next unchecked task:
[task name]

Recommended prompt:
Start the next task on the NF build mission list.
```
