#!/usr/bin/env bash
# Linux/macOS companion of scripts/build-island-test.ps1 (which is Windows-only).
#
# Runs the same focused check sequence and writes logs plus hashes into a new
# artifacts/linux-island-topology-<timestamp>/ folder. It does NOT replace the
# Windows packaging route: packaging here is `npm run tauri build` (AppImage + .deb),
# NSIS is Windows-only, and a partial run is deliberately not named verification.txt.
#
# Usage:
#   bash scripts/build-island-test.sh [--resources <dir>] [--skip-private-resources]
#                                     [--browser] [--package] [--strict]
#
# Requires Node 20+; --package additionally requires Rust plus the Tauri Linux
# prerequisites (see docs/development.md). --browser requires a Chromium binary via
# BROWSER_BIN. Nothing is committed, pushed, reset or deleted; private resources are
# hash-checked before and after the run.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

resources=""
skip_private=0
run_browser=0
run_package=0
strict=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --resources) resources="$2"; shift 2 ;;
    --skip-private-resources) skip_private=1; shift ;;
    --browser) run_browser=1; shift ;;
    --package) run_package=1; shift ;;
    --strict) strict=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[[ -z "$resources" ]] && resources="$(cd "$root/../../resources" 2>/dev/null && pwd || echo "$root/../../resources")"

archive="$root/artifacts/linux-island-topology-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$archive"
log() { printf '%s\n' "$*"; }
failures=0

record() {
  local name="$1"; shift
  { local IFS=' '; log "> $*"; }
  "$@" >"$archive/$name.log" 2>&1
  local code=$?
  if [[ $code -eq 0 ]]; then
    log "PASS $name (log: $name.log)"
  else
    log "FAIL $name (exit $code; last line: $(tail -1 "$archive/$name.log"))"
    failures=$((failures + 1))
    [[ $strict -eq 1 ]] && { log "aborting (--strict)"; exit 1; }
  fi
}

git rev-parse HEAD >"$archive/baseline.txt"
git branch --show-current >"$archive/branch.txt"
git status --short >"$archive/worktree.txt"
git diff --binary HEAD -- . ':(exclude)artifacts/**' >"$archive/tracked-changes.patch"

# The same 19 focused npm commands as the Windows packaging script.
for check in test:contour-topology test:path-islands test:freehand-edit test:component-selection \
             test:camera-overlay test:apps test:vector test:interaction test:outline test:contour-offset \
             test:canvas-zoom test:file-drop test:paths test:history test:slot-features test:slot-worker \
             test:generators test:gcode i18n:check; do
  record "${check/:/-}" npm run "$check"
done
record outline-precision-60 node scripts/vector-offline-test.mjs scripts/outline-precision-study.ts

if [[ $skip_private -eq 0 ]]; then
  islands="$resources/inseln.kzb"
  frame="$resources/photoframe.kzb"
  if [[ ! -f "$islands" || ! -f "$frame" ]]; then
    log "SKIP private resources: $islands and $frame are required (use --skip-private-resources to state this explicitly)"
    failures=$((failures + 1))
  else
    sha256sum "$islands" "$frame" >"$archive/private-resource-sha256-before.txt"
    record path-islands-original-resource node scripts/vector-offline-test.mjs scripts/path-islands-test.ts "$islands"
    record extraction-original-resource node scripts/vector-offline-test.mjs scripts/island-geometry-resource-test.ts "$frame"
    record path-islands-performance node scripts/vector-offline-test.mjs scripts/path-islands-performance-study.ts "$islands"
    sha256sum "$islands" "$frame" >"$archive/private-resource-sha256-after.txt"
    if diff -q "$archive/private-resource-sha256-before.txt" "$archive/private-resource-sha256-after.txt" >/dev/null; then
      log "PASS private resources unchanged"
      cp "$archive/private-resource-sha256-after.txt" "$archive/private-resource-sha256.txt"
    else
      log "FAIL private resources changed"
      failures=$((failures + 1))
    fi
    if [[ $run_browser -eq 1 ]]; then
      export BROWSER_BIN="${BROWSER_BIN:-$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)}"
      if [[ -z "$BROWSER_BIN" ]]; then
        log "FAIL browser checks: no Chromium found, set BROWSER_BIN"
        failures=$((failures + 1))
      else
        log "using BROWSER_BIN=$BROWSER_BIN"
        record path-islands-browser-bundle node scripts/editor-resource-browser-fixture.mjs "$islands"
        record path-islands-browser node scripts/run-feature-browser.mjs artifacts/resource-browser runPathIslandResourceChecks
        record path-islands-browser-performance node scripts/run-feature-browser.mjs artifacts/resource-browser runPathIslandPerformanceChecks
        cp artifacts/resource-browser/runPathIslandResourceChecks-results.json \
           artifacts/resource-browser/runPathIslandPerformanceChecks-results.json "$archive/" 2>/dev/null
        record prototype-browser-bundle node scripts/editor-prototype-browser-fixture.mjs
        record outline-browser node scripts/run-feature-browser.mjs artifacts/local-prototypes/editor-browser runOutlinePrototypeChecks
        cp artifacts/local-prototypes/editor-browser/runOutlinePrototypeChecks-results.json "$archive/" 2>/dev/null
      fi
    else
      log "NOTE: browser checks skipped (add --browser). Skipping browser checks means they are unverified, not passed."
    fi
  fi
else
  log "NOTE: private resource checks skipped by --skip-private-resources; they are unverified, not passed."
fi

if [[ $run_package -eq 1 ]]; then
  if command -v cargo >/dev/null 2>&1; then
    record core-rust-tests npm run test:core
    record tauri-build npm run tauri build
  else
    log "FAIL packaging skipped: cargo/rustc not installed (see tools/setup-kizamubeam-linux.sh)"
    failures=$((failures + 1))
  fi
else
  log "NOTE: native packaging skipped (add --package). No executable was built in this run."
fi

git ls-files --cached --others --exclude-standard -- src scripts src-tauri package.json \
  package-lock.json vite.config.ts tsconfig.json index.html README.md AGENTS.md CONTRIBUTING.md \
  'docs/*.md' 'docs/**/*.md' | sort -u | while IFS= read -r file; do
  [[ -f "$file" ]] && printf '%s  %s\n' "$(sha256sum "$file" | cut -d' ' -f1)" "$file"
done >"$archive/source-sha256.txt"

{
  log ""
  log "Partial Linux check run: $archive"
  log "Failures: $failures"
  log "Skipped/unverified on purpose: browser checks and native packaging unless --browser/--package were given."
  log "This folder is NOT the Windows packaging verification and must not be cited as such."
} >"$archive/PARTIAL-RUN-NOTE.txt"

log ""
log "archive: $archive"
log "failures: $failures"
exit $((failures > 0 ? 1 : 0))
