# Helmor Design System & UX Reference

This document captures the complete visual design language, UX patterns, and interaction model of the Helmor desktop application. It serves as the canonical reference for maintaining consistency when building new features or components.

---

## Table of Contents

1. [Design Philosophy](#design-philosophy)
2. [Layout Architecture](#layout-architecture)
3. [Color System](#color-system)
4. [Typography](#typography)
5. [Spacing & Sizing](#spacing--sizing)
6. [Border Radius](#border-radius)
7. [Shadows & Elevation](#shadows--elevation)
8. [Component Library](#component-library)
9. [AI-Specific Components](#ai-specific-components)
10. [Feature UX Patterns](#feature-ux-patterns)
11. [Motion & Animation](#motion--animation)
12. [Visual Effects](#visual-effects)
13. [Interaction Patterns](#interaction-patterns)
14. [Accessibility](#accessibility)
15. [Dark Mode](#dark-mode)
16. [Scrollbars](#scrollbars)

---

## Design Philosophy

Helmor is a local-first desktop application built on Tauri v2 + React 19. Its design draws from **macOS native desktop conventions** while layering a modern, developer-focused aesthetic on top.

Core principles:

- **Information density without clutter.** Three resizable panels display workspace, conversation, and inspection surfaces simultaneously. Each panel hides or collapses rather than competing for space.
- **Calm technology.** State is communicated through color, subtle badges, and motion — not intrusive alerts. The app recedes when agents are working.
- **Keyboard-first.** Every primary action has a keyboard shortcut. The composer, file editor, and navigation are all reachable without leaving the keyboard.
- **Perceptual color accuracy.** All semantic colors are defined in the OKLCH color space for perceptually uniform lightness across hues in both light and dark modes.
- **Accessibility by default.** Reduced-motion, focus-visible rings, ARIA attributes, and screen-reader labels are required on all interactive surfaces.

---

## Layout Architecture

### Three-Panel Shell

The application root (`src/App.tsx`) renders a full-height, full-width flexbox row with three panels and two resize handles:

```
┌─────────────────┬──┬─────────────────────┬──┬─────────────────┐
│                 │  │                     │  │                 │
│  Left Sidebar   │░││   Main Content      │░││ Right Inspector │
│  (Navigation)   │  │  (Chat / Editor)    │  │  (Changes/Run)  │
│                 │  │                     │  │                 │
│  220–520px      │  │     flex: 1         │  │  220–520px      │
│  default: 336px │  │                     │  │  default: 336px │
└─────────────────┴──┴─────────────────────┴──┴─────────────────┘
```

**CSS structure:**
```css
main { @apply relative h-screen overflow-hidden bg-background }
/* container */  @apply relative flex h-full min-h-0 bg-background
/* left panel */ @apply flex h-full shrink-0 flex-col overflow-hidden bg-sidebar
/* center */     @apply relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background
/* right panel */ @apply h-full shrink-0 overflow-hidden bg-sidebar
```

**The critical pattern throughout:** `flex min-h-0 flex-1 flex-col overflow-hidden`. The `min-h-0` overrides the browser's flex default (`min-height: auto`) and allows the column to shrink below its content height, enabling inner scrolling to work correctly.

### Resize Handles

Both sidebar↔center joints have a 20px invisible hit area (`SIDEBAR_RESIZE_HIT_AREA`) that renders a 1px visual line, expanding to 2px on hover/drag.

- **Cursor:** `cursor-ew-resize` during drag
- **Keyboard support:** Arrow keys move in 16px steps (`SIDEBAR_RESIZE_STEP`)
- **Persistence:** Width stored in `localStorage` and restored on launch
- **Constraints:** min 220px, max 520px per panel (`MIN_SIDEBAR_WIDTH`, `MAX_SIDEBAR_WIDTH`)
- **RAF throttling:** Mouse-move updates are batched via `requestAnimationFrame` to prevent render thrashing

```tsx
// Visual line — idle → hover → dragging
className={`w-px bg-border group-hover:w-[2px] group-hover:bg-muted-foreground/75
  ${isResizing ? "w-[2px] bg-foreground/80 shadow-[0_0_12px_rgba(0,0,0,0.12)]" : ""}`}
```

### View Modes

The center panel switches between two mutually exclusive views:

| Mode | Description |
|------|-------------|
| `"conversation"` | Default. Shows `WorkspaceConversationContainer` (chat thread + composer). |
| `"editor"` | Activated when a file reference is clicked. Shows `WorkspaceEditorSurface` (Monaco). |

The conversation is hidden via `className="hidden"` (not unmounted) when the editor is active, preserving streaming state.

### Panel Collapse & Zen Mode

- **Sidebar collapse:** Entire `<aside>` is unmounted. A reveal button appears in the conversation header.
- **Inspector collapse:** Same — full unmount.
- **Zen mode:** Single shortcut (`zen.toggle`) collapses/expands both sidebars simultaneously.

### macOS Chrome

Helmor uses an **overlay title bar** with traffic lights at position `(16, 24)`. The window chrome is handled by `TrafficLightSpacer`:

```tsx
// Common header pattern in every top-level panel
<div className="flex h-9 shrink-0 items-center pr-3">
  <TrafficLightSpacer side="left" width={94} />  {/* macOS traffic lights */}
  <div data-tauri-drag-region className="h-full flex-1" />
  <TrafficLightSpacer side="right" width={140} /> {/* Windows/Linux controls */}
</div>
```

- Header height: **36px** (`h-9 = 2.25rem`)
- Left spacer: **94px** (traffic lights + padding)
- Right spacer: **140px** (Windows/Linux close/max/min)
- `data-tauri-drag-region` must be on the transparent flex-1 center area

---

## Color System

Colors are defined in `src/styles/color-theme.css` using the **OKLCH color space** (`oklch(lightness chroma hue)`). This provides perceptually uniform lightness steps across different hues, so grays, accents, and status colors all feel balanced against each other.

### Base Semantic Tokens

| Token | Light | Dark | Purpose |
|-------|-------|------|---------|
| `--background` | `oklch(1 0 0)` | `oklch(0.165 0 0)` | App canvas |
| `--foreground` | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` | Primary text |
| `--card` | `oklch(1 0 0)` | `oklch(0.205 0 0)` | Card/popover surfaces |
| `--popover` | `oklch(1 0 0)` | `oklch(0.165 0 0)` | Floating surfaces |
| `--primary` | `oklch(0.205 0 0)` | `oklch(0.922 0 0)` | Primary actions |
| `--primary-foreground` | `oklch(0.985 0 0)` | `oklch(0.205 0 0)` | Primary button text |
| `--secondary` | `oklch(0.97 0 0)` | `oklch(0.269 0 0)` | Secondary actions |
| `--muted` | `oklch(0.97 0 0)` | `oklch(0.269 0 0)` | Muted backgrounds |
| `--muted-foreground` | `oklch(0.556 0 0)` | `oklch(0.708 0 0)` | Subdued text |
| `--accent` | `oklch(0.97 0 0)` | `oklch(0.269 0 0)` | Hover highlights |
| `--destructive` | `oklch(0.577 0.245 27.325)` | `oklch(0.704 0.191 22.216)` | Error / delete |
| `--border` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 10%)` | Dividers, outlines |
| `--input` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 15%)` | Input field borders |
| `--ring` | `oklch(0.708 0 0)` | `oklch(0.439 0 0)` | Focus rings |
| `--sidebar` | `oklch(0.985 0 0)` | `oklch(0.205 0 0)` | Sidebar surface |

### Conversation Body

The chat body uses a hand-tuned RGB color (not OKLCH) for a slightly warm tone:

```css
--conversation-body-foreground: rgb(44, 40, 38);   /* light */
--conversation-body-foreground: rgb(234, 232, 230); /* dark */
```

### Workspace Status Colors

Used in sidebar rows and inspector badges:

| Token | Value | Meaning |
|-------|-------|---------|
| `--workspace-sidebar-status-review` | `#a09040` | Under review (gold) |
| `--workspace-sidebar-status-progress` | `#508a5a` | In progress (green) |
| `--workspace-sidebar-status-backlog` | `#848f92` | Backlog (gray-blue) |
| `--workspace-sidebar-status-canceled` | `#a86868` | Canceled (muted red) |
| `--workspace-pr-merged-accent` | `#8957e5` | Merged PR (purple) |
| `--workspace-pr-open-accent` | `#238636` | Open PR (green) |
| `--workspace-pr-conflicts-accent` | `rgb(210,153,34)` | Conflicts (amber) |
| `--workspace-pr-closed-accent` | `#da3633` | Closed PR (red) |
| `--plan` | `#48968c` | Plan mode (teal) |

### Chart Colors (Data Visualization)

| Token | OKLCH | Hue |
|-------|-------|-----|
| `--chart-1` | `oklch(0.646 0.222 41.116)` | Orange |
| `--chart-2` | `oklch(0.6 0.118 184.704)` | Cyan |
| `--chart-3` | `oklch(0.398 0.07 227.392)` | Dark blue |
| `--chart-4` | `oklch(0.828 0.189 84.429)` | Yellow-green |
| `--chart-5` | `oklch(0.769 0.188 70.08)` | Golden |

### Color Mixing

Components make extensive use of `color-mix()` in oklch to derive transparent or blended values without adding new tokens:

```css
color-mix(in oklch, var(--foreground) 18%, transparent)   /* subtle scrollbar thumb */
color-mix(in oklch, var(--foreground) 30%, transparent)   /* hover scrollbar thumb */
color-mix(in oklch, var(--muted) 87%, var(--muted-foreground) 13%)  /* inline code bg */
color-mix(in oklch, var(--border) 90%, transparent)       /* faint borders */
```

---

## Typography

### Font Families

| Variable | Value | Usage |
|----------|-------|-------|
| `--font-sans` | `"Geist Variable"`, `"SF Pro Display"`, system-ui | All UI text |
| `--font-mono` | `"Geist Mono Variable"`, `"SF Mono"`, Menlo, Monaco | Code, terminals |
| `--font-heading` | `var(--font-sans)` | Headings (same as sans) |

Both fonts are variable-weight, loaded from `@fontsource-variable/geist` and `@fontsource-variable/geist-mono`. Font rendering is optimized:

```css
font-synthesis: none;
text-rendering: optimizeLegibility;
-webkit-font-smoothing: antialiased;
-moz-osx-font-smoothing: grayscale;
```

### Size Scale

| Class | Size | Common Usage |
|-------|------|-------------|
| `text-xs` | 12px | Labels, badges, code block headers |
| `text-sm` | 14px | Default UI text, button labels, inputs |
| `text-[12px]` | 12px | Keyboard shortcut hints, inspector tabs |
| `text-[0.8rem]` | 12.8px | Small toggle buttons |
| Base | 16px | Body, dialog text |

### Markdown Typography (`.assistant-markdown-scale`)

Applied to all assistant message content rendered by `streamdown`:

```css
p, li              { line-height: var(--assistant-paragraph-line-height, 1.82) }
h1                 { font-size: 1.35em; line-height: 1.3; margin: 1.4em 0 0.4em }
h2                 { font-size: 1.2em;  line-height: 1.32 }
h3                 { font-size: 1.1em;  line-height: 1.36 }
h4–h6              { font-size: 1em;    line-height: 1.4 }
code (inline)      { font-size: 0.88em; border: 1px solid …; margin: 0 2px }
blockquote         { color: muted-foreground; border-left: 0.25rem solid }
```

Code blocks rendered inside markdown: `font-size: 0.86em`, `font-family: --font-mono`.

---

## Spacing & Sizing

### Spacing Scale

Helmor uses Tailwind's default rem-based scale. The most-used steps:

| Class | Value | Usage |
|-------|-------|-------|
| `gap-1` / `p-1` | 4px | Icon padding, minimal gaps |
| `gap-1.5` | 6px | Button icon-to-label gap |
| `gap-2` | 8px | Standard component gap |
| `gap-2.5` | 10px | Popover content padding |
| `px-2.5` | 10px | Button horizontal padding |
| `px-3` | 12px | Panel section headers |
| `gap-4` / `p-4` | 16px | Section/dialog spacing |

### Component Heights

| Class | Value | Component |
|-------|-------|-----------|
| `h-6` | 24px | Small/xs buttons and icons |
| `h-7` | 28px | Medium buttons (`sm` size) |
| `h-8` | 32px | Default buttons, inputs |
| `h-9` | 36px | Large buttons, header bars, drag region |
| `h-7.5` | 30px | Workspace sidebar rows |
| `h-screen` | 100vh | Root layout container |

### Sidebar Virtualizer Row Heights

| Item | Height | Constant |
|------|--------|----------|
| Workspace row | 32px | `ROW_HEIGHT` |
| Group header | 34px | `HEADER_HEIGHT` |
| Group gap | 8px | — |
| Bottom padding | 8px | — |

---

## Border Radius

The base radius is `--radius: 0.625rem` (10px). All radii are derived from this single variable:

| Token | Calculation | Value | Usage |
|-------|------------|-------|-------|
| `--radius-sm` | `× 0.6` | 6px | Badges, small pills |
| `--radius-md` | `× 0.8` | 8px | Inputs, form elements |
| `--radius-lg` | `× 1.0` | 10px | Buttons, cards (default) |
| `--radius-xl` | `× 1.4` | 14px | Popovers, tooltips |
| `--radius-2xl` | `× 1.8` | 18px | Large cards |
| `--radius-3xl` | `× 2.2` | 22px | Sheets |
| `--radius-4xl` | `× 2.6` | 26px | Full pill shapes |

The composer textarea container uses `rounded-2xl` (a Tailwind class mapping to `--radius-2xl`-ish). Badges use `rounded-full` (9999px).

---

## Shadows & Elevation

Helmor uses a minimal shadow vocabulary — most depth comes from border and background contrast rather than drop shadows.

| Class | Usage |
|-------|-------|
| `shadow-sm` | Subtle card elevation |
| `shadow-md` | Popover, tooltip |
| `shadow-lg` | Modal, sheet, command palette |
| `ring-1` / `ring-3` | Outline rings |
| `ring-ring/50` | Focus ring at 50% opacity |

Resize handle glow during drag:

```css
/* Light */ shadow-[0_0_12px_rgba(0,0,0,0.12)]
/* Dark  */ shadow-[0_0_12px_rgba(255,255,255,0.16)]
```

---

## Component Library

All primitives are from **shadcn/ui (base-nova)** backed by Radix UI headless components. Every component uses `data-slot` attributes for CSS targeting and supports `asChild` for polymorphism.

### Button

```typescript
variant: "default" | "outline" | "secondary" | "ghost" | "destructive" | "link"
size:    "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg"
```

Key sizing:
- `default`: `h-8 px-2.5 gap-1.5`
- `xs`: `h-6 px-2 gap-1 text-xs`
- `icon`: `size-8` (32×32px square)
- `icon-xs`: `size-6` (24×24px)

**Every clickable element must have `cursor-pointer`.** This is baked into all base primitives. Custom `<div onClick>` elements must add it explicitly.

### Tabs

```typescript
variant: "default" | "line"
```

- `default`: `bg-muted` pill-style tabs
- `line`: transparent with a bottom border indicator, gap between tabs

### Badge

```typescript
variant: "default" | "secondary" | "destructive" | "outline" | "ghost" | "link"
```

### Dropdown Menu

Context-aware size via `DropdownMenuSizeContext`:
- `default`: `gap-1.5 py-1 text-sm`
- `sm`: `gap-1 py-1 text-xs leading-[14px]`

### Input Group

Composable input with addons using slots: `inline-start`, `inline-end`, `block-start`, `block-end`.

### Field

```typescript
orientation: "vertical" | "horizontal" | "responsive"
```

Responsive orientation uses container queries: `@md/field-group:flex-row`.

### Empty State

```typescript
variant: "default" | "icon"
```

Used for zero-state displays in the conversation thread, file trees, and settings panels.

### Special Effect Components

| Component | Effect |
|-----------|--------|
| `AnimatedShinyText` | Gradient shimmer sweep over text |
| `ShimmerText` | Phase-offset shimmer with configurable duration (default 1900ms) |
| `ShineBorder` | Animated border gradient (configurable `borderWidth`, `duration`, `shineColor`) |
| `TypingAnimation` | Typewriter character-by-character reveal |
| `NumberTicker` | Animated number counter |

---

## AI-Specific Components

Located in `src/components/ai/`.

### Code Block (`code-block.tsx`)

- **Syntax highlighting:** Shiki (`one-light` theme in light, `one-dark-pro` in dark)
- **Typography:** `text-[12px] leading-5 font-mono`
- **Container:** `border border-border/70 bg-background/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]`
- **Variants:** `default` (with language header) | `plain` (no header, padded only)
- **Header:** Language label at `text-[10px] uppercase tracking-wide`
- **Copy button:** `h-6 w-6 rounded-md`, shows `CheckIcon` for 2000ms after copy
- **Line numbers:** `text-muted-foreground/55 min-w-8 mr-4` (opt-in)

### Reasoning Block (`reasoning.tsx`)

Collapsible block for Claude's extended thinking output.

- **Streaming state:** Open by default, shows "Thinking…" with shimmer animation
- **Just-finished:** Stays open briefly, switches to "Thought for Xs"
- **Historical:** Collapsed by default, `BrainIcon` trigger
- **Content:** `<pre>` with `bg-muted/40 px-3 py-2.5 font-sans text-muted-foreground/80`
- **Chevron:** Rotates 90° on expand

### File Tree (`file-tree.tsx`)

- `role="tree"` / `role="treeitem"` for screen readers
- Folder icon: `text-blue-500`; File icon: `text-muted-foreground`
- Expand chevron rotates `rotate-90` when open
- Hover: `bg-muted/50` row highlight

---

## Feature UX Patterns

### Workspace Sidebar (Navigation)

**Structure:** Window safe area → workspaces header → virtualized list

- Uses TanStack React Virtual with `overscan: 12`
- Each row: `h-7.5 px-2.5 gap-2 rounded-md` — avatar, name, branch badge, status badge
- Hover reveals context menu (clone, delete, archive, etc.) with `mask-image` right-edge fade
- Prefetch on `mouseEnter` for fast selection
- Selected row: `.workspace-row-selected` CSS class
- Group headers are collapsible, state in `localStorage`
- New workspace / add repo buttons in header

### Panel Header (Session Tabs)

- Horizontal scrollable tab row above the conversation thread
- Each tab: session name + branch, hover reveals dropdown (rename, copy branch, delete)
- Inline rename via `<Input>` that activates on the rename menu item
- `+ New` button with keyboard shortcut at right
- Sending indicator badge and unread count badge per tab
- BranchPickerPopover for switching branches

### Conversation Thread

Two rendering modes based on message count:
- **≤ 12 messages:** `PlainThread` — simple `flex-col` list, no virtualization overhead
- **> 12 messages:** `ProgressiveConversationViewport` — TanStack Virtual with estimated height cache

**Scroll behavior:**
- `useStickToBottom` auto-scrolls to new content
- Instant jump on first send (`sendingJustStarted`)
- Floating `ArrowDown` button appears when user scrolls up during streaming
- 32px width bucket granularity for resize tracking

**Message anatomy:**

| Role | Component | Notes |
|------|-----------|-------|
| User | `ChatUserMessage` | Text + inline file/image badges |
| Assistant | `ChatAssistantMessage` | `streamdown` markdown, reasoning block, tool calls, status badges |
| System | `ChatSystemMessage` | Git events, status lines |

Assistant status badges: `max_tokens`, `context_exceeded`, `refusal`.

**Streaming footer:** Helmor logo + elapsed timer at conversation tail while streaming.

### Composer

Container: `rounded-2xl border border-border/40 bg-sidebar`

Layout from top to bottom:
1. **Context bar** — linked directory pills (removable)
2. **Lexical editor** — `min-h-[64px] max-h-[240px]`, auto-resizes
3. **Toolbar row** — model picker, effort selector, permission mode toggle, fast-mode toggle
4. **Action row** — token usage ring + send/stop button

**Inline nodes in editor:**
- `ImageBadgeNode` — dropped/pasted images shown as badge
- `FileBadgeNode` — `@mention`-selected files
- `CustomTagBadgeNode` — slash-command output tags
- `AddDirTriggerNode` — directory picker trigger

**Overlay panels** (replace composer when active):
- `ElicitationPanel` — model asks a clarifying question; renders a form
- `DeferredToolPanel` — tool requires human approval; approve/deny UI

**Send/stop logic:**
- Send enabled when: `!disabled && selectedModel && hasContent && !pendingInteraction`
- While streaming: send button becomes "Stop"; Cmd+Enter steers (interrupts with new message)

### Inspector Sidebar

Three vertically stacked, independently resizable sections:
1. **Actions** — PR/MR status, forge checks, deployment status, sync button
2. **Changes** — staged/unstaged file list, diff on click, per-file stage/discard buttons
3. **Tabs** — Setup script | Run script | Terminal instances (+new)

**Terminal hover-to-zoom:**
- After 300ms hover intent delay, terminal expands to 200% size
- `cubic-bezier(0.32, 0.72, 0, 1)` easing (Apple spring curve), 400ms duration
- Blur-pulse during transition hides canvas reflow artifacts
- `xterm.js` FitAddon suspended during animation

**Resize between sections:** `HorizontalResizeHandle` with 10px hit area.

**File status color coding:**
- `M` (Modified) → amber
- `A` (Added) → green
- `D` (Deleted) → red

### Settings Dialog

Sidebar-navigated modal (`SidebarProvider` within dialog).

Sections: General | Appearance | Model | Shortcuts | Git | Experimental | Import | Developer | Account | Repository

- `SettingsRow` / `SettingsGroup` / `Field` / `FieldLabel` primitives for consistent layout
- Theme toggle uses radio group (Light / Dark / System)
- Font size: slider 12–20px
- Model selection: dropdown with effort-level clamp

### Commit Button

Multi-mode split button with main action + dropdown chevron:

| `mode` | Idle Label | Active Label | Done Label |
|--------|-----------|--------------|------------|
| `create-pr` | "Create PR" | "Creating PR…" | "PR Created" |
| `commit-and-push` | "Commit and Push" | "Committing…" | "Pushed" |
| `push` | "Push" | "Pushing…" | "Pushed" |
| `fix` | "Fix CI" | "Fixing CI…" | "CI Fixed" |
| `resolve-conflicts` | "Resolve Conflicts" | — | — |

State machine: `idle → busy (200ms activity) → done (1500ms) → idle` (or `error` on failure).

### Editor Surface

Lazy-loaded Monaco editor (`src/lib/monaco-runtime.ts`) supporting:
- `kind: "file"` — single file with live disk change subscription
- `kind: "diff"` — side-by-side diff (original from git ref vs modified)
- Toolbar: close button, file path indicator
- Falls back to error dialog with retry on load failure

---

## Motion & Animation

### Keyframe Library

| Name | Duration | Easing | Effect |
|------|----------|--------|--------|
| `conversation-fade-in` | 70ms | ease-out | New message entry opacity |
| `conversation-scrollbar-fade-in` | 300ms + 400ms delay | ease-out | Scrollbar appears |
| `shortcut-recording-ring` | 1100ms | ease-out infinite | Ring pulses at scale 1→1.2 |
| `shortcut-conflict-shake` | 260ms | ease-in-out | Horizontal shake ±2px |
| `helmor-shimmer-sweep` | 2.4s | ease-in-out infinite | Background-position gradient sweep |
| `helmor-shimmer-text` | 2.4s | ease-in-out infinite | Text color gradient sweep |
| `effort-shimmer` | 4s | ease-in-out infinite | Multi-stop oklch gradient on max effort |
| `shine` | `var(--duration)` | linear infinite | Generic shine effect |
| `shiny-text` | 8s | infinite | Shiny text gradient |

### Transition Durations

| Duration | Usage |
|----------|-------|
| 70ms | Message fade-in |
| 150ms | Color feedback (button press) |
| 200ms | Opacity/transform (general UI) |
| 260ms | Conflict shake |
| 300ms | Scrollbar fade-in |
| 400ms | Inspector zoom transition |
| 1100ms | Shortcut recording pulse |
| 2.4s | Shimmer sweeps |
| 4s | Effort level gradient |
| 8s | Shiny text |

### Easing Reference

| Curve | Usage |
|-------|-------|
| `ease-out` | Most entrance animations |
| `ease-in-out` | Symmetric transitions (shake, shimmer) |
| `cubic-bezier(0.32, 0.72, 0, 1)` | Inspector terminal zoom (Apple spring) |
| `cubic-bezier(.6, .6, 0, 1)` | Shimmer background |
| `linear` | Continuous rotation/shine loops |

### Tailwind Animation Utilities (tw-animate-css)

Used heavily in Radix component enter/exit:

```
animate-in / animate-out
fade-in-0 / fade-out-0
zoom-in-95 / zoom-out-95
slide-in-from-top-2, slide-in-from-bottom-10, slide-in-from-left-10, slide-in-from-right-10
slide-out-to-bottom-10, slide-out-to-left-10, slide-out-to-right-10, slide-out-to-top-10
duration-100
```

---

## Visual Effects

### Shimmer Text

Used on loading states and streaming indicators:

```css
.helmor-shimmer-text {
  background-image: linear-gradient(90deg, muted-foreground, foreground, muted-foreground);
  background-size: 300% 100%;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: helmor-shimmer-sweep 2.4s ease-in-out infinite;
}
```

### Effort Level Gradient (max / xhigh)

Applied to effort selector label when model is at max effort:

```css
background: linear-gradient(135deg,
  oklch(0.7 0.22 280),   /* Purple */
  oklch(0.65 0.24 330),  /* Pink */
  oklch(0.7 0.22 20),    /* Red-orange */
  oklch(0.65 0.24 280)   /* Purple again */
);
animation: effort-shimmer 4s ease-in-out infinite;
background-clip: text;
```

### Row Content Fade

Sidebar rows use `mask-image` to fade out right-edge content, revealing hover actions:

```css
.row-content-fade {
  mask-image: linear-gradient(to left,
    var(--row-fade-transparent) 1.2rem,
    var(--row-fade-solid) 2rem
  );
}
```

### Shine Border

`ShineBorder` component animates a bright gradient sweep around a container's border:

```css
animation: shine var(--duration) infinite linear;
/* background-position sweeps from 0%/0% → 100%/100% */
```

---

## Interaction Patterns

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Submit message | Cmd/Ctrl+Enter |
| Toggle queue vs steer | Alt+Cmd/Ctrl+Enter |
| New session | Cmd+Shift+T |
| New workspace | Cmd+Shift+N |
| Focus composer | Cmd+P (or configured) |
| Toggle left sidebar | `sidebar.left.toggle` |
| Toggle right inspector | `sidebar.right.toggle` |
| Toggle zen mode | `zen.toggle` |
| Previous/next workspace | `workspace.previous` / `workspace.next` |
| Previous/next session | `session.previous` / `session.next` |

### Streaming Interactions

1. **While streaming:** Stop button in composer; streaming footer shows elapsed time
2. **Steer:** Cmd+Enter during stream — interrupts agent with new message
3. **Queue:** Alt+Cmd+Enter — toggles whether the next message queues vs steers
4. **Elicitation:** Model asks a question → `ElicitationPanel` overlays composer
5. **Deferred tool:** Tool requests human input → `DeferredToolPanel` overlays composer
6. **Permission request:** Converted to deferred tool UI; approve/deny inline

### React Query Prefetch

- Workspace data prefetches on sidebar row `mouseEnter`
- Session data prefetches on session tab hover
- Keeps navigation feel instant

### Draft Persistence

- Composer content (text + images + files + custom tags) auto-saved to `localStorage`
- Restored on mount via `restoreNonce` mechanism
- Per-session draft isolation

### Toast Notifications

Sonner (`sonner`) is used for non-blocking feedback: workspace operations, API errors, copy confirmations.

---

## Accessibility

### Focus

All interactive elements use:

```css
focus-visible:ring-3 focus-visible:ring-ring/50
/* or */
focus-visible:border-ring
```

`focus-visible` (not `focus`) ensures rings only appear on keyboard navigation, not mouse clicks.

### ARIA

| Pattern | Usage |
|---------|-------|
| `role="tree"` + `role="treeitem"` | File trees in inspector |
| `role="separator"` | Resize handles |
| `role="alert"` | Error messages |
| `aria-label` | All panels, buttons, inputs, regions |
| `aria-expanded` / `aria-selected` | Collapsibles, tabs, selects |
| `aria-orientation="vertical"` | Resize handles |
| `aria-multiline` | Lexical composer textarea |
| `sr-only` | Hidden labels for icons |
| `DialogTitle` | Always present in dialog headers |

### Reduced Motion

All animations and transitions are gated:

```css
@media (prefers-reduced-motion: reduce) {
  animation-duration: 0.01ms !important;
  transition-duration: 0.01ms !important;
  scroll-behavior: auto !important;
}
```

The `motion-safe:` Tailwind prefix is used on decorative animations (shine, shimmer).

### Disabled States

```css
disabled:pointer-events-none
disabled:opacity-50
```

---

## Dark Mode

Dark mode is applied via the `.dark` class on the root element (class-based, not `prefers-color-scheme`). This allows Helmor's settings to control the active theme independently.

Key inversion pattern: lightness values in OKLCH simply invert — `oklch(0.145 0 0)` ↔ `oklch(0.985 0 0)`. Because OKLCH separates lightness from chroma and hue, colored tokens (destructive, chart, workspace status) receive individually tuned dark values rather than simple inversion.

Dark mode surfaces are layered:
- App canvas: `oklch(0.165 0 0)` (very dark, near #252525)
- Cards / inspector sidebar: `oklch(0.205 0 0)` (slightly lighter layer)
- Popovers / menus: `oklch(0.165 0 0)` (same as canvas — floating)

---

## Scrollbars

Custom scrollbar styling is applied globally:

**Firefox:**
```css
scrollbar-width: thin;
scrollbar-color: color-mix(in oklch, var(--foreground) 18%, transparent) transparent;
```

**WebKit:**
```css
::-webkit-scrollbar       { width: 8px; height: 8px }
::-webkit-scrollbar-thumb { border-radius: 999px; border: 2px solid transparent;
                             background-clip: padding-box;
                             background: color-mix(in oklch, var(--foreground) 18%, transparent) }
::-webkit-scrollbar-thumb:hover { background: color-mix(in oklch, var(--foreground) 30%, transparent) }
::-webkit-scrollbar-track { background: transparent }
```

**Utility classes:**
- `scrollbar-none` — hides scrollbar entirely (used on horizontal tab rows)
- `scrollbar-stable` — `scrollbar-gutter: stable` (prevents layout shift in panels)

The conversation area has a special `.conversation-scrollbar-fade-in` class that fades the scrollbar in with a 400ms delay after 300ms fade duration — so it only appears visually after a brief moment of scrolling.

---

## Z-Index Scale

| Value | Usage |
|-------|-------|
| `z-10` | Conversation scroll-to-bottom button, inline overlays |
| `z-20` | Status badges, streaming footer |
| `z-30` | Resize handles |
| `z-50` | Modals, dialogs, popovers, tooltips, dropdown menus |

The scale is intentionally minimal. Nothing exceeds `z-50`.
