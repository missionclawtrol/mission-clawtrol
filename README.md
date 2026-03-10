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
git clone https://github.com/missionclawtrol/mission-clawtrol.git
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

## OpenClaw Agent Configuration

Agents are defined in your OpenClaw config file (`~/.openclaw/openclaw.json`) under the `agents` key. MC reads this config to know which agents are available for task assignment.

### Required Agents

MC's rules engine automatically triggers these two agents. They must exist in your config:

| Agent ID | Purpose | When it runs |
|----------|---------|-------------|
| `qa` | Reviews handoff notes and verifies done criteria | Every time a task moves to **Review** |
| `editor` | Reads the commit diff and updates PROJECT.md | Every time a task is marked **Done** |

Both agents use whatever model you configure. A fast/cheap model like Haiku works well — they do focused, narrow work. If an agent is unavailable, MC logs a warning and the task stays in its current state for manual review.

### Minimal Setup (just QA + Editor)

Add this to your `~/.openclaw/openclaw.json`:

```json
{
  "agents": {
    "list": [
      { "id": "qa", "name": "QA Reviewer", "model": "anthropic/claude-haiku-4-5" },
      { "id": "editor", "name": "Docs Editor", "model": "anthropic/claude-haiku-4-5" }
    ]
  }
}
```

### Full Team Setup

For a complete multi-agent team with an orchestrator + specialists, see the annotated example config:

📄 **[`docs/openclaw-agents-example.jsonc`](docs/openclaw-agents-example.jsonc)**

This example includes:
- **Orchestrator agent** — your main agent that delegates to others via `subagents.allowAgents`
- **QA + Editor** — required by MC's rules engine
- **Specialist agents** — builder, researcher, writer, analyst, designer (all optional)

Each agent entry supports these fields:

| Field | Required | Description |
|-------|----------|-------------|
| `id` | ✅ | Unique identifier (used in task assignment) |
| `name` | ✅ | Display name |
| `model` | ✅ | Model to use (e.g. `anthropic/claude-sonnet-4-6`) |
| `workspace` | | Agent's working directory |
| `default` | | Set `true` on your primary/orchestrator agent |
| `identity.name` | | Short name for UI display |
| `identity.emoji` | | Emoji shown in MC roster |
| `groupChat.mentionPatterns` | | `@mention` triggers in group chats |
| `subagents.allowAgents` | | Agent IDs this agent can spawn as subagents |

### Agent Defaults

Set defaults that apply to all agents unless overridden:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-sonnet-4-6",
        "fallbacks": ["openai/gpt-4o"]
      },
      "workspace": "/home/you/.openclaw/workspace",
      "subagents": {
        "maxConcurrent": 4
      }
    },
    "list": [ ... ]
  }
}
```

## PROJECT.md Conventions

Mission Clawtrol reads special fields from each project's `PROJECT.md` to unlock features:

| Field | Example | Enables |
|-------|---------|---------|
| `**Repo:** <url>` | `**Repo:** https://github.com/org/repo` | Clickable commit hash links on task cards |
| `**Report Channel:** <id>` | `**Report Channel:** C0XXXXXXXXX` | Send to Slack on Reports page |

A project is detected by the presence of a `PROJECT.md` file in its workspace folder (`~/.openclaw/workspace/<project-id>/PROJECT.md`).

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
