#!/usr/bin/env bash
set -euo pipefail

# Mission Clawtrol — Update Script
# Pulls latest code from git and rebuilds. Safe for production droplets.
# Does NOT touch .env files, tokens, or local configuration.
#
# Usage: ./update.sh [--restart]
#   --restart  Also restart systemd services after update

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RESTART=false
if [[ "${1:-}" == "--restart" ]]; then
  RESTART=true
fi

echo "=== Mission Clawtrol Update ==="
echo "Directory: $SCRIPT_DIR"
echo ""

# 1. Pull latest code (fast-forward only — never rewrites history)
echo "→ Pulling latest from origin..."
git pull --ff-only origin main
echo ""

# 2. Install backend dependencies
echo "→ Installing backend dependencies..."
cd services/backend
npm install --production
cd "$SCRIPT_DIR"
echo ""

# 3. Install dashboard dependencies and rebuild
echo "→ Building dashboard..."
cd apps/dashboard
npm install
npm run build
cd "$SCRIPT_DIR"
echo ""

# 4. Restart services (if requested)
if $RESTART; then
  echo "→ Restarting services..."
  systemctl restart mission-clawtrol-backend
  systemctl restart mission-clawtrol-dashboard
  echo "  ✓ Services restarted"
  echo ""

  # Wait a moment and check status
  sleep 2
  echo "→ Service status:"
  systemctl is-active mission-clawtrol-backend && echo "  ✓ Backend: running" || echo "  ✗ Backend: not running"
  systemctl is-active mission-clawtrol-dashboard && echo "  ✓ Dashboard: running" || echo "  ✗ Dashboard: not running"
else
  echo "→ Skipping service restart (run with --restart to restart)"
fi

echo ""
echo "=== Update complete ==="
