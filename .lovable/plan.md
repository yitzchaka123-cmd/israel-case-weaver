# Three fixes for the Case Board badge, the 10-doc proposal, and the silent assistant

I checked your project (`f2dee7e6…`) directly. The DB confirms:
- `logic_approved_at` **is set** (10:09 UTC) and `node_count = 29` — so the red badge should not be showing.
- `target_doc_count = 0` — that's why the assistant proposed only 10 documents (it had no target to aim for).
- `proposed_document_set_status = 'proposed'` (10 entries) — never approved, so nothing was generated yet.
- The assistant's last chat turn only listed document titles in shorthand, never recapped the full summary or discussed any document body.

Here's what I'll change:

## 1. Red exclamation point lingers after approval (Case Board tab)

**Root cause:** `caseBoardAttention` is a TanStack query that only refreshes via the realtime invalidation in `ProjectWorkspace`. If the Realtime event for the `projects` UPDATE is dropped (or the query was seeded before subscription attached), the cached `{needsAttention: true}` survives even though `logic_approved_at` is set.

**Fix in `src/features/project/ProjectWorkspace.tsx`:**
- Drop the separate `case-board-attention` query and **derive `needsAttention` directly from the already-fetched `project` and a lightweight `nodes` query** that's keyed alongside the existing canvas nodes invalidation. This way the badge state is computed from the same source of truth as the rest of the UI — no second cache to go stale.
- Add `staleTime: 0` and `refetchOnWindowFocus: true` to the `project` query so re-focusing the tab guarantees a fresh read.
- Add a belt-and-suspenders `refetchInterval` (15s) on the lightweight node-count query while a project is in `phase IN ('summary','logic')` so the badge can never sit wrong for more than 15 seconds even if Realtime drops.

## 2. Only 10 documents proposed (should be ~30–40)

**Root cause:** Two things compound:
- Your project's `target_doc_count` is `0`. The assistant has no target to plan against, so it freelances a small list.
- The Phase 4 planning prompt doesn't enforce a minimum or echo the target back to the model.

**Fixes in `supabase/functions/assistant-chat/index.ts`:**
- In the system prompt's Phase 4 planning gate (around line 203), add an explicit instruction: *"Aim for the user's `target_doc_count`. If `target_doc_count` is missing or 0, you MUST first ask the user how many documents the case should have (suggest 30–40 as the standard for an Unsolved Case Files–style box) and call `update_project({target_doc_count})` before calling `propose_document_set`. Never propose fewer than `target_doc_count − 5` or more than `target_doc_count + 5` documents."*
- In the runtime context block that's injected each turn (around line 328), add a hard line: `Target document count: ${project.target_doc_count || "NOT SET — ask the user before proposing the document set"}`.
- In the `propose_document_set` tool description, add: *"The number of `documents` entries should be within ±5 of `target_doc_count`. If `target_doc_count` is 0 or missing, do NOT call this tool — ask the user first."*
- Backfill your current project: I'll set `target_doc_count = 35` for `f2dee7e6…` so the next assistant turn can replan with a realistic count. (Only this one project; the change is scoped.)

**Also: add a "Show me the full proposed list" affordance**
- In `src/features/project/AssistantSection.tsx`, when the project has `proposed_document_set_status IN ('proposed','approved')`, render a small **"📋 View proposed document set (N)"** button above the composer that opens a panel listing every entry with its `title`, `doc_type`, `purpose`, and linked logic node ids. Right now the only way to see the list is to scroll the chat — and the chat only ever showed titles.

## 3. Assistant doesn't discuss summary / document contents in chat

**Root cause:** The system prompt focuses on tool-calling discipline but never tells the model to *share the artifact text in chat*. After it writes a summary or drafts a document, it announces "done" and moves on. You want to read and discuss the actual content.

**Fixes in `supabase/functions/assistant-chat/index.ts` system prompt:**
Add a new "TRANSPARENCY RULE" block:

> Whenever you create, rewrite, or update one of these artifacts via a tool call, you MUST in the SAME turn show its full text to the user in chat (markdown), then explicitly invite discussion before moving on:
> - `set_solution_summary` → paste the full summary back, ask "Does this match what you had in mind? Any beats to tweak?"
> - `propose_document_set` → list every document as `**N. Title** (doc_type, print_size) — purpose. Supports nodes: …`, then ask the user to approve / revise.
> - `add_document` (or batch) → for each created document, show a 2–4 sentence content sketch (what the player will read on the page) and ask which one to draft first.
> - `generate_document` → after the body is written, paste the full body text in chat and ask for edits.
> - `update_project` for `packaging_notes` / `image_prompt_instructions` / `video_prompt_instructions` → echo the new text and ask for confirmation.
>
> Never just say "done" or "saved". The chat is the workshop — the user must always be able to read what you wrote without leaving the conversation.

Also add to Phase 4: *"After `propose_document_set`, your prose MUST list every single proposed document by number with its purpose, not a summarized 'and 30 more like this'."*

## 4. Cleanup

- Backfill `target_doc_count = 35` on the current project (data fix only).
- Redeploy the `assistant-chat` edge function so the new prompt rules take effect.
- Verify after deploy: open the project, confirm the red badge is gone, ask the assistant to "regenerate the document set", and confirm it (a) asks about the count if needed, (b) proposes ~35, (c) lists every entry in chat, (d) recaps the summary on demand.

## Files to edit

- `src/features/project/ProjectWorkspace.tsx` — derive attention from already-fetched data, drop the separate stale query, add focus refetch.
- `src/features/project/AssistantSection.tsx` — add "View proposed document set" panel/button.
- `supabase/functions/assistant-chat/index.ts` — Phase 4 target-count enforcement + Transparency Rule for in-chat content sharing.
- (Data fix) `UPDATE projects SET target_doc_count = 35 WHERE id = 'f2dee7e6…'`.
