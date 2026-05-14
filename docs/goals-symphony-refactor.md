# Goals Symphony Refactor Plan

## Intent

Refactor Helmor Goals toward the OpenAI Symphony orchestration model: work items become the source of truth, each eligible item gets an isolated workspace and managed agent run, and humans manage work state instead of supervising individual coding sessions.

## Current Helmor Baseline

- Goal workspaces are special `workspaces` rows with `workspace_kind = 'goal'`.
- Goal cards are lightweight Kanban records in `goal_cards`.
- Child execution happens by creating code workspaces linked back to a goal, then enqueueing a background agent send.
- The Goals UI owns most workflow intent through manual card/workspace creation, fixed lanes, and Pi messages.

## Target Architecture

Introduce `goal_orchestrator` as the Symphony-compatible backend boundary:

- `workflow`: load `WORKFLOW.md`, parse YAML front matter, and expose the prompt body.
- `config`: coerce workflow front matter into typed runtime settings with documented defaults.
- `types`: normalized issue, workspace, run attempt, retry, live-session, and runtime-state data models.
- `tracker`: adapters that normalize external/local work sources into issues.
- `scheduler`: owns polling, claims, concurrency, retries, and reconciliation.
- `workspace_manager`: maps issues to deterministic workspace directories and runs lifecycle hooks.
- `runner`: launches or delegates agent runs using Helmor's existing agent infrastructure first, with a path to Codex app-server later.
- `telemetry`: structured status events and UI-facing run state.

## Phase 1: Workflow Contract Foundation

- Add Symphony domain types independent of current Goals behavior.
- Add `WORKFLOW.md` loader with optional YAML front matter support.
- Add typed config resolution for tracker, polling, workspace, hooks, agent, and codex fields.
- Validate startup/dispatch-critical fields without starting any scheduler.
- Add unit tests for parsing, defaults, path/env resolution, and validation errors.

## Phase 2: Local Goal Tracker Adapter

- Treat existing `goal_cards` plus linked child workspaces as a local issue tracker.
- Normalize cards into issues using stable IDs, identifiers, titles, descriptions, state, labels, and blockers.
- Keep existing UI and IPC commands working while adding orchestrator read paths.

## Phase 3: Scheduler Runtime

- Add a single authoritative in-memory orchestrator state with `running`, `claimed`, retry entries, completed bookkeeping, and token/rate snapshots.
- Implement tick ordering: reconcile, validate, fetch candidates, sort, dispatch, publish status.
- Enforce global and per-state concurrency.
- Add retry/backoff behavior and stale-run release.

## Phase 4: Workspace Manager

- Move goal-child workspace preparation behind a Symphony-style workspace manager.
- Enforce deterministic sanitized workspace keys and path containment.
- Add lifecycle hook execution: `after_create`, `before_run`, `after_run`, and `before_remove`.
- Preserve existing Helmor branch/worktree semantics during migration.

## Phase 5: Status Surface and UI Sync

- Add typed `UiMutationEvent` variants for orchestrator state updates.
- Update Goals UI to render run state, retry state, and workflow/config errors.
- Keep Pi as a supervisor/status panel, but make orchestrator state authoritative.

## Phase 6: External Tracker Adapters

- Add Linear adapter first if Symphony compatibility is the priority.
- Add GitHub Issues/Jira adapters only after the tracker trait and scheduler are stable.
- Keep tracker writes in agent/tooling policy rather than hardcoding business transitions in the orchestrator.
