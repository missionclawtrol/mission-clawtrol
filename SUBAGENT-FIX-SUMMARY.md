# Subagent Auto-Task Detection Fix

## Problem
The previous implementation was listening for `subagent-started` and `subagent-completed` events that the gateway wasn't actually emitting. The gateway sends `agent` events with streaming content instead.

## Solution
Updated the backend to detect subagents from stream events by:

### 1. Gateway Client Changes (`services/backend/src/gateway-client.ts`)
- Added handler for `agent` events in the `handleEvent` method
- Now emits `agent` events for any incoming `agent` event from the gateway
- These events contain streaming content with `sessionKey`, `stream`, and `data` fields

### 2. Backend Changes (`services/backend/src/index.ts`)
- **Session Tracking**: Added two Maps to track subagent sessions:
  - `knownSubagentSessions`: Tracks known subagent sessions by sessionKey
  - `subagentTaskIds`: Maps sessionKey to taskId for quick lookup

- **New `agent` Event Handler**: 
  - Checks if incoming agent events contain `:subagent:` in the sessionKey
  - Detects NEW subagent sessions on first event
  - Extracts agentId from sessionKey format: `agent:senior-dev:subagent:...`
  - Extracts task title from first line of streaming text
  - Creates a task with status "in-progress" and priority "P2"
  - Broadcasts `task-created` event to dashboard

- **Completion Detection**:
  - Monitors for `stream === 'complete'` or `stream === 'done'`
  - Updates task status to "done" with handoffNotes
  - Extracts summary text from event data
  - Broadcasts `task-updated` event to dashboard
  - Cleans up tracking maps after completion

## How It Works

### Event Flow
1. Gateway sends `agent` event with streaming content
2. GatewayClient receives and emits `agent` event
3. Backend agent handler receives event
4. If sessionKey contains `:subagent:`:
   - First event → Create task (register session)
   - Stream content events → Update title, accumulate content
   - Completion events → Mark task as done, extract summary

### Example Event
```json
{
  "runId": "fd4cdb3a-1cb0-4358-b5f4-7b5f66ed0d60",
  "stream": "assistant",
  "data": {"text": "...", "delta": "..."},
  "sessionKey": "agent:senior-dev:subagent:9291e982-...",
  "seq": 5,
  "ts": 1771067706994
}
```

### Generated Task
```json
{
  "id": "2bbce4bf-4536-44b6-9745-7837b8ae6815",
  "title": "Extracted from first line of text",
  "description": "Subagent task spawned by senior-dev",
  "status": "in-progress",
  "priority": "P2",
  "projectId": "mission-clawtrol",
  "agentId": "senior-dev",
  "sessionKey": "agent:senior-dev:subagent:9291e982-...",
  "createdAt": "2026-02-14T11:15:40.804Z",
  "completedAt": null
}
```

## Testing
The implementation was tested by:
1. Running the modified backend
2. Spawning a subagent task (this task)
3. Observing that a task was automatically created with:
   - Correct title extracted from first line of output
   - Correct agentId extracted from sessionKey
   - Correct sessionKey for tracking
   - Status "in-progress"

## Backward Compatibility
- Kept the original `subagent-started` and `subagent-completed` event handlers
- If those events are ever emitted by the gateway, they will still work
- The new agent event handler is the primary mechanism now

## Commit
```
commit 20ca796
Fix: Detect subagents from stream events instead of missing events

- Update gateway-client.ts to emit 'agent' events for stream content
- Add tracking of known subagent sessions in index.ts
- Detect NEW subagent sessions by checking for ':subagent:' in sessionKey
- Extract agentId and title from stream data
- Create tasks automatically when new subagent sessions start
- Detect completion when stream type is 'complete' or 'done'
- Update task status to 'done' with summary as handoffNotes
- Clean up session tracking after completion
```
