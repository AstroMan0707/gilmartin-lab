#!/usr/bin/env bash
# Start the Vite dev server with hot reload.
#
# Binds to 0.0.0.0 so the dev server is reachable from another machine on the network. That
# matters before deploying: it lets you confirm the multi-user story works while you can
# still see errors in the terminal, rather than discovering a problem after the container
# is on the server.
#
# Any extra arguments are passed through to Vite, e.g. ./scripts/dev.sh --port 3000

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

require_node
require_deps

PORT="${PORT:-5173}"

say "Starting the dev server"
print_urls "$PORT"
info "Press Ctrl+C to stop."
printf '\n'

cd "$APP_DIR"
exec npm run dev -- --host 0.0.0.0 --port "$PORT" --strictPort "$@"
