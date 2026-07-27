#!/usr/bin/env bash
# Run the test suite.
#
# This is the script to run after any change to the parser. The tests check the parsed output
# against the real ABET exports in tunl-parser/example-files/ cell by cell, so a regression in
# the parsing or the latency alignment fails here rather than turning up in someone's figure.
#
# Pass --watch to re-run on save, or a path to run one file:
#   ./scripts/test.sh --watch
#   ./scripts/test.sh src/parse

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

require_node
require_deps

cd "$APP_DIR"

WATCH=0
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --watch|-w) WATCH=1 ;;
    *) ARGS+=("$arg") ;;
  esac
done

# Also typecheck: a type error that tsc catches would otherwise only surface at build time.
say "Typechecking"
npx tsc -b
ok "No type errors"
printf '\n'

say "Running tests"
if [ "$WATCH" -eq 1 ]; then
  exec npx vitest "${ARGS[@]+"${ARGS[@]}"}"
else
  exec npx vitest run "${ARGS[@]+"${ARGS[@]}"}"
fi
