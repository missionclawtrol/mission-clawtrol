# Cost Capture Debug & Fix Summary

**Status:** ✅ **FIXED**

## Problem

When tasks completed, the cost/linesChanged/commitHash data wasn't being captured, even though the task was moved to "review" status.

### Root Cause

The completion detection WAS working (30-second timeout + marker detection), but:
1. **No explicit commit hash in output**: Subagents weren't outputting commit hashes in their streaming text, so explicit extraction failed
2. **No fallback mechanism**: When no explicit hash was found, the system gave up instead of trying alternative detection methods

## Solution

### 1. Added Comprehensive Logging

Added detailed console.log statements at every step of the completion flow:
- Completion marker detection
- Text buffer accumulation
- Commit hash extraction attempts
- Git diff command execution
- Cost calculations
- Task status updates

**Files modified:** `services/backend/src/index.ts`

### 2. Implemented Git Log Fallback

When no explicit commit hash is found in the task's accumulated text:
1. Query `git log --since=<taskStartTime>` to find recent commits
2. Use the most recent commit from the task's creation time onward
3. Calculate cost based on this commit's diff

**Key functions added:**
- `getMostRecentCommitHash(repoPath, sinceDate)`: Queries git log with timezone-aware date conversion
- Timezone offset handling: Converts UTC task timestamps to local time for git log queries

### 3. Enhanced Task Structure

The `Task` interface already had the fields needed:
- `commitHash?: string` - Git commit hash
- `linesChanged?: { added, removed, total }` - Lines changed in the commit
- `estimatedHumanMinutes?: number` - Auto-calculated from lines (3 min per line)
- `humanCost?: number` - Auto-calculated from time (hourly rate: $100/hr)

## Verification

### Flow Tested

1. ✅ **Explicit commit hash extraction** - Works with patterns like "Commit: d71ae95"
2. ✅ **Git log fallback** - Finds recent commits when no explicit hash given
3. ✅ **Timezone handling** - Correctly converts UTC to local time for git queries
4. ✅ **Lines changed parsing** - Extracts added/removed from git diff --shortstat
5. ✅ **Cost calculation** - Converts lines to time to money ($325 for 65 lines, for example)
6. ✅ **Completion detection** - Both marker-based and 30-second timeout work

### Test Results

For commit `a41b86e` (the debug logging commit):
- Added: 61 lines
- Removed: 4 lines
- Total: 65 lines
- Estimated time: 195 minutes (3 min/line)
- Estimated cost: **$325.00** at $100/hr

## How It Works

### When a task completes:

1. **Completion detected** via:
   - Marker in streaming text ("completed", "done", etc.) - IMMEDIATE
   - OR 30 seconds of inactivity - TIMEOUT

2. **Commit hash extracted** via:
   - Pattern match in text: `commit: <hash>` or `<hash>` - EXPLICIT
   - OR git log query for commits since task start - FALLBACK

3. **Cost calculated**:
   ```
   git diff --shortstat <hash>^..<hash>
   lines_changed = added + removed
   minutes = lines_changed * 3  // Industry average: 3 min per line
   cost = (minutes / 60) * hourly_rate  // Default: $100/hr
   ```

4. **Task updated**:
   ```json
   {
     "status": "review",
     "commitHash": "a41b86e1...",
     "linesChanged": { "added": 61, "removed": 4, "total": 65 },
     "estimatedHumanMinutes": 195,
     "humanCost": 325
   }
   ```

## Code Changes

### New Functions

```typescript
// Get most recent commit since a date (with timezone handling)
async function getMostRecentCommitHash(
  repoPath: string,
  sinceDate?: Date
): Promise<string | undefined>

// Enhanced extractCommitHash with logging
function extractCommitHash(text: string): string | undefined
```

### Enhanced Functions

```typescript
// completeTask() - Now:
// 1. Tries explicit commit extraction
// 2. Falls back to git log if needed
// 3. Logs all steps for debugging
// 4. Always calculates cost if commit found
async function completeTask(sessionKey: string)
```

## Next Steps for Production

1. **Test with real subagents** - Spawn a debugging task and verify cost capture
2. **Monitor logs** - Watch for `[GetRecentCommit]`, `[CompleteTask]`, `[LinesChanged]` messages
3. **Verify costs** - Check that completed tasks have correct cost data
4. **Configure hourly rate** - Update settings endpoint to allow custom rates (currently hardcoded at $100/hr)

## Files Modified

- `services/backend/src/index.ts` - Main backend file with all cost capture logic
- `services/backend/src/task-store.ts` - Task interface (already had fields)

## Testing

Run the validation script to verify all components work:
```bash
node /tmp/validate-cost-capture.js
```

All 6 test categories pass:
1. ✅ Completion detection
2. ✅ Explicit commit hash extraction
3. ✅ Git log fallback
4. ✅ Lines changed calculation
5. ✅ Cost calculation
6. ✅ Task structure
