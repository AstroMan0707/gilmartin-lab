# Shared helpers for the dev scripts. Sourced, not executed.
# shellcheck shell=bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$REPO_ROOT/app"

# Colours only when writing to a terminal, so piping to a file stays clean.
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; RED=''; GREEN=''; YELLOW=''; BLUE=''; RESET=''
fi

say()  { printf '%s\n' "${BOLD}$*${RESET}"; }
info() { printf '%s\n' "${DIM}$*${RESET}"; }
ok()   { printf '%s\n' "${GREEN}✓${RESET} $*"; }
warn() { printf '%s\n' "${YELLOW}!${RESET} $*"; }
die()  { printf '%s\n' "${RED}✗${RESET} $*" >&2; exit 1; }

require_node() {
  command -v node >/dev/null 2>&1 || die \
    "Node.js is not installed. Install Node 20 or newer from https://nodejs.org and try again."

  local major
  major="$(node --version | sed 's/^v//; s/\..*//')"
  if [ "$major" -lt 20 ]; then
    die "Node $(node --version) is too old. This project needs Node 20 or newer."
  fi
}

require_deps() {
  if [ ! -d "$APP_DIR/node_modules" ]; then
    die "Dependencies are not installed yet. Run ./scripts/setup.sh first."
  fi
}

require_docker() {
  command -v docker >/dev/null 2>&1 || die \
    "Docker is not installed. See https://docs.docker.com/get-docker/"
  docker info >/dev/null 2>&1 || die \
    "Docker is installed but not running. Start Docker and try again."
}

# Best-effort LAN address, so the script can print a URL colleagues can actually open.
lan_ip() {
  if command -v hostname >/dev/null 2>&1 && hostname -I >/dev/null 2>&1; then
    hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.' | grep -v '^127\.' | head -1
  elif command -v ipconfig >/dev/null 2>&1; then
    ipconfig getifaddr en0 2>/dev/null || true
  fi
}

is_wsl() {
  grep -qi microsoft /proc/version 2>/dev/null
}

print_urls() {
  local port="$1" ip
  ip="$(lan_ip || true)"
  printf '\n'
  say "  Local:   ${BLUE}http://localhost:${port}${RESET}"

  if [ -z "$ip" ]; then
    warn "  Could not work out this machine's network address; only localhost is shown."
    printf '\n'
    return
  fi

  if is_wsl; then
    # On WSL2 the Linux side sits behind a NAT on a virtual switch, so this address is
    # reachable from the Windows host but not from anything else on the network. Printing it
    # as "Network" would send someone hunting a problem that is not in the app.
    say "  Windows host: ${BLUE}http://${ip}:${port}${RESET}  (also http://localhost:${port})"
    printf '\n'
    warn "  This is WSL2, so ${ip} is a WSL-internal address."
    info "  Other machines on the network cannot reach it without extra Windows setup."
    info "  For a shared deployment, run the container on a Linux host on the network — then"
    info "  the published port is reachable directly with no extra steps."
    info "  To share from this Windows machine instead, either:"
    info "    • enable mirrored networking (Windows 11): put the following in %UserProfile%\\.wslconfig"
    info "        [wsl2]"
    info "        networkingMode=mirrored"
    info "      then run 'wsl --shutdown' and start again; or"
    info "    • forward the port, in an elevated PowerShell (redo after each reboot, because"
    info "      the WSL address changes):"
    info "        netsh interface portproxy add v4tov4 listenport=${port} listenaddress=0.0.0.0 \\"
    info "          connectport=${port} connectaddress=${ip}"
    info "        New-NetFirewallRule -DisplayName 'TUNL Parser ${port}' -Direction Inbound \\"
    info "          -LocalPort ${port} -Protocol TCP -Action Allow"
  else
    say "  Network: ${BLUE}http://${ip}:${port}${RESET}"
    info "  Open the Network URL from another machine to check it works for your colleagues."
  fi
  printf '\n'
}
