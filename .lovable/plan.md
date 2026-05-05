# Fix: "I send a message and nothing shows up"

## What's happening

In `AssistantSection.tsx`'s `send()`, after the user hits Send:
1. `setInput("")` clears the textarea.
2. `hookSend()` POSTs to `assistant-chat` (background mode).
3. The server inserts the user's `chat_messages` row.
4. The realtime subscription fires → invalidates the `["chat", projectId]` query → user's bubble finally appears.

There is **no optimistic insert**, so for the 1–4s window between step 1 and step 4 the user sees: textarea cleared, no bubble, no "Starting…" indicator yet (the "Starting…" placeholder only renders once `sending` is true AND there's no in-flight assistant message — but on a slow network, even `sending` flipping isn't enough to feel responsive when the user's own bubble hasn't appeared).

The "Starting…" assistant placeholder helps, but the user's **own** message disappearing into the void is what makes it feel like nothing was sent.

## Fix

In `src/features/project/AssistantSection.tsx`, inside `send()` (around lines 509–528), insert the user's message into the React Query cache immediately, before calling `hookSend`. The realtime subscription will swap it for the real DB row a moment later (same content, real id) — the user sees a continuous bubble, no flicker.

```ts
const optimisticId = `optimistic-${Date.now()}`;
qc.setQueryData<Msg[]>(["chat", projectId], (prev) => [
  ...(prev ?? []),
  {
    id: optimisticId,
    role: "user",
    content,
    created_at: new Date().toISOString(),
    metadata: null,
  },
]);
```

Place it right after `setInput("")` and before building `convo`. The same trick should be applied in `editAndResend` (around line 534) so edited prompts also appear instantly.

## Why this is enough

- The "Starting…" assistant bubble already renders as soon as `sending` flips true (line 806–842), so once the user's bubble appears optimistically, the assistant spinner shows up right behind it within ~100ms.
- If the server fetch fails, `hookSend` already toasts an error and writes an assistant error message; the optimistic user bubble stays visible (which is correct — they did send it).
- React Query keeps the optimistic row until the realtime invalidation refetches; the real row has a different `id` but identical `content` + `role`, so the visual replacement is seamless.

## Files to edit

- `src/features/project/AssistantSection.tsx` — `send()` (~509) and `editAndResend()` (~534): add optimistic `qc.setQueryData` insert for the user message.

No DB or edge-function changes.
