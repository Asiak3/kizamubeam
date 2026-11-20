#!/bin/sh
# Standalone std-only native streamer tests: no Tauri build or hardware access.
set -eu
cd "$(dirname "$0")/.."
test "${LASERBEAM_OFFLINE:-}" = 1 || { echo 'Set LASERBEAM_OFFLINE=1'; exit 1; }
out=$(mktemp -d "${TMPDIR:-/tmp}/kizamubeam-fire-stream.XXXXXX")
trap 'rm -f "$out/tests"; rmdir "$out"' EXIT
rustc --edition=2021 --test src-tauri/src/stream.rs -o "$out/tests"
"$out/tests" "${1:-fire_stop_}"
