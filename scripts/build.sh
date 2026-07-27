#!/usr/bin/env bash
# Build the production bundle and serve it locally.
#
# Worth doing before every deploy, because this is the only way to exercise the minified code
# that will actually run on the server. The figure export is the part most likely to behave
# differently here than in dev: it manipulates PNG bytes and serialises SVG, so re-test a
# 600 DPI export and an Excel export against this preview rather than trusting the dev server.
#
# Pass --no-preview to build only.

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

require_node
require_deps

PORT="${PORT:-4173}"
PREVIEW=1
for arg in "$@"; do
  [ "$arg" = "--no-preview" ] && PREVIEW=0
done

cd "$APP_DIR"

say "Building for production"
npm run build
printf '\n'
ok "Built to app/dist"

if [ "$PREVIEW" -eq 0 ]; then
  exit 0
fi

printf '\n'
say "Serving the production build"
print_urls "$PORT"
say "Check before deploying:"
info "  • load all three files from tunl-parser/example-files/ at once"
info "  • export a figure at 600 DPI and confirm the file opens sharp"
info "  • export the Excel workbook and confirm all four sheets are present"
printf '\n'

exec npm run preview -- --host 0.0.0.0 --port "$PORT" --strictPort
