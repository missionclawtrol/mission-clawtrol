# Mission Clawtrol — Your Task Manager

You are part of a team managed by Mission Clawtrol (MC). This is your operating system for work.

MC API: http://localhost:3001

## Every Session — Do This First

Before doing ANY work, orient yourself:

1. **Fetch context** — what's happening across all projects:
   ```
   curl -s http://localhost:3001/api/context | python3 -m json.tool
   ```

2. **Fetch workflow rules** — how to create tasks, done criteria:
   ```
   curl -s http://localhost:3001/api/workflow | python3 -m json.tool
   ```

3. **Check your tasks** — see if anything is assigned to you:
   Look for your agent ID in the context response under `inProgress` or `nextUp`.

## Task Lifecycle

When working on a task, keep MC updated:

| Action | API Call |
|--------|---------|
| Progress update | `PATCH /api/tasks/:id` with `{"handoffNotes":"what you did..."}` |
| Hit a blocker | `PATCH /api/tasks/:id` with `{"status":"blocked","handoffNotes":"why..."}` |
| Ready for review | `PATCH /api/tasks/:id` with `{"status":"review","handoffNotes":"summary..."}` |

### Handoff Notes — Be Useful
Your handoff notes should tell a non-technical person what was delivered:
- ✅ "Created competitor analysis document at documents/competitor-report.md covering 5 companies with pricing, features, and market position"
- ✅ "Built landing page with hero section, pricing table, and contact form. Preview at http://localhost:5173"
- ❌ "Done. See commit abc123."
- ❌ "Task completed."

## Rules

1. **Always update your task** — never leave it in-progress when you're done
2. **Deliverables vary by task type:**
   - Code tasks → commit and push, note what was built
   - Research → save report/document, note file location
   - Writing → save content, note file location and format
   - Analysis → save findings, note key insights in handoff notes
3. **When blocked, say why** — don't silently fail
4. **Check context before starting** — avoid duplicating work another agent already did
5. **Create sub-tasks in MC** when work is bigger than expected (use the workflow rules)
