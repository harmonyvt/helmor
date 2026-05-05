# Product

## Register

product

## Users

Software developers running AI coding agents locally. They live in their terminal and editor all day, dispatch Claude Code or Codex to handle tasks in parallel workspaces, and glance at Helmor to monitor progress, review diffs, send follow-up prompts, and inspect what the agents changed. Context: seated at a desk, likely dark ambient lighting, a large monitor. Multiple workspaces open simultaneously. They think in keyboard shortcuts.

## Product Purpose

Helmor is a local-first desktop app (Tauri v2 + React) that wraps AI coding agents (Claude Code, Codex) in a structured workspace UI. It lets developers create isolated workspaces per task, stream agent output in real time, review file changes in an inline diff editor, manage git operations, and send follow-up prompts — all without leaving the app. Success: an agent dispatched from Helmor completes a task the developer didn't have to type a single shell command for.

## Brand Personality

Calm, precise, receding. The app does not compete for attention with the agents working on its behalf. No celebration, no loading spinners with personality, no color-drenched hero moments. It surfaces information at the moment it's needed and disappears otherwise. Closest analogues: Linear (terse, opinionated, fast) and Ghostty (native-feeling, no chrome).

## Anti-references

- **Slack / Notion / web-ported Electron apps** — web-app chrome, rounded cards everywhere, visible scrollbars, gradient headers, modal-first flows. Helmor is a native desktop tool, not a web app skinned as a desktop app.
- **Generic AI chatbot wrappers** — plain chat bubbles on a white/gray background with a big text input. Helmor is a workspace manager; conversation is one surface among many.
- **Dashboard products** — metric tiles, sidebar nav with icons + labels, "Overview" pages. No KPIs here.
- **Bright/playful dev tools** — Warp, some early Cursor versions with heavy purple/gradient identity. Helmor should feel closer to a professional instrument than a consumer product.

## Design Principles

1. **Recede when agents work.** The UI should feel lighter and quieter during active agent runs — no celebratory state, just progress signals.
2. **Surface at the moment of need.** Information and actions appear in context (inline diffs, inspector sections, composer suggestions), not in modals or separate pages.
3. **Native, not web-native.** Interactions follow macOS conventions: keyboard shortcuts, drag handles, traffic lights, no-outline inputs. Never Web 2.0 patterns like rounded pill buttons or heavy card shadows.
4. **Density with breathing room.** Pack information without crowding. Consistent spacing rhythm; section separators over padding inflation.
5. **Every pixel earns its place.** If removing a UI element doesn't break a flow, it should be removed.

## Accessibility & Inclusion

WCAG 2.1 AA. Focus-visible rings on all interactive elements. ARIA labels on icon-only buttons. Reduced-motion: skip all non-functional animations. No color-only status signals — pair color with icon or text. Keyboard navigation for all primary paths.
