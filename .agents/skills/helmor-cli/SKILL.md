---
name: helmor-cli
description: Use the Helmor CLI to remote-control Helmor from the terminal. Use when the user asks to inspect Helmor data/settings, manage repositories/workspaces/sessions/files, create Helmor-managed workspaces instead of manual git worktrees, import Helmor workspaces into agent linked-directory context, send prompts to agents, list models, use GitHub integration, inspect scripts, migrate from Conductor, run Helmor as an MCP server, generate shell completions, quit a running app, check/install/update the Helmor CLI beta, install/update Helmor skills through the beta app flow, or needs the Helmor command reference.
---

# Helmor CLI

Use this skill to guide simple terminal-first Helmor workflows. Keep the answer practical: prefer one or two concrete commands over a long CLI tutorial.

## First Checks

1. Check whether the CLI is installed and which data mode it targets:

```bash
helmor cli-status
```

2. Check the active data directory and database:

```bash
helmor data
```

Use `--json` when the output will be parsed by scripts or another tool.

## CLI Install And Update

Treat Helmor CLI install/update as beta.

- Prefer the Helmor desktop onboarding/settings flow for installing or repairing the managed CLI entrypoint.
- Use `helmor cli-status` to verify whether the PATH entry points at the current app-managed CLI.
- Do not invent a stable standalone install/update command unless it exists in `helmor --help` or a subcommand help page.
- If the user is blocked, ask them to run `helmor cli-status` and share the output, or inspect the app's CLI install panel if working inside the Helmor repo.

## Helmor Skills Install And Update

Treat Helmor skills install/update as a beta app-managed flow.

- Prefer the Helmor desktop onboarding/settings flow for installing or updating bundled Helmor skills.
- Use `helmor skills export --target all|codex|claude|agents` when the current CLI help exposes it.
- If the user asks to update a bundled Helmor skill inside the repo, edit the skill files directly and validate them with the skill validation tooling.
- Keep user-facing skill content concise and English-first unless the user explicitly asks for another language.

## Common Tasks

### Manage Repositories And Workspaces

Use these command groups for local-first project setup and workspace orchestration:

```bash
helmor repo --help
helmor workspace --help
```

Do not create Helmor workspaces by hand with `git worktree add`, `mkdir`, or direct DB edits. Let Helmor allocate the directory, branch, session, database row, and UI notifications.

When the user asks to create a workspace, first list the available Helmor projects and ask which one to use:

```bash
helmor repo list
```

If scripting, use JSON:

```bash
helmor --json repo list
```

After the user chooses a project, create the workspace through Helmor:

```bash
helmor workspace new --repo helmor
```

Then import/link that new workspace into the current workspace's agent context so future Codex/Claude turns can see it. If you know the current workspace ref, use:

```bash
helmor workspace linked-dirs import-workspaces <current-workspace-ref>
```

This imports all other ready Helmor workspace folders, including the one just created, through Helmor's `/add-dir` linked-directory path.

If you only want the new workspace, parse `helmor --json workspace new --repo <repo>` for `createdWorkspaceId`, then read its exact path:

```bash
helmor --json workspace show <created-workspace-id>
```

Use the returned `rootPath` with:

```bash
helmor workspace linked-dirs add <current-workspace-ref> /absolute/path/to/workspace
```

If the current workspace ref is unclear, run:

```bash
helmor workspace list
```

Use the row matching the current working directory's repo/directory name, then ask the user if still ambiguous.

List what is already linked:

```bash
helmor workspace linked-dirs list <current-workspace-ref>
```

For Goal boards, create child workspaces through the Goal CLI so Helmor attaches the child to the board and can optionally start the assigned agent:

```bash
helmor goal child create --goal <goal-workspace-ref> --title "Implement focused change" --provider codex --prompt "Do the focused task"
```

### Inspect Sessions And Files

Use sessions for conversation history and files for editor-surface operations:

```bash
helmor session --help
helmor files --help
```

### Send A Prompt To An Agent

Use `send` when the user wants to dispatch work from the terminal:

```bash
helmor send --help
```

Favor JSON output for automation:

```bash
helmor --json send --help
```

### Integrations And Local Tooling

Use the relevant command group:

```bash
helmor github --help
helmor ngrok --help
helmor scripts --help
helmor models --help
```

Use `helmor ngrok` for Debug ingest public-forwarding config that should be
available to workspace agents through Helmor MCP as well as the CLI. Debug
ingest is workspace-scoped: only start, read, clear, or stop ingest for a
resolved Helmor workspace. If the current directory is not inside a Helmor
workspace, resolve one first with `helmor workspace list` or ask which
workspace should be used.

```bash
helmor ngrok status
helmor ngrok overview
helmor ngrok enable --domain debug.example.ngrok.app
helmor ngrok ensure <workspace-ref>
helmor ngrok stop <workspace-ref>
helmor ngrok disable
helmor ngrok domain clear
helmor ngrok reset
```

`reset` disables public forwarding, clears the reserved domain, and asks a
running Helmor app to close active ngrok tunnels.

Use `overview` when an agent needs the live ingest URLs. It returns the
workspace-local `ingestUrl`, public `publicIngestUrl`, tunnel errors, ngrok
agent status, and stale-tunnel recovery guidance. Use `ensure <workspace-ref>`
when URLs are missing or stale; the Helmor app must be running because ingest
tokens and servers live in app memory.

### MCP Server

Run Helmor as an MCP server over stdio:

```bash
helmor mcp
```

Use this when another agent/runtime needs to call Helmor through Model Context Protocol.

## Command Reference

Read `references/helmor-help.md` when you need the full top-level `helmor --help` command list.

For exact flags on a command group, run the group's help instead of guessing:

```bash
helmor <command> --help
```
