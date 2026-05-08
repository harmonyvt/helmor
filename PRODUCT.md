# Product

## Users

Developers running local AI agent workflows — software engineers who use Claude Code or OpenAI Codex to automate engineering tasks across multiple workspaces, branches, and PRs. They live in their terminal and editor all day, dispatch agents to parallel workspaces, and use Helmor to manage, prioritize, monitor progress, review streamed output and diffs, inspect PR status and comments, send follow-up prompts, and track AI-driven work across a project. They are keyboard-first power users who value a dense, keyboard-navigable desktop UI when context-switching between workspaces is expensive.

## Product Purpose

Helmor is a local-first workspace management shell for AI coding agents. It runs as a Tauri macOS desktop app, connecting to Claude Code CLI and OpenAI Codex CLI processes while storing sessions and messages in a local SQLite database. It lets developers create isolated workspaces per task, stream agent output in real time, review file changes in an inline diff editor, manage git and PR lifecycle, inspect CI checks and comments, open terminal or browser context, and send follow-up prompts — all without leaving the app. The Goals workspace extends this with a Kanban board where each card is a child workspace, and Pi — Helmor's built-in planning AI — manages the board on the user's behalf.

## Brand Personality

Calm, precise, composed, capable. The app does not compete for attention with the agents working on its behalf. No celebration, no loading spinners with personality, no color-drenched hero moments. It surfaces just enough context at the moment it's needed and disappears otherwise, making AI agents feel native to the developer's existing workflow. Closest analogues: Linear (terse, opinionated, fast) and Ghostty (native-feeling, no chrome).

## Anti-references

- **Slack / Notion / web-ported Electron apps** — web-app chrome, rounded cards everywhere, visible scrollbars, gradient headers, modal-first flows. Helmor is a native desktop tool, not a web app skinned as a desktop app.
- **Generic AI chatbot wrappers** — plain chat bubbles on a white/gray background with a big text input. Helmor is a workspace manager; conversation is one surface among many.
- **Overstuffed AI product dashboards** — metric tiles, sidebar nav with icons + labels, "Overview" pages, Devin-style or Copilot workspace clutter. No KPIs here.
- **Bright/playful dev tools** — Warp, some early Cursor versions with heavy purple/gradient identity. Helmor should feel closer to a professional instrument than a consumer product.
- **AI startup pastel** — soft gradients, rounded everything, illustration-heavy onboarding, and marketing-page motion inside app chrome.

## Design Principles

1. **Recede, don't announce.** The UI should feel lighter and quieter during active agent runs. Every element earns its pixels; chrome that doesn't serve the user's current action disappears.
2. **Surface at the moment of need.** Information and actions appear in context (inline diffs, inspector sections, composer suggestions), not in modals or separate pages.
3. **Native, not web-native.** Interactions follow macOS conventions: keyboard shortcuts, drag handles, traffic lights, no-outline inputs. Never Web 2.0 patterns like rounded pill buttons or heavy card shadows.
4. **Density by default, space on demand.** Pack information without crowding. Compact default states expand contextually, with section separators over padding inflation.
5. **One model, one task.** When a surface is locked to a specific AI (Pi), don't show the generic multi-model chrome.
6. **Keyboard-first, mouse-tolerant.** Every action is reachable from the keyboard; mouse interactions are the pleasant surface for exploration.
7. **Calm feedback.** State changes communicate themselves through color, motion, and copy — never through intrusive alerts or excessive visual noise.

## Accessibility & Inclusion

WCAG 2.1 AA. Focus-visible rings on all interactive elements. ARIA labels on icon-only buttons. Reduced-motion support via `prefers-reduced-motion`; skip all non-functional animations. No color-only status signals — pair color with icon or text. Keyboard navigation for all primary paths. Custom scrollbar styling degrades gracefully.
