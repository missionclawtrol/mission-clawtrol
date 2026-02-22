# Agent Memory Architecture

*A cognitive memory system for AI agents, modeled on human memory types.*

---

## Overview

Mission Clawtrol agents operate with five memory types, mirroring how humans encode, store, and retrieve information. Each type has a distinct purpose, storage mechanism, access pattern, and scope.

### Memory Types at a Glance

| Type | Purpose | Storage | Access | Scope |
|---|---|---|---|---|
| **Procedural** | How to do things | Markdown files | Load at spawn | Agent / Global |
| **Semantic** | Facts & knowledge | Markdown + RAG | Search at spawn + on-demand | Agent / Project / Global |
| **Episodic** | What happened before | SQLite (tasks DB) | Query at spawn | Agent / Project |
| **Short-term** | What's relevant now | LLM context window | During session | Task |
| **Prospective** | What to do later | SQLite + Cron | Scheduled triggers | Agent / Global |

### Scope Definitions

- **Global** — Shared across all agents. Company info, industry knowledge, team-wide rules.
- **Project** — Specific to a project. Stack decisions, conventions, project history.
- **Agent** — Specific to one agent. Their role, learned preferences, personal task history.
- **Task** — Specific to the current task. Requirements, conversation, files being edited.

---

## 1. Procedural Memory

> "How I do my job — the stuff I do without thinking."

### What It Contains

| Content | Scope | Source |
|---|---|---|
| Role definition, personality, standards | Agent | `SOUL.md` |
| Operating rules, workspace conventions | Agent | `AGENTS.md` |
| Workflow patterns (branch → build → test → commit) | Global | Rules engine |
| Done criteria per task type | Global | MC workflow config |
| Company processes ("all posts go through Ernest") | Global | Business knowledge |
| Tool usage patterns ("use MC API, not sessions_spawn") | Global | `AGENTS.md` |
| Rule actions ("when PR ready → run tests → update task") | Agent | Rules engine |

### Storage

**Markdown files** — rarely changes, small enough to load whole.

- `SOUL.md` — agent identity and standards (per agent workspace)
- `AGENTS.md` — operating rules (per agent workspace)
- Rules engine — event-driven rules stored in MC database

### Access Pattern

- **When:** Load entirely at spawn time
- **How:** Read files directly; rules injected via `/api/agent/:id/memory → procedural`
- **Updates:** Manual (human or CSO edits files); rules via dashboard

### Why Markdown

Procedural memory is small, stable, and needs to be human-editable. No search required — agents read the whole thing. Markdown is the right fit.

---

## 2. Semantic Memory

> "Facts I know — about the company, the projects, the domain, the people."

### What It Contains

