# Plan — Assistant always aware of changes you make

## Goal
The assistant must **detect and announce** any meaningful change you make to the case (regenerating the Logic Flow, rewriting the solution summary, editing a suspect, deleting documents, etc.) **as soon as you next interact with it** — not silently keep going from a stale picture.

Today there is a half-built signal (`logic_dirty_since_approval`) that only fires when canvas nodes are edited *after* approval, and only if the assistant happens to read it. The user's exact scenario — "I started document generation, then went to the Case Board and pressed Regenerate from solution summary" — is **not** caught, because:
- regeneration wipes the board and re-streams it (so `latestNode.updated_at` is *new*, but `logic_approved_at` was also cleared, so the existing `logic_dirty_since_approval` formula returns `false`),
- there is no notification posted to the bell,
- there is no comparison against the documents/envelopes/storyboards that were generated **from the previous version**.

This plan fixes all three.

---

## 1. Stamp every artifact with a `logic_version_id`

Add a single `logic_version_id` (uuid) to `projects` and to every downstream artifact. It changes whenever the Logic Flow is regenerated, deleted, or the solution summary is replaced.

**Migration:**
```sql
alter table public.projects        add column logic_version_id uuid default gen_random_uuid();
alter table public.documents       add column logic_version_id uuid;
alter table public.envelopes       add column logic_version_id uuid;
alter table public.hints           add column logic_version_id uuid;
alter table public.hint_sheets     add column logic_version_id uuid;
alter table public.project_storyboards add column logic_version_id uuid;
alter table public.canvas_nodes    add column logic_version_id uuid;
alter table public.canvas_edges    add column logic_version_id uuid;
```

**When `logic_version_id` rotates (server-side, in the same transaction as the change):**
- `generate-logic-flow` → at the start, `update projects set logic_version_id = gen_random_uuid(), logic_approved_at = null`. Stamp every new node/edge it inserts with the new id.
- `set_solution_summary` tool in `assistant-chat` → same rotation (the summary is the parent of the logic flow).
- Manual node deletes that empty the `logic` board → rotate (covered by a tiny `useLogicFlowDirty` hook on the client that calls a new `rotate-logic-version` edge function on debounce after canvas edits).
- `approveLogic` does **not** rotate — it just records `logic_approved_at`, locking the current version as "approved".

**When existing artifacts get stamped:**
- `add_document`, `generate_document_assets`, `add_envelope`, `add_hint`, `generate-storyboard`, `generate-envelopes`, `create-final-documents-map` → all read the project's current `logic_version_id` and stamp it onto every row they create.

This gives us a clean equivalence: an artifact is **fresh** iff `artifact.logic_version_id == project.logic_version_id`.

---

## 2. Compute drift on every assistant turn

In `assistant-chat/index.ts`, in the rosters block (around line 1786), add a real `change_summary`:

```ts
const currentVersion = project.logic_version_id;
const staleDocs       = documentsRoster.filter(d => d.logic_version_id && d.logic_version_id !== currentVersion);
const staleEnvelopes  = envelopesRoster.filter(e => e.logic_version_id && e.logic_version_id !== currentVersion);
const staleHints      = hintsRoster.filter(h => h.logic_version_id && h.logic_version_id !== currentVersion);
const staleFinalNodes = nodesRoster.filter(n => n.board === "final" && n.logic_version_id !== currentVersion);
const logicApproved   = !!project.logic_approved_at;
const logicEmpty      = !nodesRoster.some(n => n.board === "logic");
```

Pack these into the runtime context block (replacing the current single `logic_dirty_since_approval` line) as a clearly labelled **CHANGE WATCH** section:

```
CHANGE WATCH (read this BEFORE deciding what to do this turn)
- Logic flow approved: NO  ⚠️ (was approved earlier, then regenerated/cleared)
- Logic flow board: 47 nodes, version v7c2…
- Stale documents (from older logic version): 12 of 18  ← these were built before the current logic and may contradict it
- Stale envelopes: 5 of 5
- Stale Final Flow nodes: 38
- Stale storyboards: 1
```

Then add a hard rule to the system prompt:

> **CHANGE WATCH RULE.** If CHANGE WATCH shows ANY stale rows OR `Logic flow approved: NO` while `Existing documents > 0`, your FIRST action this turn — before any other tool call, before answering the user's actual question — is to:
> 1. Tell the user plainly what changed: *"You regenerated the Logic Flow since these documents were drafted. The current docs/envelopes were built from an older version of the case and almost certainly don't match anymore."*
> 2. Call `propose_options` with three buttons:
>    - **"Discard stale docs and start over from the new logic"** → calls `reset_stale_artifacts`
>    - **"Keep them, I know what I'm doing"** → calls `mark_artifacts_current` (re-stamps them with the current version)
>    - **"Show me which docs are stale"** → you list them in chat
> 3. Do NOT proceed with whatever the user originally asked until they pick one.

Two new server tools to back the buttons:
- `reset_stale_artifacts({ scopes: ["documents","envelopes","hints","final_flow","storyboards"] })` — deletes only rows with mismatching `logic_version_id`.
- `mark_artifacts_current({ scopes: [...] })` — bumps their `logic_version_id` to current (user opt-out of the warning).

