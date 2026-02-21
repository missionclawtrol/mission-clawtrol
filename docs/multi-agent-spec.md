# Mission Clawtrol: Multi-Agent Update Spec

**Date:** 2026-02-12  
**Author:** CSO  
**Assignee:** Senior Dev (@srdev)

---

## Overview

Update Mission Clawtrol to support the new 8-agent team structure. The system should read agent definitions from OpenClaw config, display an agent roster with hierarchy, and track project associations via `AGENTS.md` files in project directories.

---

## Requirements

### 1. Read Agent Definitions from Config

**Source:** `~/.openclaw/openclaw.json` → `agents.list[]`

Each agent entry contains:
```json
{
  "id": "senior-dev",
  "name": "Senior Developer",
  "workspace": "/home/user/.openclaw/workspace-senior-dev",
  "agentDir": "/home/user/.openclaw/agents/senior-dev/agent",
  "model": "anthropic/claude-sonnet-4-5",
  "identity": {
    "name": "Senior Dev",
    "emoji": "👨‍💻"
  },
  "groupChat": {
    "mentionPatterns": ["@seniordev", "@srdev"]
  }
}
```

**Backend changes:**
- Add `GET /api/agents/roster` endpoint that reads from `openclaw.json`
- Return full agent definitions including identity, model, workspace path
- Cache config and watch for changes (or reload on each request initially)

---

### 2. Agent Roster View

New tab or section showing all 8 defined agents in a card/table layout:

| Emoji | Name | Model | Status | Last Active | Workspace |
|-------|------|-------|--------|-------------|-----------|
| 🎯 | CSO | opus | online | 2m ago | workspace-cso |
| 👨‍💻 | Senior Dev | sonnet | idle | 1h ago | workspace-senior-dev |
| 💻 | Junior Dev | qwen | offline | 3h ago | workspace-junior-dev |
| ... | ... | ... | ... | ... | ... |

**Status determination:**
- Check each agent's session directory: `~/.openclaw/agents/{id}/sessions/sessions.json`
- If no session file exists, status = "offline"
- Use existing `determineStatus()` logic based on `updatedAt`

**Actions per agent:**
- View details (expand card)
- Send message (opens message modal)
- View history
- Jump to workspace

---

### 3. Aggregate Sessions Across Agents

**Current:** Reads only from `agents/main/sessions/sessions.json`

**New:** Iterate through all agent directories:
```
~/.openclaw/agents/cso/sessions/sessions.json
~/.openclaw/agents/senior-dev/sessions/sessions.json
~/.openclaw/agents/junior-dev/sessions/sessions.json
... etc
```

**Backend changes:**
- Update `GET /api/agents` to scan all agent session directories
- Add `agentId` field to each session record
- Handle missing session files gracefully (agent exists but no sessions yet)

---

### 4. Hierarchy View

Visual org-chart showing team structure:

```
                    ┌─────────────┐
                    │  🎯 CSO     │
                    │   (opus)    │
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   ┌────┴────┐       ┌─────┴─────┐      ┌─────┴─────┐
   │ Dev Team │       │ Research  │      │  Support  │
   └────┬────┘       └─────┬─────┘      └─────┬─────┘
        │                  │                  │
   ┌────┴────┐       ┌─────┴─────┐      ┌─────┴─────┐
   │👨‍💻 Senior│       │🔬 Senior  │      │✍️ Editor  │
   │💻 Junior│       │📚 Junior  │      │🔧 SysAdmin│
   └─────────┘       └───────────┘      │🛡️ Security│
                                        └───────────┘
```

**Implementation options:**
- D3.js org chart
- Simple CSS flexbox/grid tree
- Mermaid diagram (if quick MVP)

**Interactivity:**
- Click node to see agent details
- Status indicators (colored dots)
- Hover for quick stats

---

### 5. Project Agent Tracking via AGENTS.md

**Replace** the current `data/project-agents.json` approach with file-based tracking.

#### 5.1 AGENTS.md Format

Each project can have an `AGENTS.md` file:

```markdown
# Project Agents

Agents currently working on this project. Updated by agents when they check in/out.

## Active

### 👨‍💻 Senior Dev
- **Agent ID:** senior-dev
- **Session:** agent:senior-dev:main
- **Task:** Implement multi-agent roster endpoint
- **Since:** 2026-02-12T16:30:00Z
- **Status:** working

### 📚 Junior Researcher
- **Agent ID:** junior-researcher
- **Session:** agent:junior-researcher:main  
- **Task:** Research D3.js org chart libraries
- **Since:** 2026-02-12T16:45:00Z
- **Status:** idle

## Completed

### 🎯 CSO
- **Agent ID:** cso
- **Task:** Write specification
- **Completed:** 2026-02-12T16:50:00Z
```

#### 5.2 Backend Parser

Create `parseAgentsMd(filePath)` function:
- Parse markdown to extract agent entries
- Return structured data:
```typescript
interface ProjectAgent {
  agentId: string;
  emoji: string;
  name: string;
  session?: string;
  task: string;
  since?: string;
  status: 'working' | 'idle' | 'completed';
  completed?: string;
}
```

#### 5.3 Project Scanning

Update `GET /api/projects/:id/agents`:
- Read `{projectPath}/AGENTS.md` if exists
- Parse and return agent list
- Fall back to empty array if no file

Update `GET /api/projects`:
- Include agent count per project
- Show active agent emojis in project list

#### 5.4 Agent Check-in Convention

Document in agent instructions (AGENTS.md template):

> **When starting work on a project:**
> 1. Read PROJECT.md for context
> 2. Add yourself to AGENTS.md under "## Active"
> 3. Update STATUS.md with your task
>
> **When completing work:**
> 1. Move your entry to "## Completed" 
> 2. Update STATUS.md
> 3. Update HANDOFF.md if passing to another agent

---

## File Changes Summary

### Backend (`services/backend/src/`)

| File | Changes |
|------|---------|
| `routes/agents.ts` | Add `/roster` endpoint, aggregate sessions across agent dirs |
| `routes/projects.ts` | Add AGENTS.md parsing, agent counts |
| `config-reader.ts` | NEW: Read and cache openclaw.json |
| `agents-md-parser.ts` | NEW: Parse AGENTS.md format |
| `project-agents.ts` | DEPRECATE: Remove JSON-based tracking |

### Frontend (`apps/dashboard/src/`)

| File | Changes |
|------|---------|
| `routes/+page.svelte` | Update Overview to use roster data |
| `routes/roster/+page.svelte` | NEW: Agent Roster tab |
| `routes/hierarchy/+page.svelte` | NEW: Hierarchy view |
| `lib/components/OrgChart.svelte` | NEW: Hierarchy visualization |
| `lib/components/AgentCard.svelte` | Update for new agent data shape |

---

## Migration

1. Keep `project-agents.json` working during transition
2. Add AGENTS.md support alongside
3. Once stable, deprecate JSON tracking
4. Optionally: migration script to convert existing associations to AGENTS.md

---

## Acceptance Criteria

- [ ] Agent Roster shows all 8 agents with correct models/emojis
- [ ] Status reflects actual session activity per agent
- [ ] Hierarchy view renders org chart
- [ ] Projects show associated agents from AGENTS.md
- [ ] Agents can check in by editing AGENTS.md
- [ ] Overview aggregates data across all agents

---

## Priority

1. **P0:** Config reading + Roster view (foundation)
2. **P1:** Session aggregation + AGENTS.md parsing
3. **P2:** Hierarchy view (visual polish)

---

*Spec written by CSO. Assigned to Senior Dev for implementation.*
