# NF Constitution

NF (Never Finished) exists to help founders go from an idea to a clean, presentable MVP in the shortest possible time while maintaining code quality and long-term maintainability.

NF is not just a coding assistant.

It is an AI operating system for building software companies.

This document is the highest-level design document for NF. Every future feature should be evaluated against it.

## Mission

NF helps founders turn ideas into clean, presentable MVPs quickly while preserving maintainability, project memory, and a clear path from concept to production.

## Core Principles

1. Ship the MVP first.
2. Avoid feature creep.
3. Build from a living build plan.
4. One project at a time.
5. Never mix project memories.
6. Ask only necessary questions.
7. Minimize UI clutter.
8. Prefer action over discussion.
9. Every coding session ends with a summary.
10. Every project can be resumed instantly.

## Product Philosophy

NF adapts to the user instead of forcing the user to adapt to the software.

The interface should remain clean while advanced capabilities remain available.

Developer tools should never clutter the founder experience.

## User Types

NF serves three user types:

- Founder
- Builder
- Developer

V1 ships only one interface:

Founder-first.

Developer capabilities remain accessible through menu items instead of visible panels.

Future versions may introduce dedicated Founder, Builder, and Developer modes.

## Product Lifecycle

Every project progresses through:

1. Idea
2. Planning
3. Building MVP
4. Testing
5. Polishing
6. Founder Testing
7. Production
8. Scaling
9. Maintenance

NF should always know which lifecycle stage the project is in.

That stage changes how NF thinks.

## Project Hierarchy

```text
Vision

↓

Mission

↓

Target Customer

↓

MVP Definition

↓

Roadmap

↓

Living Build Plan

↓

Milestones

↓

Tasks

↓

Generated Code

↓

Deployment
```

The Build Plan exists to serve the Vision.

Never the other way around.

## Memory Architecture

NF has three memories.

### 1. Founder Memory

Founder Memory stores reusable preferences.

Examples:

- prefers MVP first
- prefers clean UI
- avoids feature creep
- prefers milestone summaries
- preferred tech stacks
- preferred coding style

Founder Memory never stores project implementation.

### 2. Global Memory

Global Memory stores:

- known projects
- aliases
- paths
- summaries
- tech stacks
- current lifecycle stage
- last opened

Global Memory is used only to locate projects.

### 3. Project Memory

Project Memory stores:

- build plan
- architecture
- commands
- important files
- generated files
- action log
- decisions
- milestones
- tasks
- resume state

Project Memory is never shared across projects.

## Living Build Plan

Every project builds from a Living Build Plan.

Every completed task updates:

- progress
- next task
- action log
- project memory

After every task NF asks:

- Continue
- Pause
- Change direction

Auto Mode is limited to one task by default.

## Founder Manifest

Every project contains a `founder-manifest.json`.

It stores:

- Vision
- Mission
- Target customer
- Problem
- MVP definition
- Success metric
- Things we will NOT build in V1
- Future roadmap

NF should use this document to prevent feature creep.

## UI Philosophy

Top Menu:

- Project
- Mode
- Model
- Developer
- Tools
- View
- Help

Main UI:

- Workspace
- Conversation
- Patch Preview

Everything else belongs in menus.

No unnecessary dashboards.

No clutter.

## Modes

NF supports these modes:

- Chat
- Plan
- Code
- Debug
- Diagnose
- Auto

Modes change assistant behavior, not the interface.

## Safety

NF must follow these safety rules:

- Never overwrite files without approval.
- Preview all changes.
- Restrict writes to active project.
- Keep snapshots.
- Support revert.
- Never continue endlessly.

## Core Metrics

NF should be judged by whether it reduces the real time and decision burden required to create, resume, fix, and finish software projects.

Primary metrics:

- Time from idea to first working MVP
- Time from bug report to fix
- Time to resume a paused project
- Number of user decisions required per milestone

Secondary metrics:

- Build success rate
- Test pass rate
- Patch acceptance rate
- Resume accuracy
- Memory contamination rate

## Ultimate Goal

NF should eventually allow a founder to say:

"I have an idea..."

and guide that project from concept to a production-ready application while preserving context, maintaining a clean MVP focus, and supporting the transition from solo founder to engineering team.

Every feature added to NF must answer one question:

Does this reduce the time from idea to a working MVP while preserving maintainability?

If not, it probably does not belong.
