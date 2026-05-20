#!/usr/bin/env bash
set -u

repo_root="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
app_name="Helmor.app"
built_app="$repo_root/src-tauri/target/release/bundle/macos/$app_name"
installed_app="/Applications/$app_name"
entitlements="$repo_root/src-tauri/Entitlements.plist"

cd "$repo_root" || exit 1

export RUST_BACKTRACE="${RUST_BACKTRACE:-full}"
export RUST_LIB_BACKTRACE="${RUST_LIB_BACKTRACE:-1}"

if [[ ! -f package.json || ! -f src-tauri/tauri.conf.json ]]; then
  echo "error: run from the Helmor repo root, or pass the repo root as argv[1]" >&2
  exit 1
fi

if pgrep -x Helmor >/dev/null && [[ "${HELMOR_INSTALL_FORCE:-0}" != "1" ]]; then
  echo "error: Helmor is running. Quit it first, or set HELMOR_INSTALL_FORCE=1 if replacement is intentional." >&2
  exit 2
fi

echo "==> Working tree status"
git status --short

echo "==> Building production app"
echo "==> Rust telemetry: RUST_BACKTRACE=$RUST_BACKTRACE RUST_LIB_BACKTRACE=$RUST_LIB_BACKTRACE"
build_started_at=$(date +%s)
bun run tauri build --bundles app
build_status=$?

if [[ ! -d "$built_app" || ! -x "$built_app/Contents/MacOS/helmor" ]]; then
  echo "error: build did not produce $built_app" >&2
  exit "$build_status"
fi

if [[ "$build_status" -ne 0 ]]; then
  app_mtime=$(stat -f %m "$built_app" 2>/dev/null || echo 0)
  if [[ "$app_mtime" -lt "$build_started_at" ]]; then
    echo "error: tauri build failed and the app bundle was not freshly produced" >&2
    exit "$build_status"
  fi
  echo "warning: tauri build exited $build_status after producing the app bundle, likely because TAURI_SIGNING_PRIVATE_KEY is unset." >&2
fi

echo "==> Built bundle"
defaults read "$built_app/Contents/Info" CFBundleShortVersionString
defaults read "$built_app/Contents/Info" CFBundleIdentifier
du -sh "$built_app"

echo "==> Installing to $installed_app"
ditto "$built_app" "$installed_app"

echo "==> Ad-hoc signing installed app"
codesign --force --deep --options runtime --entitlements "$entitlements" --sign - "$installed_app"

echo "==> Verifying installed app"
codesign --verify --deep --strict --verbose=2 "$installed_app"
codesign -d --entitlements :- "$installed_app" >/dev/null
defaults read "$installed_app/Contents/Info" CFBundleShortVersionString
defaults read "$installed_app/Contents/Info" CFBundleIdentifier
du -sh "$installed_app"

if [[ -x "$installed_app/Contents/MacOS/helmor-cli" ]]; then
  echo "==> Installed app data info"
  "$installed_app/Contents/MacOS/helmor-cli" data info --json || true
fi

exit 0
