#!/usr/bin/env bash
# ============================================================
# Mission Clawtrol — Self-Install Script
# Ubuntu/Debian · Node.js 22+ required · OpenClaw required
# ============================================================
# Usage:
#   bash install.sh                         # installs to /opt/mission-clawtrol
#   bash install.sh --dir /my/custom/path   # installs to a custom directory
#   bash install.sh --no-systemd            # skip systemd (run manually)
#
# What this does:
#   1. Clones the repo (or uses an existing clone)
#   2. npm install in backend + dashboard
#   3. Builds the dashboard
#   4. Reads your gateway token from ~/.openclaw/openclaw.json
#   5. Writes backend/.env with gateway token + config
#   6. Creates systemd services (mission-clawtrol-backend, mission-clawtrol-dashboard)
#   7. Starts the services
#   8. Prints the agent config JSON snippet to paste into openclaw.json
#   9. Prints the dashboard URL
# ============================================================

set -euo pipefail

# ── Colour helpers ──────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Colour

info()    { echo -e "${CYAN}[MC]${NC} $*"; }
success() { echo -e "${GREEN}[MC]${NC} ✅ $*"; }
warn()    { echo -e "${YELLOW}[MC]${NC} ⚠️  $*"; }
error()   { echo -e "${RED}[MC]${NC} ❌ $*" >&2; }
header()  { echo -e "\n${BOLD}${BLUE}═══════════════════════════════════════${NC}"; echo -e "${BOLD}${BLUE}  $*${NC}"; echo -e "${BOLD}${BLUE}═══════════════════════════════════════${NC}\n"; }

# ── Defaults ────────────────────────────────────────────────────────────────
INSTALL_DIR="/opt/mission-clawtrol"
REPO_URL="https://github.com/missionclawtrol/mission-clawtrol.git"
BACKEND_PORT=3001
DASHBOARD_PORT=3000
USE_SYSTEMD=true
HOME_DIR="${HOME:-/root}"
OPENCLAW_CONFIG="${HOME_DIR}/.openclaw/openclaw.json"

# ── Parse arguments ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --dir|-d)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --no-systemd)
      USE_SYSTEMD=false
      shift
      ;;
    --repo)
      REPO_URL="$2"
      shift 2
      ;;
    --backend-port)
      BACKEND_PORT="$2"
      shift 2
      ;;
    --dashboard-port)
      DASHBOARD_PORT="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: bash install.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --dir <path>           Install directory (default: /opt/mission-clawtrol)"
      echo "  --no-systemd           Skip systemd service creation"
      echo "  --repo <url>           Git repo URL (default: github.com/missionclawtrol/mission-clawtrol)"
      echo "  --backend-port <port>  Backend port (default: 3001)"
      echo "  --dashboard-port <port> Dashboard port (default: 3000)"
      exit 0
      ;;
    *)
      error "Unknown argument: $1"
      exit 1
      ;;
  esac
done

# ── Banner ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}"
echo "   __  __ _         _             ____ _               _             _ "
echo "  |  \/  (_)___ ___(_) ___  _ __ / ___| | __ ___      | |_ _ __ ___ | |"
echo "  | |\/| | / __/ __| |/ _ \| '_ \ |   | |/ _' \ \ /\ / / __| '__/ _ \| |"
echo "  | |  | | \__ \__ \ | (_) | | | | |__| | (_| |\ V  V /| |_| | | (_) | |"
echo "  |_|  |_|_|___/___/_|\___/|_| |_|\____|_|\__,_| \_/\_/  \__|_|  \___/|_|"
echo -e "${NC}"
echo -e "  ${BLUE}AI-powered task management for multi-agent teams${NC}"
echo ""

# ── Pre-flight checks ────────────────────────────────────────────────────────
header "Pre-flight Checks"

# Check Node.js
if ! command -v node &>/dev/null; then
  error "Node.js is not installed. Please install Node.js 22+ first."
  echo "  Visit: https://nodejs.org or run: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
  exit 1
