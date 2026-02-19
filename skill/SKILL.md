# Mission Clawtrol

Mission Clawtrol is your project and task management system. It tracks tasks, agents, projects, and work orders.

**API:** http://localhost:3001

## On Session Start

Fetch and follow your workflow rules:

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

## Task API Quick Reference

- `GET /api/tasks` — all tasks
- `GET /api/tasks?status=review` — tasks awaiting review
- `GET /api/tasks?status=in-progress` — active tasks
- `POST /api/tasks` — create task (always include projectId)
- `PATCH /api/tasks/:id` — update task (status, agentId, sessionKey, model, handoffNotes)
- `POST /api/tasks/:id/comments` — add comment
