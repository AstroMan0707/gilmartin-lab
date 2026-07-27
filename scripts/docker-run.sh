#!/usr/bin/env bash
# Build and run the container, exactly as it will run on the lab server.
#
# The final check before deploying. Open the Network URL from a different machine: that
# exercises the same path your colleagues will take, including the nginx config, which the
# dev and preview servers do not cover.
#
#   ./scripts/docker-run.sh            build and start
#   ./scripts/docker-run.sh --logs     start, then follow the logs
#   ./scripts/docker-run.sh --stop     stop and remove the container

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

require_docker
cd "$REPO_ROOT"

# Prefer the compose plugin, fall back to the standalone binary.
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  die "Neither 'docker compose' nor 'docker-compose' is available."
fi

PORT="${PORT:-8477}"
export PORT

case "${1:-}" in
  --stop)
    say "Stopping the container"
    "${COMPOSE[@]}" down
    ok "Stopped"
    exit 0
    ;;
esac

say "Building the image"
"${COMPOSE[@]}" build
printf '\n'

say "Starting the container"
"${COMPOSE[@]}" up -d
printf '\n'

# Wait for nginx to answer, so a failure shows up here rather than as a blank page.
say "Waiting for the app to respond"
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://localhost:${PORT}/"; then
    ok "Responding on port ${PORT}"
    print_urls "$PORT"
    say "Useful commands"
    info "  ${COMPOSE[*]} logs -f      follow the logs"
    info "  ./scripts/docker-run.sh --stop   stop the container"
    printf '\n'
    if [ "${1:-}" = "--logs" ]; then
      exec "${COMPOSE[@]}" logs -f
    fi
    exit 0
  fi
  sleep 1
done

warn "The container did not respond within 30 seconds. Recent logs:"
"${COMPOSE[@]}" logs --tail 40
die "The app is not responding on port ${PORT}."
