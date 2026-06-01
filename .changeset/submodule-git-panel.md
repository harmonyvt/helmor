---
"helmor": minor
---

Add submodule support to the Git panel so each submodule shows up as its own context with its own branch, change list, and actions:
- Switch between the workspace root and any initialized submodule from a context tab strip that shows the submodule name, branch, change count, and ahead/behind indicators at a glance.
- Stage, unstage, discard, diff, push, and PR/commit actions all run inside the selected submodule's git root instead of the parent workspace, so agent prompts and forge commands no longer touch the parent's submodule pointer by accident.
- See per-context details on hover (parent-relative path, branch, target, remote, change/sync summary) and get context-aware empty states — including a "jump to the next submodule with changes" shortcut when the workspace root is clean — plus an initialization hint for submodules that aren't checked out yet.