fi
NODE_VERSION=$(node --version | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  warn "Node.js v${NODE_VERSION} detected. Node 22+ is recommended."
else
  success "Node.js v${NODE_VERSION}"
fi

# Check npm
if ! command -v npm &>/dev/null; then
  error "npm is not installed."
  exit 1
fi
success "npm $(npm --version)"

# Check git
if ! command -v git &>/dev/null; then
  error "git is not installed. Run: sudo apt-get install -y git"
  exit 1
fi
success "git $(git --version | awk '{print $3}')"

# Check OpenClaw
if ! command -v openclaw &>/dev/null; then
  warn "openclaw CLI not found in PATH. Gateway token extraction may fail."
  warn "Install OpenClaw from: https://github.com/openclaw/openclaw"
else
  success "openclaw $(openclaw --version 2>/dev/null || echo '(version unknown)')"
fi

# ── Read gateway token ───────────────────────────────────────────────────────
header "Reading OpenClaw Configuration"

GATEWAY_TOKEN=""
if [[ -f "$OPENCLAW_CONFIG" ]]; then
  # Try to extract gateway token using node (guaranteed to be available)
  GATEWAY_TOKEN=$(node -e "
    try {
      const fs = require('fs');
      const cfg = JSON.parse(fs.readFileSync('${OPENCLAW_CONFIG}', 'utf8'));
      // Look for gateway token in multiple possible locations
      const token =
        cfg?.gateway?.token ||
        cfg?.gateway?.operatorToken ||
        cfg?.gateway?.operator?.token ||
        '';
      process.stdout.write(token);
    } catch(e) {
      process.stdout.write('');
    }
  " 2>/dev/null || echo "")

  if [[ -n "$GATEWAY_TOKEN" ]]; then
    success "Gateway token found in ${OPENCLAW_CONFIG}"
  else
    warn "Could not extract gateway token from ${OPENCLAW_CONFIG}"
    warn "You may need to set GATEWAY_TOKEN manually in ${INSTALL_DIR}/services/backend/.env"
  fi
else
  warn "OpenClaw config not found at ${OPENCLAW_CONFIG}"
  warn "You'll need to set GATEWAY_TOKEN manually in ${INSTALL_DIR}/services/backend/.env after install"
fi

# ── Clone / update repo ──────────────────────────────────────────────────────
header "Installing Mission Clawtrol to ${INSTALL_DIR}"

if [[ -d "${INSTALL_DIR}/.git" ]]; then
  info "Existing installation found — pulling latest changes..."
  cd "$INSTALL_DIR"
  git pull --ff-only || {
    warn "git pull failed — continuing with existing code"
  }
  success "Repository updated"
elif [[ -d "${INSTALL_DIR}" && "$(ls -A "${INSTALL_DIR}" 2>/dev/null)" ]]; then
  warn "Directory ${INSTALL_DIR} exists and is not empty but not a git repo."
  warn "Please choose a different --dir or clear the directory."
  exit 1
else
  info "Cloning ${REPO_URL} → ${INSTALL_DIR}..."
  # Create parent directory if needed (requires sudo for /opt)
  if [[ "$INSTALL_DIR" == /opt/* ]] && [[ ! -w "$(dirname "$INSTALL_DIR")" ]]; then
    info "Creating ${INSTALL_DIR} (requires sudo)..."
    sudo mkdir -p "$INSTALL_DIR"
    sudo chown "$(whoami):$(whoami)" "$INSTALL_DIR"
  else
    mkdir -p "$INSTALL_DIR"
  fi
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
  success "Repository cloned"
fi

cd "$INSTALL_DIR"

# ── Install dependencies ─────────────────────────────────────────────────────
header "Installing Dependencies"

# Install root workspace deps (if monorepo)
if [[ -f "package.json" ]] && grep -q '"workspaces"' package.json 2>/dev/null; then
  info "Installing root workspace dependencies..."
  npm install --prefer-offline 2>&1 | tail -3
  success "Root dependencies installed"
fi

# Backend
BACKEND_DIR="${INSTALL_DIR}/services/backend"
if [[ -d "$BACKEND_DIR" ]]; then
  info "Installing backend dependencies..."
  cd "$BACKEND_DIR"
  npm install 2>&1 | tail -3
  success "Backend dependencies installed"
  cd "$INSTALL_DIR"
else
  error "Backend directory not found: ${BACKEND_DIR}"
  exit 1
fi

# Dashboard
DASHBOARD_DIR="${INSTALL_DIR}/apps/dashboard"
if [[ -d "$DASHBOARD_DIR" ]]; then
  info "Installing dashboard dependencies (including devDependencies)..."
  cd "$DASHBOARD_DIR"
  npm install --include=dev 2>&1 | tail -3
  success "Dashboard dependencies installed"
  cd "$INSTALL_DIR"
else
  error "Dashboard directory not found: ${DASHBOARD_DIR}"
  exit 1
fi

# ── Build dashboard ──────────────────────────────────────────────────────────
header "Building Dashboard"

cd "$DASHBOARD_DIR"
info "Building SvelteKit dashboard (this may take a minute)..."
npm run build 2>&1 | tail -5
success "Dashboard built"
cd "$INSTALL_DIR"

# ── Write backend .env ───────────────────────────────────────────────────────
header "Writing Backend Configuration"

ENV_FILE="${BACKEND_DIR}/.env"
OPENCLAW_JSON_PATH="${OPENCLAW_CONFIG}"

# Detect if an .env already exists — back it up
if [[ -f "$ENV_FILE" ]]; then
  cp "$ENV_FILE" "${ENV_FILE}.backup.$(date +%s)"
  info "Backed up existing .env to ${ENV_FILE}.backup.*"
fi

cat > "$ENV_FILE" << EOF
# Mission Clawtrol Backend — generated by install.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Server
PORT=${BACKEND_PORT}
NODE_ENV=production

# OpenClaw gateway WebSocket URL (default for local install)
GATEWAY_URL=ws://127.0.0.1:18789

# OpenClaw operator token — extracted from ~/.openclaw/openclaw.json
GATEWAY_TOKEN=${GATEWAY_TOKEN}

# Database path
DATABASE_PATH=${INSTALL_DIR}/data/mission-clawtrol.db

# Disable GitHub OAuth for local installs (set to false to enable)
DISABLE_AUTH=true

# Dashboard URL (for CORS)
DASHBOARD_URL=http://localhost:${DASHBOARD_PORT}
EOF

if [[ -n "$GATEWAY_TOKEN" ]]; then
  success "Backend .env written with gateway token"
else
  warn "Backend .env written — GATEWAY_TOKEN is empty, set it manually: ${ENV_FILE}"
fi

# Ensure data directory exists
mkdir -p "${INSTALL_DIR}/data"

# ── Build backend ─────────────────────────────────────────────────────────────
header "Building Backend"
cd "$BACKEND_DIR"
info "Compiling TypeScript..."
npm run build 2>&1 | tail -5
success "Backend compiled"
cd "$INSTALL_DIR"

# ── Systemd services ─────────────────────────────────────────────────────────
if [[ "$USE_SYSTEMD" == "true" ]]; then
  header "Creating Systemd Services"

  NODE_BIN=$(which node)
  CURRENT_USER=$(whoami)

  # Backend service
  BACKEND_SERVICE_FILE="/etc/systemd/system/mission-clawtrol-backend.service"
  info "Creating backend service: mission-clawtrol-backend"
  sudo tee "$BACKEND_SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=Mission Clawtrol Backend API
After=network.target
Wants=network.target

[Service]
Type=simple
User=${CURRENT_USER}
WorkingDirectory=${BACKEND_DIR}
ExecStart=${NODE_BIN} dist/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mc-backend

# Environment
EnvironmentFile=${ENV_FILE}

[Install]
WantedBy=multi-user.target
EOF

  # Dashboard service (SvelteKit adapter-node)
  DASHBOARD_SERVICE_FILE="/etc/systemd/system/mission-clawtrol-dashboard.service"
  info "Creating dashboard service: mission-clawtrol-dashboard"

  # SvelteKit adapter-node outputs to build/index.js
  DASHBOARD_BUILD_ENTRY="${DASHBOARD_DIR}/build/index.js"

  sudo tee "$DASHBOARD_SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=Mission Clawtrol Dashboard
After=network.target mission-clawtrol-backend.service
Wants=mission-clawtrol-backend.service

[Service]
Type=simple
User=${CURRENT_USER}
WorkingDirectory=${DASHBOARD_DIR}
ExecStart=${NODE_BIN} build/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mc-dashboard

# Environment
Environment=PORT=${DASHBOARD_PORT}
Environment=NODE_ENV=production
Environment=BACKEND_URL=http://localhost:${BACKEND_PORT}
Environment=PUBLIC_BACKEND_URL=http://localhost:${BACKEND_PORT}

[Install]
WantedBy=multi-user.target
EOF

  # Reload and start
  info "Reloading systemd daemon..."
  sudo systemctl daemon-reload

  info "Enabling services to start on boot..."
  sudo systemctl enable mission-clawtrol-backend.service
  sudo systemctl enable mission-clawtrol-dashboard.service

  info "Starting services..."
  sudo systemctl restart mission-clawtrol-backend.service
  sudo systemctl restart mission-clawtrol-dashboard.service

  # Brief wait then check status
  sleep 3

  BACKEND_STATUS=$(systemctl is-active mission-clawtrol-backend.service 2>/dev/null || echo "unknown")
  DASHBOARD_STATUS=$(systemctl is-active mission-clawtrol-dashboard.service 2>/dev/null || echo "unknown")

  if [[ "$BACKEND_STATUS" == "active" ]]; then
    success "Backend service is running (port ${BACKEND_PORT})"
  else
    warn "Backend service status: ${BACKEND_STATUS}"
    warn "Check logs: sudo journalctl -u mission-clawtrol-backend -n 50"
  fi

  if [[ "$DASHBOARD_STATUS" == "active" ]]; then
    success "Dashboard service is running (port ${DASHBOARD_PORT})"
  else
    warn "Dashboard service status: ${DASHBOARD_STATUS}"
    warn "Check logs: sudo journalctl -u mission-clawtrol-dashboard -n 50"
  fi

else
  # No systemd — print manual start instructions
  header "Manual Start Instructions (--no-systemd)"
  echo "  Start the backend:"
  echo "    cd ${BACKEND_DIR} && npm start"
  echo ""
  echo "  Start the dashboard:"
  echo "    cd ${DASHBOARD_DIR} && node build/index.js"
  echo ""
fi

# ── Agent config snippet ─────────────────────────────────────────────────────
header "🤖 Agent Configuration Snippet"

MC_WORKSPACE="${HOME_DIR}/.openclaw"

cat << 'SNIPPET_BANNER'
Paste the following into the "agents" → "list" array in ~/.openclaw/openclaw.json,
then run:   openclaw gateway restart

SNIPPET_BANNER

# Generate the JSON snippet using node (guarantees valid JSON)
node -e "
const HOME = process.env.HOME || '/root';
const agents = [
  {
    id: 'manager',
    name: 'Henry — Manager',
    workspace: \`\${HOME}/.openclaw/workspace-manager\`,
    model: 'anthropic/claude-sonnet-4-6',
    identity: { name: 'Henry', emoji: '🎯' },
    groupChat: { mentionPatterns: ['@henry', '@manager'] }
  },
  {
    id: 'builder',
    name: 'Elon — Builder',
    workspace: \`\${HOME}/.openclaw/workspace-builder\`,
    model: 'anthropic/claude-sonnet-4-6',
    identity: { name: 'Elon', emoji: '🔨' },
    groupChat: { mentionPatterns: ['@elon', '@builder'] }
  },
  {
    id: 'researcher',
    name: 'Marie — Researcher',
    workspace: \`\${HOME}/.openclaw/workspace-researcher\`,
    model: 'anthropic/claude-sonnet-4-6',
    identity: { name: 'Marie', emoji: '🔍' },
    groupChat: { mentionPatterns: ['@marie', '@researcher'] }
  },
  {
    id: 'writer',
    name: 'Ernest — Writer',
    workspace: \`\${HOME}/.openclaw/workspace-writer\`,
    model: 'anthropic/claude-sonnet-4-6',
    identity: { name: 'Ernest', emoji: '✍️' },
    groupChat: { mentionPatterns: ['@ernest', '@writer'] }
  },
  {
    id: 'analyst',
    name: 'Warren — Analyst',
    workspace: \`\${HOME}/.openclaw/workspace-analyst\`,
    model: 'anthropic/claude-sonnet-4-6',
    identity: { name: 'Warren', emoji: '📊' },
    groupChat: { mentionPatterns: ['@warren', '@analyst'] }
  },
  {
    id: 'designer',
    name: 'Steve — Designer',
    workspace: \`\${HOME}/.openclaw/workspace-designer\`,
    model: 'anthropic/claude-sonnet-4-6',
    identity: { name: 'Steve', emoji: '🎨' },
    groupChat: { mentionPatterns: ['@steve', '@designer'] }
  }
];
console.log(JSON.stringify(agents, null, 2));
"

echo ""
echo -e "${YELLOW}────────────────────────────────────────────────────────────────${NC}"
echo -e "${YELLOW}After pasting, run:  ${BOLD}openclaw gateway restart${NC}"
echo -e "${YELLOW}────────────────────────────────────────────────────────────────${NC}"

# ── Done ─────────────────────────────────────────────────────────────────────
header "🎉 Installation Complete!"

DASHBOARD_URL="http://localhost:${DASHBOARD_PORT}"

echo -e "  ${BOLD}Dashboard:${NC}     ${GREEN}${DASHBOARD_URL}${NC}"
echo -e "  ${BOLD}Backend API:${NC}   ${GREEN}http://localhost:${BACKEND_PORT}${NC}"
echo ""
if [[ "$USE_SYSTEMD" == "true" ]]; then
  echo -e "  ${BOLD}Service logs:${NC}"
  echo "    sudo journalctl -u mission-clawtrol-backend -f"
  echo "    sudo journalctl -u mission-clawtrol-dashboard -f"
  echo ""
  echo -e "  ${BOLD}Service control:${NC}"
  echo "    sudo systemctl restart mission-clawtrol-backend"
  echo "    sudo systemctl restart mission-clawtrol-dashboard"
fi
echo ""
echo -e "  ${BOLD}Next:${NC}"
echo "    1. Paste the agent snippet above into ~/.openclaw/openclaw.json"
echo "    2. Run: openclaw gateway restart"
echo "    3. Open ${DASHBOARD_URL}"
echo "    4. Go to Roster → click 'Create Team' to finish workspace setup"
echo ""
