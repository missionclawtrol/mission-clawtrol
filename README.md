# Mission Clawtrol 🦞

> Command center for your OpenClaw agents

Mission Clawtrol is a multi-agent management dashboard for [OpenClaw](https://github.com/openclaw/openclaw). Monitor agents, track projects, manage approvals, and coordinate your AI workforce from a single interface.

![Status](https://img.shields.io/badge/status-in%20development-yellow)
![License](https://img.shields.io/badge/license-MIT-blue)

## Features

- 🤖 **Agent Monitoring** — Real-time status of all agents
- 📁 **Project Management** — Track agent assignments per project
- 📊 **Task Tracking** — Parallel and sequential task visualization
- ✅ **Approval Queue** — Human-in-the-loop for sensitive actions
- 🔔 **Alerts** — Browser/audio notifications when agents need attention
- 💬 **Activity Feed** — Live cross-agent communication log
- 🌳 **Agent Tree** — Hierarchical view grouped by project

## Screenshots

*Coming soon*

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | SvelteKit + TypeScript + Tailwind CSS |
| Backend | Fastify + TypeScript |
| Real-time | WebSocket |
| Data | OpenClaw sessions + workspace files |

## Quick Start

### Prerequisites

- Node.js 20+
- OpenClaw installed and running
- npm or pnpm

### Installation

```bash
git clone https://github.com/cgmartin0310/mission-clawtrol.git
cd mission-clawtrol

# Install frontend dependencies
cd apps/dashboard && npm install

# Install backend dependencies
cd ../services/backend && npm install
```

### Running

```bash
# Terminal 1 - Frontend (port 5173)
cd apps/dashboard
npm run dev

# Terminal 2 - Backend (port 3001)
cd services/backend
npm run dev
```

Open http://localhost:5173

## Project Structure

```
mission-clawtrol/
├── apps/
│   └── dashboard/          # SvelteKit frontend
│       └── src/
│           └── routes/     # Pages (Overview, Monitor, Approvals, etc.)
├── services/
│   └── backend/            # Fastify API server
│       └── src/
│           └── routes/     # API endpoints
├── docs/                   # Documentation
├── PROJECT.md              # Project goals and context
├── STATUS.md               # Current status
└── HANDOFF.md              # Task assignments
```

## Roadmap

- [x] Project scaffold
- [x] Frontend UI (all tabs)
- [x] Backend API structure
- [ ] Connect to OpenClaw sessions
- [ ] Real-time WebSocket updates
- [ ] Approval workflow
- [ ] Alert system
- [ ] Multi-host support

## Inspiration

- [agent-commander](https://github.com/cvsloane/agent-commander) — Session management patterns
- [multi-agent-verse](https://github.com/diegopacheco/multi-agent-verse) — Task orchestration UI

## License

MIT

---

*Built with 🦞 by OpenClaw agents*
