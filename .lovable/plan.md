

## Keep the assistant running when you switch tabs or close the page

Today, the assistant only "runs" while the **Assistant** tab is mounted. The moment you click another tab (Case Board, Suspects, etc.) Radix unmounts the chat panel — the React `sending` state is destroyed, the spinner disappears, and any tool-call receipts that arrive later silently land in the database without a UI nudge. If you close the browser tab mid-reply, the in-flight HTTP request is aborted and the assistant's reply is killed half-written.

Two independent fixes:

### 1. Survive tab switches inside the workspace

**Problem:** `<TabsContent value="assistant">` in `ProjectWorkspace.tsx` only renders when active. When you leave the tab, `AssistantSection` unmounts → the `fetch` promise is orphaned → you lose the spinner and the toast on error.

**Fix:** Lift the assistant's "in-flight run" out of `AssistantSection` into a project-scoped hook stored on the React Query cache (so it survives unmount/remount). Keep the panel itself unmounted (cheap), but route the actual `fetch` through this hook.

- **New module `src/features/project/assistant/useAssistantRun.ts`** — a singleton-per-project run controller backed by a module-level `Map<projectId, AbortController + status>` plus a React Query `["assistant-run", projectId]` cache key for the in-flight flag. The fetch stays alive across mounts because it's owned by the module, not the component.
- **`AssistantSection.tsx`** — replace local `sending` state with `useAssistantRun(projectId)`. The `send()` function delegates to the hook; the spinner reads from the hook. When you remount the tab, you immediately see "Assistant is thinking…" if a run is still going.
- **Visible "thinking" indicator on the Assistant tab trigger.** In `ProjectWorkspace.tsx`, subscribe to the same hook and show a small pulsing accent dot next to the `Sparkles` icon on the Assistant tab when `isRunning` is true on any tab. So even from the Case Board you can see the assistant is working.
- **Toast surfaces from anywhere.** When the run completes (success or error) and the user is on a different tab, fire a `toast.success("Assistant updated your case")` / `toast.error(...)` from the hook, and trigger the same query invalidations (`chat`, `project`, `suspects`, `documents`, `nodes`) so other tabs auto-refresh — e.g. new suspects appear on the Suspects tab without needing to visit the Assistant.

### 2. Survive closing the browser tab

**Problem:** Even with fix #1, the assistant runs in **the browser's** fetch. Close the tab and the TCP connection drops; the Deno edge function may abort mid-stream, and any tool calls partway through stop being applied.

**Fix:** Make the request **fire-and-forget** on the server using Deno Deploy's background-task primitive `EdgeRuntime.waitUntil`. The HTTP response returns immediately with a `runId`; the actual model call + tool execution + final message persistence happens in a background task that survives the client disconnect.

- **`supabase/functions/assistant-chat/index.ts`**
  - Add a new branch: when the request body includes `mode: "background"` (default for our client), wrap the existing `processConversation()` work in `EdgeRuntime.waitUntil(...)` and immediately respond `{ runId, ok: true }`. The function continues running until the model + tool loop finishes and writes the assistant message via the existing service-role client.
  - Persist a tiny **`assistant_runs`** row at start (`status: "running"`) and update it to `done` / `error` when the background task finishes. Existing chat-message realtime stream already pushes the final reply to the UI when it lands.
- **New table `assistant_runs`** (migration):
  - `id uuid pk`, `project_id uuid`, `user_id uuid`, `status text` (`running|done|error`), `error text null`, `started_at timestamptz default now()`, `finished_at timestamptz null`
  - RLS = same `Auth all` policies as `chat_messages`
  - Realtime publication added so the client sees status flips.
- **Client-side `useAssistantRun`** subscribes to `assistant_runs` realtime — that's the single source of truth for "is this project's assistant currently working?" Works even after a full page reload: come back tomorrow and if the run somehow stalled (`status='running'` for >5 min), the hook flags it and offers a "Retry" button.
- **Cross-device benefit:** because the run state lives in the database, opening the project from a different device shows the same in-flight indicator.

### 3. Wire it everywhere it's useful

- The **NotificationBell** "open assistant with this prompt" handler stays as-is, but now the prompt fires through `useAssistantRun.send()` — so triggering it from a notification keeps running even if you immediately switch to Documents to watch results land.
- Add a small **"Assistant is working on your case"** banner at the top of `ProjectOverview` and `ProductionDashboard` when a run is in flight, with a link to the Assistant tab.

### Files touched

- New: `src/features/project/assistant/useAssistantRun.ts`
- Edited: `src/features/project/AssistantSection.tsx` — use the hook, drop local `sending`
- Edited: `src/features/project/ProjectWorkspace.tsx` — pulsing dot on Assistant tab trigger, subscribe to run state
- Edited: `src/features/project/ProjectOverview.tsx` and `src/features/project/ProductionDashboard.tsx` — "working" banner
- Edited: `supabase/functions/assistant-chat/index.ts` — background mode via `EdgeRuntime.waitUntil`, write `assistant_runs` rows
- New migration: `assistant_runs` table + RLS + realtime publication

### Out of scope

- Background runs continuing if the **whole edge worker** is recycled (Deno background tasks have a soft cap of a few minutes — fine for our typical 10–60s assistant turns; longer flows should already be tool-call-driven, not single-message).
- A full "run history" UI — `assistant_runs` is internal plumbing for now; we can surface it in Settings → AI Run Log later if you want.
- Push notifications when a run finishes while the browser is closed — that's a separate web-push project.

