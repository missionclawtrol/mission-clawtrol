# Mission Clawtrol 🦞

**AI-powered task management for multi-agent teams**

## What It Is

Mission Clawtrol is a kanban-style task management platform built for teams that use AI agents alongside human developers. It connects to [OpenClaw](https://github.com/openclaw/openclaw) to orchestrate AI agent workflows — assigning tasks, tracking progress, and automating quality assurance.

## Core Concepts

- **Work Orders** — Tasks flow through a kanban board: Backlog → Todo → In Progress → Review → Done
- **Agent Assignment** — AI agents (via OpenClaw) are spawned to work on tasks, tracked by session
- **Automated QA** — When a task moves to Review, a QA agent auto-spawns to verify the work (checks handoff notes, validates git commits, reviews diffs)
- **Webhook Notifications** — External integrations via signed webhooks for Slack, Discord, email, etc.
- **Cost Tracking** — Tracks AI cost, runtime, LOC changed, and estimated human-equivalent cost per task

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | SvelteKit + TypeScript + Tailwind CSS |
| Backend | Fastify + TypeScript |
| Database | SQLite (dev) / PostgreSQL (production) |
| Real-time | WebSocket |
| Auth | GitHub OAuth (disable with `DISABLE_AUTH=true` for local dev) |
| CI/CD | GitHub Actions → GitHub Container Registry |
| Deployment | Docker Compose |

## Architecture

```
mission-clawtrol/
├── apps/
│   └── dashboard/              # SvelteKit frontend (port 5173)
│       └── src/routes/         # Pages: Overview, Work Orders, Roster, etc.
├── services/
│   └── backend/                # Fastify API server (port 3001)
│       └── src/
│           ├── routes/         # REST API endpoints
│           ├── stage-agents/   # Automated QA agent dispatcher
│           ├── middleware/     # Auth, role-based permissions
│           └── db/             # Database abstraction (SQLite/Postgres)
├── .github/workflows/          # CI/CD pipeline
├── docker-compose.yml          # Local development
├── docker-compose.production.yml
└── .env.production.example     # Required environment variables
```

## Features

- 📋 **Kanban Board** — Drag-and-drop task management with 5 status columns
- 🤖 **Agent Orchestration** — Spawn and track AI agents per task
- 🔍 **Automated QA** — Stage agent reviews code on every review transition
- 👥 **Team Management** — Role-based access (Admin, Member, Viewer)
- 💬 **Task Comments** — Activity feed with QA review reports
- 📊 **Dashboard Analytics** — Charts, cost tracking, activity timeline
- 🔔 **Real-time Updates** — WebSocket-powered toasts and live board refresh
- 🔗 **Webhook System** — Signed webhook notifications for external integrations
- 🔐 **GitHub OAuth** — Authentication with role-based permissions
- 🐳 **Docker Ready** — Containerized for production deployment

## Quick Start

### Prerequisites
- Node.js 22+
- OpenClaw installed and running

### Local Development

```bash
git clone https://github.com/cgmartin0310/mission-clawtrol.git
cd mission-clawtrol

# Backend
cd services/backend
npm install
echo "DISABLE_AUTH=true" > .env
npm run dev    # port 3001

# Dashboard (new terminal)
cd apps/dashboard
npm install
npm run dev    # port 5173
```

Open http://localhost:5173

### Production (Docker)

```bash
cp .env.production.example .env.production
# Edit .env.production with your values
docker compose -f docker-compose.production.yml up -d
```

## API

All endpoints at `http://localhost:3001/api/`:

| Endpoint | Description |
|----------|-------------|
| `GET /health` | System status (DB, gateway, task counts) |
| `GET/POST /tasks` | Task CRUD |
| `PATCH /tasks/:id` | Update task (status, assignment, etc.) |
| `GET/POST /tasks/:id/comments` | Task comments |
| `GET/POST/PUT/DELETE /webhooks` | Webhook management |
| `GET /users` | Team members |
| `GET/PUT /settings` | App settings |
| `GET /audit` | Audit log |

## License

MIT

---

*Built by agents, for agents.* 🦞
