# How Your Memory Works

*Human-Inspired Cognitive Memory System (HICMS) — your brain, explained.*

You have 5 memory types, modeled on how humans think:

| Memory | What It Is | Where It Lives | You Should... |
|--------|-----------|----------------|---------------|
| **Procedural** | Your skills & habits — how you do your job | SOUL.md, AGENTS.md, rules engine | Follow it instinctively |
| **Semantic** | Facts you've learned — codebase patterns, preferences, gotchas | LEARNED.md, company docs, PROJECT.md | **Update LEARNED.md after every task** |
| **Episodic** | Your experience — what happened on past tasks | MC task history (auto-injected) | Learn from successes and failures |
| **Short-term** | What you're working on right now | This context window | Focus — it's gone when you're done |
| **Prospective** | What's coming next — scheduled work, dependencies | Cron, heartbeats, task queue | Flag blockers and follow-ups |

## Where Mission Clawtrol Stores It

| Memory Type | MC Storage | Source / Endpoint |
|-------------|-----------|-------------------|
| **Procedural** | `SOUL.md` — agent identity, personality, standards | File: `agents/{id}/SOUL.md` |
| | `AGENTS.md` — operating rules, workspace conventions | File: `agents/{id}/AGENTS.md` |
| | Rules engine — event-driven workflow rules | `GET /api/rules` |
| | Workflow config — done criteria, task types | `GET /api/workflow` |
| **Semantic** | `LEARNED.md` — agent's personal cheat sheet | File: `agents/{id}/LEARNED.md` |
| | Company profile — name, industry, people | `GET /api/onboarding/company` |
| | Project context — stack, conventions, decisions | `GET /api/projects/:id` |
| | Business docs — SOPs, handbooks, uploads | `/business/` folder → RAG search |
| **Episodic** | Completed tasks — title, outcome, handoff notes | `GET /api/tasks?agentId={id}&status=done` |
| | Failed tasks — what went wrong | `GET /api/tasks?agentId={id}&status=failed` |
| | Project history — all tasks on same project | `GET /api/tasks?projectId={id}` |
| **Short-term** | Current task brief | `buildTaskPrompt()` at spawn |
| | Operational context — active work, blockers | `GET /api/context` |
| | Live conversation | LLM context window (ephemeral) |
| **Prospective** | Task dependencies — blocked/waiting tasks | `GET /api/tasks?status=blocked` |
| | Scheduled work | OpenClaw cron system |
| | Periodic checks | `HEARTBEAT.md` |

## The Memory API

All non-ephemeral memory assembled in one call at spawn:

```
GET /api/agent/:id/memory?taskId=xxx&projectId=yyy
```

Returns procedural + semantic + episodic + prospective, ready for context injection.

## The One Rule

> After every task, write what you learned to `LEARNED.md`. Future-you will thank you.

Patterns discovered. Gotchas hit. Preferences learned. Shortcuts found. If it would save time next time, write it down.

## How It Flows

```
Session Start → You receive: Procedural + Semantic + Episodic + Task Brief
During Work   → You use: Short-term (context) + RAG search (deep knowledge)
Task Complete → You update: LEARNED.md (semantic) + Handoff notes (episodic)
```

You get smarter with every task. That's the point.
