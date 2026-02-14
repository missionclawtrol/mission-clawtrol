# Subagent Integration

## Overview

This document describes the automatic task creation system for subagents spawned by the main agent (CSO). When a subagent is spawned, a task is automatically created in Mission Clawtrol's task tracking system. When the subagent completes, the task is automatically marked as done.

## How It Works

### 1. Gateway Events

The Mission Clawtrol backend listens to WebSocket events from the OpenClaw gateway. When a subagent is spawned or completes, specific events are emitted.

**Events listened for:**
- `sessions.spawn.started` — Emitted when a subagent begins execution
- `sessions.spawn.completed` — Emitted when a subagent finishes
- Alternative event names: `subagent-started`, `subagent-completed`, `session.started`, `session.completed` (for compatibility with different gateway versions)

### 2. Automatic Task Creation

When a `subagent-started` event is received:

1. Extract the session key from the event payload
2. Extract the agent ID and task description
3. Create a new task in `~/.openclaw/tasks.json` with:
   - **title**: First line of the task description (max 100 chars)
   - **description**: Full task description
   - **status**: `in-progress`
   - **priority**: `P2` (default)
   - **projectId**: `mission-clawtrol`
   - **agentId**: The spawning agent's ID (e.g., "senior-dev")
   - **sessionKey**: The subagent's session key (for linking)
   - **handoffNotes**: `null` initially
4. Broadcast the new task to connected dashboard clients

### 3. Automatic Task Completion

When a `subagent-completed` event is received:

1. Extract the session key from the event payload
2. Find the corresponding task using `findTaskBySessionKey(sessionKey)`
3. Update the task to:
   - **status**: `done`
   - **completedAt**: Current timestamp
   - **handoffNotes**: Completion summary from the event payload
4. Broadcast the task update to connected dashboard clients

## Implementation Details

### Files Modified

#### 1. `services/backend/src/task-store.ts`

Added helper function:
```typescript
/**
 * Find task by session key (used to link subagent tasks)
 */
export async function findTaskBySessionKey(sessionKey: string): Promise<Task | null>
```

This function searches all tasks to find one with a matching `sessionKey`, enabling linking between subagent sessions and tasks.

#### 2. `services/backend/src/gateway-client.ts`

Added event handling:
- Comprehensive logging of all incoming gateway events
- Event emission for `subagent-started` and `subagent-completed`
- Fallback support for multiple event name formats

#### 3. `services/backend/src/index.ts`

Added event handlers:
- `subagent-started`: Creates a new task
- `subagent-completed`: Updates the task to done

Exported `createTask`, `updateTask`, and `findTaskBySessionKey` from task-store for use in handlers.

## Event Payload Format

### Expected `subagent-started` Payload

```json
{
  "sessionKey": "abc123def456",
  "agentId": "senior-dev",
  "description": "Build feature X\nImplement endpoints and tests",
  "message": "Building feature X",
  "id": "abc123def456"
}
```

### Expected `subagent-completed` Payload

```json
{
  "sessionKey": "abc123def456",
  "session": "abc123def456",
  "summary": "Feature completed successfully. 3 endpoints implemented, 100% test coverage.",
  "result": "Feature X completed",
  "message": "Feature X completed"
}
```

## Debugging

### Enable Event Logging

All gateway events are logged to console with:
```
[GatewayClient] Received event: {event_name} {payload_json}
```

To see what events your gateway is actually sending, start the backend:
```bash
cd services/backend
npm run dev
```

Look for `[GatewayClient] Received event:` logs to identify the actual event names and payload structure.

### Common Event Names to Check For

If the events listed above don't appear, look for:
- `agents.spawn.started` / `agents.spawn.completed`
- `agent.started` / `agent.completed`
- `spawn.started` / `spawn.completed`
- Any events containing "spawn", "subagent", or "session"

### Verify Task Creation

Tasks are stored in `~/.openclaw/tasks.json`. After spawning a subagent, check:

```bash
cat ~/.openclaw/tasks.json | jq '.[] | select(.sessionKey != null)'
```

This should show tasks with the `sessionKey` field populated.

## Dashboard Integration

Once tasks are created, they appear on the Mission Clawtrol dashboard:
- **Kanban board**: Tasks appear in the "In Progress" column when spawned
- **Task details**: Show agent ID, session key, and description
- **Real-time updates**: Task status updates broadcast to all connected dashboard clients via WebSocket

## Testing

### Manual Test Procedure

1. **Start Mission Clawtrol backend**:
   ```bash
   cd services/backend
   npm run dev
   ```

2. **Start the dashboard**:
   ```bash
   cd apps/dashboard
   npm run dev
   ```

3. **Open the dashboard**: http://localhost:5173

4. **Spawn a subagent** (from main agent or via OpenClaw CLI):
   ```bash
   openclaw agent spawn --agent senior-dev --task "Build feature X"
   ```

5. **Verify**:
   - New task appears on the Kanban board in "In Progress"
   - Task title matches the first line of your task description
   - Task shows the correct agent ID

6. **Complete the subagent**:
   - The subagent finishes execution
   - Task automatically moves to "Done"
   - Completion timestamp is set
   - Handoff notes are populated from completion summary

## Future Improvements

- [ ] Support for additional priority levels (extract from event payload)
- [ ] Support for custom project assignment (infer from context)
- [ ] Task linking to agent transcript/session details
- [ ] Event filtering by agent or project
- [ ] Retry logic for failed event processing
- [ ] Event audit log for debugging

## References

- Task Store: `services/backend/src/task-store.ts`
- Gateway Client: `services/backend/src/gateway-client.ts`
- Main Server: `services/backend/src/index.ts`
- Task Routes: `services/backend/src/routes/tasks.ts`
