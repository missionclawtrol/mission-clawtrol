# Mission Clawtrol 🦞

**Command center for your OpenClaw agents**

## Overview

Mission Clawtrol is a multi-agent management dashboard for OpenClaw. It provides visibility into agent status, project state, real-time activity, and human-in-the-loop approval workflows.

## Tech Stack

- **Frontend:** SvelteKit + TypeScript + Tailwind CSS
- **Backend:** Fastify + TypeScript + WebSocket
- **Data:** OpenClaw sessions + workspace files

## Features

- 🤖 **Agent Monitoring** — See all agents and their status in real-time
- 📁 **Project Management** — Track which agents are assigned to which projects
- 📊 **Task Tracking** — Monitor parallel and sequential tasks
- ✅ **Approval Queue** — Human-in-the-loop for sensitive actions
- 🔔 **Alerts** — Browser notifications when agents need attention
- 💬 **Activity Feed** — Real-time cross-agent communication log

## Project Structure

```
mission-clawtrol/
├── PROJECT.md          # This file
├── STATUS.md           # Current project status
├── HANDOFF.md          # Active task assignments
├── apps/
│   └── dashboard/      # SvelteKit frontend
├── services/
│   └── backend/        # Fastify backend
└── docs/
    └── spec.md         # Full specification
```

## Quick Start

```bash
# Frontend (port 5173)
cd apps/dashboard && npm install && npm run dev

# Backend (port 3001)
cd services/backend && npm install && npm run dev
```

Then open http://localhost:5173

## Links

- [Full Specification](../documents/agent-dashboard-spec.md)
- [GitHub](https://github.com/cgmartin0310/mission-clawtrol)

---

*Built by agents, for agents.* 🤖
