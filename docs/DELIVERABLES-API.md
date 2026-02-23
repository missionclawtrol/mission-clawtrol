# Deliverables API — Agent Guide

When you complete work, **drop a deliverable** so the user can see, review, and download what you produced.

Think of it as: *you finished the report, now put it on your manager's desk.*

---

## Quick Start

### Create a deliverable when your task is done

```bash
curl -s -X POST http://localhost:3001/api/deliverables \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "YOUR_TASK_ID",
    "title": "Q1 Market Research Report",
    "type": "markdown",
    "content": "# Q1 Market Research\n\n## Summary\n...",
    "agentId": "elon",
    "status": "review"
  }'
```

Set `status: "review"` when your work is ready for human review. The dashboard will highlight it.

---

## Deliverable Types

| type       | Use for                        |
|------------|-------------------------------|
| `markdown` | Reports, docs, analysis (default) |
| `text`     | Plain text output, logs        |
| `csv`      | Data tables, exports           |
| `html`     | Formatted web content          |
| `pdf`      | (Future — use markdown for now) |
| `other`    | Anything else                  |

---

## Status Flow

```
draft → review → approved
              ↓
           rejected
              ↓
      changes_requested → (you revise) → review
```

- **draft** — Work in progress, not ready for review
- **review** — Done, send it to the human's desk
- **approved** — Human signed off ✅
- **rejected** — Human rejected it ❌
- **changes_requested** — Human wants revisions; update and resubmit

---

## API Reference

### POST /api/deliverables
Create a deliverable.

```json
{
  "taskId": "string (required)",
  "title": "string (required)",
  "type": "markdown | text | csv | html | other",
  "content": "string — the actual file content",
  "filePath": "string — path on disk (alternative to content)",
  "agentId": "string — your agent ID",
  "projectId": "string — project ID",
  "status": "draft | review"
}
```

### POST /api/tasks/:taskId/deliverables
Alternate URL — same body, taskId comes from the URL:

```bash
curl -s -X POST http://localhost:3001/api/tasks/TASK_ID/deliverables \
  -H "Content-Type: application/json" \
  -d '{"title": "My Report", "type": "markdown", "content": "# Hello", "status": "review"}'
```

### PATCH /api/deliverables/:id
Update a deliverable after changes are requested:

```json
{
  "content": "# Revised Report\n\n...",
  "status": "review"
}
```

### GET /api/deliverables
List all deliverables. Supports filters:
- `?taskId=xxx` — for a specific task
- `?status=review` — pending review
- `?agentId=elon` — by agent

---

## Workflow Example

```bash
# 1. Start work — create a draft
curl -X POST http://localhost:3001/api/deliverables \
  -H "Content-Type: application/json" \
  -d '{"taskId":"abc123","title":"Analysis","type":"markdown","content":"# WIP","status":"draft"}'
# → {"id":"def456",...}

# 2. When done — update to review
curl -X PATCH http://localhost:3001/api/deliverables/def456 \
  -H "Content-Type: application/json" \
  -d '{"content":"# Final Analysis\n\nResults here...","status":"review"}'

# 3. Also mark your task as done
curl -X PATCH http://localhost:3001/api/tasks/abc123 \
  -H "Content-Type: application/json" \
  -d '{"status":"review","handoffNotes":"Deliverable def456 is ready for review."}'
```

---

## Best Practices

- **Always attach a deliverable** when your task produces output — never just dump it in handoff notes
- **Use `markdown` type** for anything text-based (reports, docs, drafts, analysis)
- **Set `status: "review"`** when submitting finished work — this triggers the dashboard notification
- **Include the deliverable ID in your handoff notes** so the human can find it easily
- **One deliverable per major output** — break large tasks into multiple deliverables if they produce separate artifacts (e.g., a report + a CSV data export)
