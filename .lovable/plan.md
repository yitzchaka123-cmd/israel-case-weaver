## Problem

The Canvas page crashes with:

> cannot add `postgres_changes` callbacks for realtime:logic-flow-live-c7e3d5dc-... after `subscribe()`.

This happens in `src/features/project/canvas/useLogicFlowLive.ts`. The hook creates a Supabase Realtime channel named `logic-flow-live-${projectId}`. Because the channel name is deterministic (only depends on `projectId`), when React StrictMode double-invokes the effect — or when the component remounts quickly (tab switch, query refetch, hot reload) — the second run reaches into Supabase's internal channel registry and grabs the **same channel instance that has already been `.subscribe()`-d**, then tries to attach three new `.on('postgres_changes', ...)` listeners to it. Supabase Realtime forbids adding `postgres_changes` listeners after subscribe, so it throws and the entire Canvas tree unmounts into the error boundary.

## Fix

Two small, defensive changes in `src/features/project/canvas/useLogicFlowLive.ts`:

1. **Make the channel name unique per mount** by appending a random suffix (e.g. `Math.random().toString(36).slice(2)` or `crypto.randomUUID()`). This guarantees StrictMode's second mount and any rapid remount get a fresh channel instead of colliding with an already-subscribed one.
2. **Defensively remove any pre-existing channel with the same name before creating** (belt-and-suspenders) — call `supabase.removeChannel` on the channel reference inside the effect cleanup, which is already done; the unique-name change is what actually fixes the race.

No other files need to change. The "Planning logic flow…" indicator and live drawing dot keep working — only the channel identity changes.

## Files

- `src/features/project/canvas/useLogicFlowLive.ts` — generate a unique channel name per effect run.

## Why this is the right fix

- The error message comes verbatim from `@supabase/realtime-js` when `.on('postgres_changes', ...)` is called on a channel whose `joinedOnce` flag is already true.
- StrictMode in dev intentionally double-invokes effects. With a deterministic channel name, the second invocation hits the cached/subscribed channel.
- Unique-per-mount names is the standard Supabase Realtime pattern and matches the guidance in the project's own troubleshooting notes.
