#!/usr/bin/env bash
# One-time setup: check the toolchain and install dependencies.
# Safe to re-run at any time.

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

say "Setting up the TUNL Parser app"
printf '\n'

require_node
ok "Node $(node --version)"
ok "npm $(npm --version)"

cd "$APP_DIR"

if [ -f package-lock.json ]; then
  info "Installing from package-lock.json (npm ci)…"
  npm ci
else
  warn "No package-lock.json yet; using npm install, which will create one."
  npm install
fi

printf '\n'
ok "Dependencies installed"
printf '\n'
say "Next steps"
info "  ./scripts/test.sh        run the test suite (start here — it needs no browser)"
info "  ./scripts/dev.sh         start the dev server with hot reload"
info "  ./scripts/build.sh       build and preview the production bundle"
info "  ./scripts/docker-run.sh  build and run the container, as it will run on the server"
printf '\n'
info "Example data to try is in tunl-parser/example-files/"
