# Mission Clawtrol 🦞

> AI-powered task management for multi-agent teams

Mission Clawtrol is a kanban-style task management platform for teams using AI agents alongside human developers. Built on [OpenClaw](https://github.com/openclaw/openclaw), it orchestrates AI workflows — assigning tasks, tracking progress, and automating QA.

![Status](https://img.shields.io/badge/status-beta-green)
![License](https://img.shields.io/badge/license-MIT-blue)

## Features

- 📋 **Kanban Board** — Drag-and-drop tasks across Backlog → Todo → In Progress → Review → Done
- 🤖 **Agent Orchestration** — Spawn AI agents to work on tasks, track by session
- 🔍 **Automated QA** — QA agent auto-reviews every task entering Review
- 👥 **Team Management** — GitHub OAuth with role-based access (Admin/Member/Viewer)
- 📊 **Analytics** — Cost tracking, LOC metrics, human-equivalent savings
- 🔔 **Real-time** — WebSocket toasts, live board refresh
- 🔗 **Webhooks** — Signed notifications for Slack, Discord, email
- 📅 **Due Dates** — Color-coded deadlines (overdue, due soon, future)
- 🎯 **Priority Sorting** — P0–P3 with colored badges, auto-sorted in columns

## Quick Start

```bash
# Clone
git clone https://github.com/cgmartin0310/mission-clawtrol.git
cd mission-clawtrol

# Backend (port 3001)
cd services/backend && npm install
echo "DISABLE_AUTH=true" > .env
npm run dev

# Dashboard (port 5173) — new terminal
cd apps/dashboard && npm install
npm run dev
```

Open http://localhost:5173

## OpenClaw Agent Setup

Mission Clawtrol integrates with [OpenClaw](https://github.com/openclaw/openclaw) agents to automate task creation, QA, and heartbeat checks. After starting the backend, add these two snippets to your agent files:

**In `AGENTS.md`** (task creation workflow section):
```
If Mission Clawtrol is running (http://localhost:3001), fetch workflow rules at session start:
`GET http://localhost:3001/api/workflow`
Follow the returned rules exactly for task creation, done criteria, and agent linking.
```

**In `HEARTBEAT.md`**:
```
## Mission Clawtrol Checks
If Mission Clawtrol is running (http://localhost:3001), fetch the current checklist:
`GET http://localhost:3001/api/workflow/heartbeat-prompt`
Follow it exactly.
```

That's it — the workflow rules live in Mission Clawtrol and are served at runtime. No other config needed. See [`skill/SKILL.md`](skill/SKILL.md) for the full skill reference.

## Production Deployment

```bash
cp .env.production.example .env.production
# Configure your environment variables
docker compose -f docker-compose.production.yml up -d
```

See [PROJECT.md](PROJECT.md) for full architecture, API docs, and configuration details.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | SvelteKit + TypeScript + Tailwind CSS |
| Backend | Fastify + TypeScript |
| Database | SQLite (dev) / PostgreSQL (prod) |
| Real-time | WebSocket |
| Auth | GitHub OAuth |
| CI/CD | GitHub Actions → ghcr.io |

## Screenshots

*Coming soon*

## License

MIT

---

*Built by agents, for agents.* 🦞
