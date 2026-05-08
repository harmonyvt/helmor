# Product

## Users

Developers running local AI agent workflows — software engineers who use Claude Code or OpenAI Codex to automate engineering tasks across multiple workspaces, projects, branches, and PRs. They live in their terminal and editor all day, dispatch agents to isolated parallel workspaces, and use Helmor to manage, prioritize, monitor progress, review streamed output and diffs, inspect PR status and comments, steer conversations, commit work, send follow-up prompts, and track AI-driven work across a project. They are keyboard-first power users on desktop and one-hand mobile users when monitoring agents away from the desk; both audiences value speed, precision, and minimal clutter.

## Product Purpose

Helmor is a local-first mobile and desktop workspace management shell for AI coding agents. It runs as a Tauri macOS desktop app and browser-accessible companion, connecting to Claude Code CLI and OpenAI Codex CLI processes while storing sessions and messages in a local SQLite database. It surfaces sessions, thread history, file changes, and action surfaces without forcing the developer back into a terminal. It lets developers create isolated workspaces per task, stream agent output in real time, review file changes in an inline diff editor, manage git and PR lifecycle, inspect CI checks and comments, open terminal or browser context, and send follow-up prompts. The Goals workspace extends this with a Kanban board where each card is a child workspace, and Pi — Helmor's built-in planning AI — manages the board on the user's behalf.

Success looks like: the developer stays in flow, the app recedes while agents work, and every primary action is reachable in one or two taps or keystrokes.

## Brand Personality

Calm, precise, composed, capable. The app does not compete for attention with the agents working on its behalf. No celebration, no loading spinners with personality, no color-drenched hero moments. It surfaces just enough context at the moment it's needed and disappears otherwise, making AI agents feel native to the developer's existing workflow. Closest analogues: Linear (terse, opinionated, fast) and Ghostty (native-feeling, no chrome).

## Anti-references

- **Slack / Notion / web-ported Electron apps** — web-app chrome, rounded cards everywhere, visible scrollbars, gradient headers, modal-first flows. Helmor is a native desktop tool, not a web app skinned as a desktop app.
- **Generic AI chatbot wrappers** — plain chat bubbles on a white/gray background with a big text input. Helmor is a workspace manager; conversation is one surface among many.
- **Overstuffed AI product dashboards** — metric tiles, sidebar nav with icons + labels, "Overview" pages, Devin-style or Copilot workspace clutter. No KPIs here.
- **Bright/playful dev tools** — Warp, some early Cursor versions with heavy purple/gradient identity. Helmor should feel closer to a professional instrument than a consumer product.
- **AI startup pastel** — soft gradients, rounded everything, illustration-heavy onboarding, and marketing-page motion inside app chrome.
- **Generic half-baked SaaS UI** — floating cards, hero metrics, identical icon+heading+body grids.
- **VS Code dark maximalism** — every pixel filled, no breathing room, icon overload.

## Design Principles

1. **Recede, don't announce.** The UI should feel lighter and quieter during active agent runs. Every element earns its pixels; chrome that doesn't serve the user's current action disappears.
2. **Surface at the moment of need.** Information and actions appear in context (inline diffs, inspector sections, composer suggestions), not in modals or separate pages.
3. **Native, not web-native.** Interactions follow platform conventions: macOS keyboard shortcuts, drag handles and traffic lights; mobile safe areas, touch targets, and back/one-thumb navigation. Never Web 2.0 patterns like rounded pill buttons or heavy card shadows.
4. **Context without context-switching.** Workspace, thread, changes, and inspector state should be adjacent surfaces — never a full navigation reset.
5. **Density by default, space on demand.** Pack information without crowding on desktop; default to spacious on mobile and compact only when asked.
6. **One model, one task.** When a surface is locked to a specific AI (Pi), don't show the generic multi-model chrome.
7. **Keyboard-first, touch-ready.** Every action is reachable from the keyboard; mobile primary actions are reachable one-handed; mouse interactions remain the pleasant surface for exploration.
8. **Calm feedback.** State changes communicate themselves through color, motion, and copy — never through intrusive alerts or excessive visual noise.

## Accessibility & Inclusion

WCAG 2.1 AA. Focus-visible rings on all interactive elements. ARIA labels on icon-only buttons. Reduced-motion support via `prefers-reduced-motion`; skip all non-functional animations. No color-only status signals — pair color with icon or text. Keyboard navigation for all primary paths. Touch targets are at least 44×44pt on mobile. Custom scrollbar styling degrades gracefully.
