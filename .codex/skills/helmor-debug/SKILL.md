---
name: helmor-debug
description: Use Helmor's evidence-first debug workflow from Codex or Claude without requiring Helmor to already be open. Use when debugging Helmor app behavior, Tauri webview UI, IPC, streaming, sidecar agents, Debug ingest probes, logs, tests, regressions, or when the user asks for Helmor debug mode.
---

# Helmor Debug

Use this skill to debug Helmor repo and app issues from an agent session. Do not assume the desktop app is already running; start it only when live Tauri UI or backend state is needed.

## Core Workflow

1. Work from the Helmor repo root and preserve unrelated working tree changes.
2. Start from evidence: reproduce the issue or inspect available logs, stack traces, test output, console output, IPC traces, or local app logs before editing when feasible.
3. State a concrete hypothesis before changing code, then choose the smallest check that can falsify it.
4. Make the smallest fix that explains the evidence.
5. Rerun the relevant check and remove temporary probes before finishing.
6. Keep the visible reply concise: observed failure, fix, verification, and any remaining risk.

## App Startup

Do not ask the user to open Helmor just to begin debugging.

- For pure code, typecheck, or unit-test failures, debug from the terminal first and do not launch the app.
- For live UI, IPC, Debug ingest, or runtime state, start a debug build yourself:

```bash
bun run dev
```

Use preview mode when another Helmor dev app is already running or this checkout is a secondary worktree:

```bash
bun run dev:preview
```

Read the command output. `dev:preview` prints the isolated data directory, Vite URL, and MCP bridge port range. Use those values for subsequent MCP work.

Use `bun run dev:analyze` only for rendering or performance investigations that need the perf HUD.

## Tauri MCP

Use the Tauri MCP bridge only for Helmor UI debugging. Do not use Chrome DevTools, browser automation, or `/agent-browser` for the desktop app.

- Release builds do not include the bridge. Use `bun run dev` or `bun run dev:preview`.
- Open the driver session first with `driver_session action=status`, then start it if needed.
- Default MCP port is `9223`, window `main`.
- For preview mode, use the MCP base port printed by `bun run dev:preview`.
- After connecting, call `ipc_get_backend_state` to confirm the expected Helmor instance.
- Prefer `webview_screenshot` followed by `webview_dom_snapshot type=accessibility` for UI state.
- Use `webview_interact` and `webview_keyboard` for input. Do not dispatch synthetic events through JS for user flows.
- For IPC issues, run `ipc_monitor start`, trigger the flow, read captured calls with `ipc_get_captured`, then stop the monitor.
- Read app logs with `read_logs source=console` or `read_logs source=system filter=helmor`.

If the MCP tools are not available in the current agent runtime, continue with terminal evidence, tests, logs, and code inspection. Do not block on Helmor already being open.

## Evidence Without The App

Use these sources before launching a window unless the bug is clearly runtime-only:

- Exact code search with `rg`; semantic search with CocoIndex when available.
- Frontend tests: `bun run test:frontend` or a single `bun x vitest run <file>`.
- Sidecar tests: `cd sidecar && bun test` or a single test file.
- Rust tests: `cd src-tauri && cargo test`, or targeted integration tests.
- Typecheck: `bun run typecheck`.
- Lint-sensitive Rust changes: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`.
- Dev logs under `~/helmor-dev/logs/`, or `$HELMOR_DATA_DIR/logs/` when that env var is set.

## Debug Ingest

Use Debug ingest only when runtime ordering, browser state, or app behavior needs telemetry from a reproduced flow.

- If the prompt already includes a Debug ingest endpoint, use that endpoint.
- If no endpoint exists, do not require Helmor to be open. Debug from tests/logs first, then start `bun run dev` or `bun run dev:preview` only if live telemetry is necessary.
- Treat the endpoint as a receiver for probe output, not a place to post your own analysis.
- Clear stale entries with `DELETE <ingest-url>` before a fresh reproduction when appropriate.
- Add focused temporary probes exactly where the hypothesis predicts signal.
- Give the user concrete reproduction steps and stop. On their follow-up, `GET <ingest-url>`, compare the evidence to the hypothesis, fix the issue, and remove probes.

Frontend probe pattern:

```ts
import { postDebugEvidence } from "@/lib/debug-evidence";

const DEBUG_INGEST_URL = "<provided-ingest-url>";

postDebugEvidence(DEBUG_INGEST_URL, {
	level: "info",
	source: "component-or-hook",
	message: "flow checkpoint",
	details: { step, elapsedMs, state },
});
```

Useful probes can cover component mount ordering, async initialization, console errors, unhandled rejections, IPC start/end/failure, state transitions, layout measurements, resize events, streaming chunks, sidecar request IDs, and user-flow checkpoints.

Never include secrets, tokens, prompt contents, full env dumps, or large payloads in probe data.