---

## 3. Drop a notification in the bell the moment regeneration starts

In `generate-logic-flow/index.ts`, right after rotating the version, insert into `project_notifications`:

```ts
await supa.from("project_notifications").insert({
  project_id: projectId,
  kind: "logic_regenerated",
  title: "Logic Flow regenerating — downstream docs may be stale",
  body: `You had ${documentsCount} documents and ${envelopesCount} envelopes built from the previous logic version. They will be flagged as stale; the assistant will ask you what to do next time you message it.`,
  starter_prompt: "I just regenerated the Logic Flow — what should I do about the existing documents?",
});
```

Same pattern for `set_solution_summary` ("Solution summary rewritten — Logic Flow and downstream docs may be stale") and for the auto-rotation when the logic board is emptied manually.

The bell already exists (`NotificationBell.tsx`) and supports `starter_prompt`, so clicking the notification drops a pre-written message into the assistant chat that immediately triggers the CHANGE WATCH rule above.

---

## 4. Generalise to other "the user changed something" events

Same pattern, lighter-weight (no version rotation, just an event line in CHANGE WATCH):

| User action | Detection | Assistant behaviour |
|---|---|---|
| Edited a suspect's name/role/secrets | `suspects.updated_at > project.last_assistant_acknowledged_at` | Brief recap: "I see you updated <name> — want me to refresh the docs that reference them?" |
| Deleted a document manually | New `event_log` row, OR `documents` count dropped between turns (cached in `project_meta.last_doc_count`) | "You removed Doc 12 (<title>). Should I regenerate it, or update Doc 0's inventory to drop it?" |
| Changed `target_doc_count` / `doc_generation_mode` / `envelope_settings` | `assistant_origins` does NOT contain that field but the value differs from last turn | "Noted — you switched to N=40 / drafts-only / 6-envelope layout. I'll follow that from now on." |
| Toggled a Claude Skill / changed planning model | Same diff-against-last-turn approach | One-line acknowledgement before answering the user's message |

To support this, add **`last_assistant_acknowledged_at timestamptz`** to `projects`. Bump it at the end of every successful assistant turn. Compare any artifact's `updated_at` against it to detect "user touched this since I last spoke."

---

## 5. Files touched

**Database**
- New migration: add `logic_version_id` columns, `last_assistant_acknowledged_at` on projects, default-rotate existing projects.

**Edge functions**
- `supabase/functions/generate-logic-flow/index.ts` — rotate version, post notification.
- `supabase/functions/assistant-chat/index.ts` — new `set_solution_summary` rotates version + posts notification; new `reset_stale_artifacts` and `mark_artifacts_current` tools; new CHANGE WATCH block + rule in `buildSystemPrompt`; bump `last_assistant_acknowledged_at` at end of turn.
- `supabase/functions/create-final-documents-map/index.ts`, `generate-envelopes/index.ts`, `generate-document/index.ts`, `generate-storyboard/index.ts`, plus the `add_document`/`add_envelope`/`add_hint` tool handlers in `assistant-chat` — stamp `logic_version_id` on inserts.
- New tiny `supabase/functions/rotate-logic-version/index.ts` — called from the client when manual canvas edits empty the logic board.

**Client**
- `src/features/project/CanvasSection.tsx` — call `rotate-logic-version` on debounced canvas-empty event; remove the local `phase=summary` snap-back (server now owns this).
- No UI changes required for the bell — `NotificationBell` already renders new `project_notifications` rows.

**Plan file**
- Update `.lovable/plan.md` with the final agreed approach.

---

## 6. What this gives you, concretely

In your exact scenario (started doc gen → went to Case Board → pressed Regenerate from solution summary):

1. The instant you click Regenerate, the bell lights up with **"Logic Flow regenerating — downstream docs may be stale"**.
2. The next time you send any message in the assistant chat — even just "ok continue with the documents" — the assistant's first words are: *"Hold on — you regenerated the Logic Flow since these 12 documents were drafted. They were built from an older version of the case and won't match the new clue chain. Do you want me to discard them and start over, or keep them as-is?"* with three buttons.
3. Clicking the notification itself opens the chat with the same starter prompt pre-filled, triggering the same warning immediately.

And the same mechanism gracefully covers future "user touched something" cases — suspect edits, manual doc deletes, setting changes — without needing a separate detector for each.

## 7. Open questions before I build

1. **Default action when stale docs are detected** — should the assistant *recommend* discarding (safer) or *recommend* keeping (less destructive)? My default is to recommend discarding because mismatched docs are usually worse than missing docs, but it's your call.
2. **Notification noisiness** — should the bell get a notification for *every* regen, or only when there are existing downstream artifacts to invalidate? I'll default to "only when there's something to invalidate" to keep the bell quiet during early Phase-2/3 work.
3. **Stamping back-fill for existing projects** — for cases you've already built, should I back-fill `logic_version_id` on all existing rows to the project's current version (so nothing is incorrectly flagged stale on day one)? My default is yes.
