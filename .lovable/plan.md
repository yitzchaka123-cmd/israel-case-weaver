# Fix: stuck assistant run + lost/failed batch images

Two real bugs found from the live data:

**Bug A — assistant_runs row stuck "running" for ~10 hours.**
Row `5543baa5-28df-4ac8-9abb-9436f358b80a` has `status='running'`, `started_at=2026-04-27 23:01:55`, `finished_at=null`, `error=null`. The Edge Function bumped it to "running", then either the Worker was killed mid-stream or `processConversation` threw outside the try/catch. The client realtime hook (`useAssistantRun.ts`) only flips `isRunning=false` when it sees `status=done|error`, so the UI shows the assistant "thinking" forever and refuses new sends (`if (readRunState(projectId).isRunning) return;`).

**Bug B — batch image jobs that never get a row, or come back broken.**
The progress pill in `useBatchImageProgress.ts` only counts ids that were successfully INSERTed as `media_assets` rows. If `fireBackgroundImage` returns `{ ok:false, jobId:null }` (e.g. the queue function 5xx'd), that slot is never tracked — the user expects 10 thumbnails and only gets the ones that made it. Today's data shows 10 docs all wrote rows AND came back `status='generated'` — so any "missing" perception is either a) ids that never made it into `start([...])`, or b) the image came back blank / off-prompt with no error surfaced. There's no "this generation looked broken" affordance and no retry button per cell.

## What I'll change

### 1. Self-heal stuck assistant runs (highest-priority — unblocks the user right now)

**Server (`assistant-chat/index.ts`):**
- Wrap the background `work` IIFE in a hard timeout (e.g. 7 min). If exceeded, mark the row `status='error', error='Timed out — assistant exceeded 7 min limit'` and return.
- Add a top-level safety net AFTER the try/catch — if the function instance is being torn down, write `error='Worker terminated mid-run'` via a final `addEventListener('beforeunload')` style hook (use `EdgeRuntime` lifecycle or a `try { ... } finally { if (!finished) markError(...) }` pattern).

**Client watchdog (`useAssistantRun.ts`):**
- On bootstrap, when we find a `status='running'` row, ALSO check `started_at`. If `now() - started_at > 7 minutes`, treat it as stale: locally show `isRunning=false`, show a small toast "Previous run timed out — you can send again", and write `status='error', error='stale_timeout'` to the row so other tabs/devices recover too.
- Add the same staleness check to the realtime UPDATE handler.

**One-time cleanup:** issue an UPDATE to flip the existing zombie row (`5543baa5...`) and any other `assistant_runs` where `status='running' AND started_at < now() - interval '15 minutes'` to `status='error', error='stale_recovered', finished_at=now()`. This unsticks the user immediately.

### 2. Make batch image generation honest about what failed

**`fireBackgroundImage.ts`:** when the kicker call fails BEFORE inserting a `media_assets` row, synthesize a local pseudo-id and return it with `ok:false, kickFailed:true` so the caller can still register that slot in the progress pill.

**`useBatchImageProgress.ts`:**
- Accept "kick-failed" pseudo-ids and immediately mark them `failed` so the pill reads `Generated 8 / 10 — 2 failed (kick failed)` instead of silently shrinking the denominator.
- Keep the failed pill on screen until the user dismisses it (don't auto-clear if `failed > 0`).
- Add a "Retry failed" button that re-fires only the failed slots (cover, side, document, whatever the original `target` was).

**`MarketingSection.tsx` / `BarcodeAndBackPanel.tsx` / `CoverAndVisuals.tsx`:** when registering the batch, also pass per-slot labels (e.g. "Box side 2", "Back option 1") so the failure list can name them.

**Per-card "Regenerate" affordance:** every image card in `MediaSection`, `MarketingSection`, `BarcodeAndBackPanel.tsx`, and `CoverAndVisuals.tsx` already has a thumbnail — add a small "↻ Regenerate" button that re-runs the same prompt with the same model/quality. This covers case (b) where the image arrived but looked wrong.

### 3. Surface assistant timeouts in the UI

When `assistant_runs.status='error'`, show the `error` text in the Assistant timeline as a red system message ("⚠️ Last response failed: <reason>. Try again.") instead of nothing. Today the UI just goes quiet.

## Files touched

- `supabase/functions/assistant-chat/index.ts` — hard timeout + finally-block safety net
- `src/features/project/assistant/useAssistantRun.ts` — stale-run detection (bootstrap + realtime)
- `src/features/project/AssistantSection.tsx` — render error rows from `assistant_runs`
- `src/features/project/fireBackgroundImage.ts` — return kick-fail pseudo ids
- `src/features/project/marketing/useBatchImageProgress.ts` — track kick-fails, "Retry failed" hook, no auto-clear when failed > 0
- `src/features/project/marketing/BatchProgressPill.tsx` — show failed names + retry button
- `src/features/project/marketing/BarcodeAndBackPanel.tsx`, `CoverAndVisuals.tsx`, `MediaSection.tsx` — per-card "↻ Regenerate" button + pass slot labels into batch
- One-shot SQL: flip stale `assistant_runs` rows to `status='error'`

## Out of scope this turn

- Rewriting `assistant-chat` to a queue + cron (would also fix the timeout, but is much larger and the watchdog already unblocks the user).
- Showing image-quality issues automatically (no good signal — the model returns a URL even when the image is bad).
