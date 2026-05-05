## Problem

When you send a message, the live "Thinking…" / spinner bubble disappears immediately and you see nothing while the assistant is working.

## Root cause

In `AssistantSection.tsx` the live bubble only renders when:
1. `sending` is true, AND
2. the **last** message in the chat is an assistant row with `metadata.in_progress: true`, AND
3. that placeholder row was created **after** the most recent user message.

In background mode (the default), the flow is:
- Client calls `assistant-chat` with `mode: "background"` → server returns `{ runId }` immediately.
- The server then, inside `EdgeRuntime.waitUntil(...)`, runs `processConversation`, which:
  1. inserts the **user** message,
  2. runs the zombie sweep,
  3. inserts the **assistant placeholder** with `in_progress: true`.

Because the placeholder insert (step 3) happens after several awaits in the background task, there is a window of 1–3 seconds where:
- `sending` is `true`,
- the chat realtime feed has already pushed the user message,
- but the in-progress assistant placeholder is **not yet in `messages`**.

During that window the live-bubble guard returns `null`, so the UI shows nothing — no spinner, no "Starting…" label. That matches exactly what you described.

A second contributing factor: the zombie sweep stamps any prior orphan assistant rows with `in_progress: false` before the new placeholder is inserted, so we cannot fall back to "any in-progress assistant row" — there genuinely isn't one for a brief moment.

## Fix

Add a fallback "Starting…" spinner that renders whenever `sending` is true and no real in-progress placeholder is available yet. Specifically, in `src/features/project/AssistantSection.tsx` around the `sending && (() => { ... })()` block (lines ~806–857):

- Keep the existing rich live bubble (with stage label, ThinkingDisclosure, ToolReceipts) when an `inFlight` placeholder is present.
- When `sending` is true but `inFlight` is null (placeholder not arrived yet, or the last message is the user's just-sent turn), render a minimal placeholder bubble with:
  - the assistant `Avatar`
  - a spinning `Loader2` + pulsing dot
  - the text `Starting…`

This guarantees the user sees continuous feedback from the moment they hit send until either the placeholder arrives (richer bubble takes over) or the run finishes.

## Files to change

- `src/features/project/AssistantSection.tsx` — adjust the `sending && ...` render block to add the fallback minimal spinner branch. No other files need changes; the realtime/zombie/back-end logic stays as-is.

## Out of scope

- No changes to `useAssistantRun.ts`, `assistant-chat` edge function, or the zombie-sweep behavior.
- No changes to placeholder-insert ordering on the server.
