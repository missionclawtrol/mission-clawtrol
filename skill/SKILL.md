# Mission Clawtrol

Mission Clawtrol is your project and task management system. It tracks tasks, agents, projects, and work orders.

**API:** http://localhost:3001

## On Session Start

**Step 1 — Get full situational awareness:**

```
GET http://localhost:3001/api/context
```

This returns all active projects with their current tasks, recent completions, blockers, and next-up items. Review this before doing anything else so you know where things stand.

**Step 2 — Fetch and follow your workflow rules:**

```
GET http://localhost:3001/api/workflow
```

These rules govern:
- How to create tasks and link agent sessions
- What qualifies a task as "done" (done criteria)
- How to conduct heartbeat checks

Follow the returned rules exactly. They take precedence over any hardcoded instructions in agent files.

## On Every Heartbeat

Fetch and follow the current heartbeat checklist:

```
GET http://localhost:3001/api/workflow/heartbeat-prompt
```

## First-time Setup

After installing Mission Clawtrol, add these two lines to your agent files so it's automatically used:

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

That's it. The workflow rules themselves live in Mission Clawtrol — no other configuration needed.

---

## Task API Quick Reference

- `GET /api/tasks` — all tasks
- `GET /api/tasks?status=review` — tasks awaiting review
- `GET /api/tasks?status=in-progress` — active tasks
- `POST /api/tasks` — create task (always include projectId)
- `PATCH /api/tasks/:id` — update task (status, agentId, sessionKey, model, handoffNotes)
- `POST /api/tasks/:id/comments` — add comment
