# Work Order: Bug — Cron Rules schedule Field Returns null from API

## Root Cause

The `src/rule-store.ts` was correctly updated in commit `20721b4` (15:20 EST) to include
`schedule` and `lastRunAt` in `rowToRule()` and `seedBuiltInRules()`. However, the
`mission-clawtrol-backend.service` was started at **14:47 EST** — *before* that commit.

Since tsx (the TypeScript runner) caches modules at process startup, the running server
had the old `rowToRule()` in memory (no `schedule` field), even though the source on disk
was correct. The DB values were correct; only the response mapping was stale.

## Fix Applied

1. Rebuilt `dist/` from updated source (`npm run build`)
2. Restarted `mission-clawtrol-backend.service` via systemd (`systemctl --user restart`)
3. Verified `GET /api/rules` now returns correct schedule values for all 3 cron rules:
   - `builtin-memory-consolidation` → `schedule: "0 20 * * *"`
   - `builtin-daily-summary` → `schedule: "0 17 * * *"`
   - `builtin-weekly-cost-report` → `schedule: "0 9 * * 1"`

## Definition of Done
- [x] `GET /api/rules` returns correct `schedule` and `lastRunAt` for all cron rules
- [x] UI can display schedule (field is present in API response)
- [x] Source code was already correct (no code changes needed)

## Files / Paths
- `services/backend/src/rule-store.ts` — already correct (schedule in rowToRule, seedBuiltInRules)
- `services/backend/dist/rule-store.js` — rebuilt (gitignored, not committed)

## Prevention
- After any code change to the backend, restart the service:
  `systemctl --user restart mission-clawtrol-backend.service`
- Consider switching dev to `tsx watch` for auto-reload during development

## Notes
- No source code changes were needed — the fix from the cron trigger task was already in place
- The systemd service simply needed a restart to pick up the updated module