| Content | Scope | Source |
|---|---|---|
| Company profile (what we do, customers, values) | Global | Onboarding page |
| Industry/domain knowledge | Global | Uploaded docs, research |
| Project facts (stack, repo, conventions, key decisions) | Project | `PROJECT.md`, project docs |
| People (who's who, preferences, communication style) | Global | `USER.md`, onboarding |
| Tool/service credentials and configs | Global | Business knowledge base |
| Learned facts from past work | Agent | `LEARNED.md` |
| Product specs, SOPs, handbooks | Global | Uploaded docs |
| Competitor intelligence | Global | Research outputs |

### Storage

**Markdown files + RAG (vector search)**

- `LEARNED.md` — per-agent cheat sheet (agent workspace)
- `/business/` — company knowledge base (global)
  - `handbook/` — company docs, SOPs
  - `training/` — onboarding materials
  - `examples/` — reference work, templates
- `PROJECT.md` — per-project facts
- Uploaded documents — PDFs, docs converted to markdown

### Access Pattern

- **When:** Spawn time (inject summary) + on-demand during session (RAG search)
- **How:** 
  - Spawn: `/api/agent/:id/memory → semantic` returns a curated summary
  - Runtime: OpenClaw `memory_search` over indexed files for specific questions
- **Updates:** 
  - Agent writes to `LEARNED.md` after completing tasks
  - Human updates via onboarding page or file uploads
  - Research agent outputs feed back into knowledge base

### Why RAG

Semantic memory grows unbounded. A company might upload 500 pages of docs. You can't stuff that into a prompt. RAG lets agents ask "what's our refund policy?" and get the relevant chunk without burning context window.

OpenClaw already provides this:
- Vector embeddings over markdown files (`memorySearch`)
- Hybrid search (BM25 + vector) for both semantic and keyword queries
- `extraPaths` config to index folders outside the default workspace

**Implementation:** Point `memorySearch.extraPaths` at `/business/` and project doc folders. Onboarding file uploads go into `/business/`. OpenClaw indexes them automatically.

---

## 3. Episodic Memory

> "What happened before — my past experiences and their outcomes."

### What It Contains

| Content | Scope | Source |
|---|---|---|
| Completed tasks (title, description, outcome) | Agent | MC tasks DB |
| Handoff notes from past work | Agent | MC tasks DB |
| Tasks completed by others on same project | Project | MC tasks DB |
| Failures and what went wrong | Agent | MC tasks DB (failed/cancelled) |
| Review feedback received | Agent | MC task comments |

### Storage

**SQLite (MC's existing task database)**

Episodic memory is already captured — every task in MC has:
- `id`, `title`, `description`, `type`, `priority`
- `agentId` — who did it
- `projectId` — which project
- `status` — outcome (done, failed, cancelled)
- `handoffNotes` — what the agent reported on completion
- `comments` — feedback and discussion
- `createdAt`, `updatedAt` — when

No new storage needed. Just smarter queries.

### Access Pattern

- **When:** Spawn time (inject recent history)
- **How:** `/api/agent/:id/memory → episodic` returns:
  - Last N tasks completed by this agent (default: 10)
  - Last N tasks completed by any agent on the same project as the current task (default: 5)
  - Any failed/cancelled tasks on the current project (learn from failures)
- **Filters:** By agent, project, time range, status
- **Updates:** Automatic — tasks complete, DB updates, next spawn gets the history

### Why SQLite

Episodic memory is structured data with clear relationships (agent → task → project). SQL queries are perfect:
```sql
SELECT * FROM tasks 
WHERE agentId = 'elon' AND status = 'done' 
ORDER BY updatedAt DESC LIMIT 10
```
RAG would be overkill here. You don't need semantic search to find "Elon's last 5 tasks."

---

## 4. Short-term / Working Memory

> "What I'm holding in my head right now to do this job."

### What It Contains

| Content | Scope | Source |
|---|---|---|
| Current task brief and requirements | Task | MC task prompt |
| Active conversation / chat history | Task | LLM context window |
| Files currently being read/edited | Task | Tool calls in session |
| API responses and tool outputs | Task | Session context |
| Related in-progress tasks (parallel work awareness) | Project | `/api/context` |
| Current blockers | Project | `/api/context` |

### Storage

**LLM context window** — ephemeral, exists only during the session.

This is not persisted anywhere. It IS the session. When the session ends (or compacts), short-term memory is lost — which is why the other memory types exist.

### Access Pattern

- **When:** Continuously during the session
- **How:** 
  - Task prompt injected at spawn (from `buildTaskPrompt()`)
  - `/api/context` for operational awareness
  - Tool calls (file reads, API calls) during work
- **Updates:** Real-time as the agent works

### OpenClaw's Role

OpenClaw manages short-term memory through:
- Context window management
- Compaction (when context gets too large, summarize and reset)
- Pre-compaction memory flush (save important stuff before compacting)

MC's role is ensuring the right information gets loaded INTO short-term memory at spawn time — that's what the other memory types feed into.

---

## 5. Prospective Memory

> "Things I need to remember to do in the future."

### What It Contains

| Content | Scope | Source |
|---|---|---|
| Scheduled tasks and reminders | Agent / Global | Cron jobs |
| Periodic checks (email, calendar, mentions) | Global | Heartbeat (HEARTBEAT.md) |
| Deferred work ("after X finishes, start Y") | Project | MC task dependencies |
| Follow-ups ("check back on this in 2 days") | Agent | Cron / heartbeat state |
| Recurring reports or deliverables | Global | Cron jobs |

### Storage

**SQLite (task dependencies) + Cron (scheduled triggers) + Heartbeat state**

- Task dependencies in MC: `dependsOn` field, auto-unblock when prerequisite completes
- Cron: OpenClaw's built-in scheduler for time-based triggers
- `HEARTBEAT.md`: checklist for periodic checks
- `memory/heartbeat-state.json`: tracks what was last checked and when

### Access Pattern

- **When:** On schedule (cron), on heartbeat, or on task completion (dependency trigger)
- **How:** 
  - Cron fires → agent session starts → does the thing
  - Heartbeat fires → agent checks HEARTBEAT.md → acts if needed
  - Task completes → MC checks dependencies → unblocks next task
- **Updates:** Created via dashboard, API, or agent request ("remind me to...")

---

## API Design

### Primary Endpoint

```
GET /api/agent/:id/memory?taskId=xxx&projectId=yyy
```

Returns all non-ephemeral memory types assembled for spawn injection:

```json
{
  "procedural": {
    "role": "...",           // SOUL.md content
    "rules": [...],          // Active rules relevant to this agent
    "workflows": {...},      // Done criteria, workflow patterns
    "processes": [...]       // Company processes relevant to role
  },
  "semantic": {
    "company": {
      "profile": {...},      // Company name, industry, what we do
      "people": [...],       // Key people and preferences
      "credentials": [...]   // Tool access (if applicable)
    },
    "project": {
      "stack": "...",        // Tech stack, conventions
      "decisions": [...],    // Key architectural/business decisions
      "context": "..."       // PROJECT.md content
    },
    "learned": "...",        // LEARNED.md content (agent's cheat sheet)
    "domain": "..."          // Relevant domain knowledge summary
  },
  "episodic": {
    "myRecentTasks": [...],         // Last 10 tasks by this agent
    "projectRecentTasks": [...],    // Last 5 tasks on this project by anyone
    "failures": [...]               // Failed/cancelled tasks on this project
  },
  "prospective": {
    "pendingDependencies": [...],   // Tasks waiting on something
    "upcoming": [...]               // Scheduled/deferred work
  }
}
```

### Secondary Endpoints (existing, unchanged)

```
GET /api/context                    // Short-term: operational state (in-progress, blockers)
GET /api/workflow                   // Procedural: workflow rules
GET /api/onboarding/company         // Semantic: company profile
GET /api/onboarding/agents/:id      // Semantic: agent-specific training
```

### Spawn Flow

When MC spawns an agent for a task:

```
1. buildTaskPrompt(task, agentId)
2.   → GET /api/agent/:id/memory?taskId=X&projectId=Y
3.   → Assemble prompt:
        - Procedural: role + rules (always included, small)
        - Semantic: company summary + project context + learned (included, medium)
        - Episodic: recent relevant tasks (included, bounded)
        - Prospective: pending dependencies (if relevant)
4.   → Add task-specific brief (the actual assignment)
5.   → Spawn agent with assembled context
```

### Token Budget

Not everything fits in the prompt. Priority order:

1. **Procedural** (~500-1000 tokens) — always include, it's who they are
2. **Task brief** (~200-500 tokens) — always include, it's the job
3. **Episodic** (~500-1000 tokens) — recent relevant tasks, bounded
4. **Semantic summary** (~500-1000 tokens) — company + project context
5. **Prospective** (~100-200 tokens) — only if relevant dependencies exist

Total spawn injection: ~2000-3500 tokens. Leaves plenty of context window for actual work.

Deeper semantic knowledge (full docs, handbooks) stays in RAG — searched on-demand during the session, not pre-loaded.

---

## Storage Summary

| Memory Type | Storage | Why |
|---|---|---|
| Procedural | Markdown (SOUL.md, AGENTS.md) | Small, stable, human-editable |
| Semantic (core) | Markdown (LEARNED.md, /business/) | Human-editable, works with OpenClaw |
| Semantic (deep) | Markdown + RAG vector search | Too large for prompt, needs semantic search |
| Episodic | SQLite (MC tasks DB) | Structured, queryable, already exists |
| Short-term | LLM context window | Ephemeral by nature |
| Prospective | SQLite + Cron + Heartbeat | Scheduled triggers, task dependencies |

---

## Scope Matrix

Shows which memory types apply at each scope level:

| | Global | Project | Agent | Task |
|---|---|---|---|---|
| **Procedural** | ✅ Rules, workflows | — | ✅ SOUL.md, AGENTS.md | — |
| **Semantic** | ✅ Company, domain, people | ✅ Stack, conventions, decisions | ✅ LEARNED.md | — |
| **Episodic** | — | ✅ All tasks on project | ✅ Agent's task history | — |
| **Short-term** | — | ✅ Related in-progress work | — | ✅ Current task context |
| **Prospective** | ✅ Heartbeats, recurring | ✅ Task dependencies | ✅ Agent reminders | — |

---

## Implementation Phases

### Phase 1: Foundation (Now)
- [x] SOUL.md per agent (procedural)
- [x] LEARNED.md instructions in AGENTS.md (semantic)
- [x] `/api/context` for operational awareness (short-term)
- [x] Heartbeats and cron (prospective)
- [x] Task completion tracking in MC (episodic — stored, not yet surfaced)

### Phase 2: Memory API
- [ ] Build `GET /api/agent/:id/memory` endpoint
- [ ] Wire episodic memory — query completed tasks by agent/project
- [ ] Wire semantic memory — read company profile + LEARNED.md + project context
- [ ] Wire procedural memory — read SOUL.md + relevant rules
- [ ] Update `buildTaskPrompt()` to use the memory API

### Phase 3: RAG Integration
- [ ] Connect onboarding file uploads to `/business/` folder
- [ ] Configure `memorySearch.extraPaths` to index `/business/`
- [ ] Agents can search company docs on-demand during sessions
- [ ] Add project-level doc folders with auto-indexing

### Phase 4: Learning Loop
- [ ] Post-task reflection: agent writes to LEARNED.md before session ends
- [ ] Handoff notes flow back into episodic memory (already happens via task updates)
- [ ] Periodic LEARNED.md review — prune stale facts, promote important ones
- [ ] Cross-agent learning: if Marie discovers a fact, relevant agents get it too

---

## Inspiration

This architecture is modeled on human memory classification from cognitive psychology:

- **Procedural** → Implicit long-term memory (riding a bike)
- **Semantic** → Explicit long-term memory (knowing Paris is the capital of France)
- **Episodic** → Explicit long-term memory (remembering your first day at work)
- **Short-term / Working** → Active manipulation of current information
- **Prospective** → Remembering to do something in the future

Reference: [Types of Memory in Psychology](https://humanperitus.in/types-of-memory-in-psychology/)

---

*Document created: February 22, 2026*
*Author: Jarvis (CSO) + Christopher Martin*
