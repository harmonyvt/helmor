# Product

## Register

product

## Users

Developers running local AI agent workflows — software engineers who use Claude Code or OpenAI Codex to automate engineering tasks on multiple parallel branches. They work in Helmor to manage, prioritize, and track AI-driven work across a project. They are keyboard-first power users who value a dense, keyboard-navigable desktop UI when context-switching between workspaces is expensive.

## Product Purpose

Helmor is a local-first workspace management shell for AI coding agents. It runs as a macOS desktop app, connecting to Claude Code CLI and OpenAI Codex CLI processes and surfacing their sessions, thread history, and file changes in a three-panel IDE-like UI. The Goals workspace extends this with a Kanban board where each card is a child workspace, and Pi — Helmor's built-in planning AI — manages the board on the user's behalf.

## Brand Personality

Precise, composed, capable. Helmor doesn't announce itself — it gets out of the way and makes AI agents feel native to the developer's existing workflow. Three-word personality: quiet, focused, capable.

## Anti-references

- Overstuffed AI product dashboards (Devin, Copilot workspace UI)
- Generic SaaS rounded-card grids
- "AI startup pastel" — soft gradients, rounded everything, illustration-heavy onboarding
- VS Code sidebar clutter
- Marketing-page motion and hero sections inside app chrome

## Design Principles

1. **Recede, don't announce.** Every element earns its pixels. Chrome that doesn't serve the user's current action disappears.
2. **Density by default, space on demand.** Compact default states that expand contextually. Don't pad everything assuming users have big screens.
3. **One model, one task.** When a surface is locked to a specific AI (Pi), don't show the generic multi-model chrome.
4. **Keyboard-first, mouse-tolerant.** Every action is reachable from the keyboard; mouse interactions are the pleasant surface for exploration.
5. **Calm feedback.** State changes communicate themselves through color, motion, and copy — never through intrusive alerts or excessive visual noise.

## Accessibility & Inclusion

WCAG AA target. Reduced-motion support via `prefers-reduced-motion`. All interactive elements have accessible names and focus rings. Custom scrollbar styling that degrades gracefully.
