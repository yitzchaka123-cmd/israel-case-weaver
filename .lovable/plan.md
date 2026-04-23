

## Make the assistant talk you through doc generation — and optionally press the button itself

Right now the assistant can only *write* a document row (`add_document`) — it has no way to actually trigger the text/image generation pipeline (`generate-document`), and no way to display a generated result back inside the chat. You have to switch to the Documents tab and click "Generate" yourself.

This change makes the assistant a real generation partner: it asks you what mode you want, then either prepares drafts for your review OR actually runs generation and shows the result inline in the chat.

### What changes in the conversation flow

When the user is in Phase 4 (Documents) and the logic flow is approved, the assistant will, **before generating its first document**, ask one question with quick-reply buttons:

> How should I run document creation for this case?
> 1. **Drafts only** — I write the title, design instructions, and Hebrew body into each document row. You press "Generate text" / "Generate image" yourself in the Documents tab.
> 2. **Full auto** — I write the row AND immediately generate the Hebrew body + image, then show the result here in chat for your approval before the next one.
> 3. **Ask each time** — Decide doc-by-doc.

The choice is stored on the project (`doc_generation_mode`) so the assistant remembers it across turns and you don't get re-asked. You can change it any time by saying "switch to drafts only" / "go full auto".

For mode 2 / mode 3-with-yes, after `add_document` succeeds the assistant calls a new `generate_document_assets` tool that runs the existing `generate-document` edge function for both `text` and `image`. The result URL + Hebrew preview comes back in the tool receipt and renders directly in the chat as an inline preview card (Hebrew snippet + clickable image thumbnail + "Open in Documents" button).

### Files touched

| File | Change |
|---|---|
| `supabase/migrations/<new>.sql` | Add `projects.doc_generation_mode TEXT` (nullable, values: `drafts` / `auto` / `ask`). |
| `supabase/functions/assistant-chat/index.ts` | (a) Add `generate_document_assets` tool definition `{ document_id, mode: "text"\|"image"\|"both" }`. (b) Implement its executor — calls the existing `generate-document` edge function via `fetch` (server-to-server, with service-role auth) for one or both modes; returns `{ ok, hebrew_preview, image_url }`. (c) Add `set_doc_generation_mode` tool that writes `doc_generation_mode` to projects. (d) Extend system prompt with a new "DOCUMENT GENERATION WORKFLOW" block: when entering Phase 4, if `doc_generation_mode` is null, ASK the 3-option question above with `propose_options`; persist the answer with `set_doc_generation_mode`; thereafter follow that mode. In `auto` mode, after every `add_document` also call `generate_document_assets` with `mode: "both"`. In `ask` mode, after `add_document` ask "Generate now or save as draft?" with `propose_options`. (e) Pass current `doc_generation_mode` into the prompt's CURRENT PROJECT STATE block. |
| `src/features/project/AssistantSection.tsx` | (a) Extend `ToolCall` result type with optional `hebrew_preview` and `image_url`. (b) New `GeneratedDocReceipt` component rendered inside `ToolReceipts` for `generate_document_assets` results: shows the image thumbnail (clickable → opens full size), a 200-char Hebrew snippet (RTL), and a "Open in Documents" jump button. (c) Add `generate_document_assets` to `destinationFor` → Documents tab. |

### Technical details

- The new `generate_document_assets` executor runs server-side inside the assistant edge function. It calls `${SUPABASE_URL}/functions/v1/generate-document` with the service-role key in the Authorization header, so no extra auth wiring is needed. It awaits both `text` and `image` modes sequentially when `mode: "both"` is requested, then re-reads the document row to grab the final `hebrew_content` and `generated_asset_url` to return to the chat.
- Image generation can take 30–110s; the existing edge runtime has headroom but to keep the assistant turn snappy we cap each assistant tool call at 120s and surface a clear "image still rendering — check Documents tab" message if it overruns. The row keeps generating server-side regardless.
- The chat preview image is just an `<img>` pointing at the existing public Storage URL — no new bucket, no new RLS.
- All existing `add_document` gating (Logic Flow must be approved) stays untouched. `generate_document_assets` is also gated: it refuses if `solution_summary` / `logic_approved_at` are missing OR if the target document row isn't owned by the project.
- The mode question is suppressed if the user has already written the answer in their initial brief (e.g. "just write the prompts, I'll generate myself" → assistant infers `drafts` and confirms with `set_doc_generation_mode` instead of re-asking).

### What stays the same

- The Documents tab UI, the `generate-document` edge function, every other tool, and quick-reply buttons all keep working exactly as today.
- Existing projects with `doc_generation_mode = null` simply get the question once at Phase 4 entry and then run normally.

