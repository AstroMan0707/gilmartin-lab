#!/usr/bin/env bash
# Drive the built app in a real browser, end to end.
#
# Builds, serves the production bundle, then walks the path a lab member takes: load all three
# example sessions plus the Rat Info sheet, build every chart type, edit custom latency ranges,
# and export a 600 DPI figure and the Excel workbook. Exports are checked by inspecting the
# downloaded bytes — a figure that quietly came out at 96 DPI would pass a click-only test.
#
# Screenshots and downloaded files are left in app/e2e/artifacts for inspection.
#
#   ./scripts/e2e.sh                    build, serve, run
#   ./scripts/e2e.sh http://host:8477   run against an already-running instance

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

require_node
require_deps

cd "$APP_DIR"

# Playwright needs its own Chromium. The distro's /usr/bin/chromium-browser is often a snap
# wrapper, and snap's private /tmp hides downloaded files from the test process, which looks
# exactly like a broken export but is not one.
if [ ! -d "$HOME/.cache/ms-playwright" ]; then
  say "Downloading the browser Playwright uses (one time, about 115 MB)"
  npx playwright install chromium
  printf '\n'
fi

TARGET="${1:-}"
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [ -z "$TARGET" ]; then
  say "Building for production"
  npm run build >/dev/null
  ok "Built"

  PORT="${PORT:-4173}"
  TARGET="http://127.0.0.1:${PORT}"

  say "Serving the production build on port ${PORT}"
  npx vite preview --host 127.0.0.1 --port "$PORT" --strictPort >/tmp/tunl-preview.log 2>&1 &
  SERVER_PID=$!

  for _ in $(seq 1 30); do
    curl -fsS -o /dev/null "$TARGET/" && break
    sleep 1
  done
  curl -fsS -o /dev/null "$TARGET/" || die "The preview server did not start. See /tmp/tunl-preview.log"
  ok "Serving"
fi

printf '\n'
say "Walking through the app at ${TARGET}"
printf '\n'

rm -rf e2e/artifacts
exec node e2e/walkthrough.mjs "$TARGET"
