---
name: helmor-app-install
description: Build a production Helmor macOS app from the local repo and install it into /Applications. Use when the user asks to build Helmor, create a production Tauri app, replace or install /Applications/Helmor.app, ad-hoc sign a local Helmor build, or verify the installed app bundle.
---

# Helmor App Install

Use this skill to build the production macOS Helmor app and install it locally.

## Preconditions

- Work from the Helmor repo root. Confirm `src-tauri/tauri.conf.json` and `package.json` exist.
- Preserve unrelated working tree changes. Do not clean `workspaces/`, database files, build outputs, or user data.
- If `Helmor` is running, ask the user to quit it before replacing `/Applications/Helmor.app`, unless they already asked you to force a restart/replace.

## Workflow

Preferred path: run the bundled script from the repo root.

```bash
.codex/skills/helmor-app-install/scripts/install_app.sh
```

The script prints the same verification data this skill expects. It treats the known missing-updater-private-key condition as a warning when the `.app` was produced and installed successfully.

Manual fallback:

1. Check status and the current installed app:

```bash
git status --short
pgrep -x Helmor || true
defaults read /Applications/Helmor.app/Contents/Info CFBundleShortVersionString 2>/dev/null || true
```

2. Build the production app bundle:

```bash
bun run tauri build --bundles app
```

If this exits nonzero because `TAURI_SIGNING_PRIVATE_KEY` is missing, continue only when the app bundle exists at:

```text
src-tauri/target/release/bundle/macos/Helmor.app
```

This repo config creates updater artifacts, so a missing updater private key can fail after the `.app` is produced. Report that caveat.

3. Verify the built bundle metadata:

```bash
defaults read src-tauri/target/release/bundle/macos/Helmor.app/Contents/Info CFBundleShortVersionString
defaults read src-tauri/target/release/bundle/macos/Helmor.app/Contents/Info CFBundleIdentifier
du -sh src-tauri/target/release/bundle/macos/Helmor.app
```

4. Install into Applications:

```bash
ditto src-tauri/target/release/bundle/macos/Helmor.app /Applications/Helmor.app
```

5. Ad-hoc sign the local installed copy with the app entitlements and verify it:

```bash
codesign --force --deep --options runtime --entitlements src-tauri/Entitlements.plist --sign - /Applications/Helmor.app
codesign --verify --deep --strict --verbose=2 /Applications/Helmor.app
codesign -d --entitlements :- /Applications/Helmor.app >/dev/null
defaults read /Applications/Helmor.app/Contents/Info CFBundleShortVersionString
defaults read /Applications/Helmor.app/Contents/Info CFBundleIdentifier
du -sh /Applications/Helmor.app
```

## Optional Data-Mode Verification

When the user cares whether production Helmor uses prod or dev data, verify through the bundled CLI:

```bash
/Applications/Helmor.app/Contents/MacOS/helmor-cli data info --json
```

The app's data source preference lives outside both databases at:

```text
~/Library/Application Support/Helmor/bootstrap-settings.json
```

## Reporting

Report:

- installed path, version, bundle id, and size
- whether codesign verification passed and entitlements were readable
- whether the Tauri build had the expected updater-signing caveat
- any verification commands that failed

Do not call the app notarized unless it was signed with the real release identity and notarized.
