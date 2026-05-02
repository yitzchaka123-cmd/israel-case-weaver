## Goal

When the assistant drafts the design + content for a **document** (not an envelope), it should be free to creatively invent the document type/format that best fits (a) the overall story, and (b) this specific document's role — instead of just defaulting to the `doc_type` field or producing generic admin pages. It should also avoid accidentally giving every document in the case the same format.

This applies to the document branch only. Envelopes already got their own creative-variety pass and aren't touched here.

## Scope

Single edit to `supabase/functions/suggest-image-prompt/index.ts` in the structured-document path (`category === STRUCTURED_DOC`).

## Changes

### 1. Load sibling documents for context

Right after we load `docRow` (around line 191), also fetch the other documents in the same project so the assistant can see what types/formats are already in play across the case:

```ts
const { data: siblingDocs } = await supa
  .from("documents")
  .select("doc_number, title, doc_type")
  .eq("project_id", projectId)
  .neq("id", documentId)
  .order("doc_number", { ascending: true });
```

Append a `SIBLING DOCUMENTS IN THIS CASE` block to `targetBlock` (or pass it through to `structuredUser`) listing each as `#N "title" — doc_type`. This lets the AI pick a format that's *different* from the others and *coherent* with the story.

### 2. Treat `doc_type` as a hint, not a mandate

In the `THIS DOCUMENT` block, relabel the existing line:

```
- Type / format hint (NOT binding — you may invent a better-fitting format): {doc_type}
```

So the AI knows it can override an auto-assigned type.

### 3. Replace the document-specific rules block (line 254)

Swap the current one-liner for an explicit creative-license rule:

> Document-specific rules: stay in-world; don't reveal the full solution; honor the document's planned role inside the case.
>
> **Document-type creativity:** You have full creative license to choose the document type / format that BEST serves (a) the overall mystery's tone, era, setting, and stakes, and (b) this specific document's role in the case. The `doc_type` field above is a hint from earlier planning — feel free to invent a more fitting format if you can justify it from the story (e.g. a coroner's intake card, a backstage call sheet, a hand-drawn map on a napkin, a confessional transcript, a hotel switchboard log, a dictaphone transcription, a redacted internal memo, a child's school exercise book page — whatever the world calls for).
>
> **Variety across the case:** Look at SIBLING DOCUMENTS above. Don't duplicate a sibling's document type, paper, or era unless the story specifically demands a matched pair (e.g. "two telegrams from the same correspondent"). Each document should feel like a distinct artifact a player would physically pick up and recognize.
>
> **Doc 0 / contents inventory exception:** if this is doc 0 / the contents inventory, the design must be a plain white printer-paper sheet (no realism), and content is a numbered list of every game document.

### 4. Keep envelope branch untouched

The `isEnv` branch already has its own creativity rule from the previous turn and stays as-is.

## Out of scope

- No DB schema changes.
- No frontend changes — the existing "Generate" / "Revise" buttons in `DocumentsSection.tsx` keep working unchanged.
- No regeneration of already-approved documents; the user re-runs "Draft design + content" on a doc when they want the new creative behavior.
- Envelope prompt logic untouched.

## Acceptance check

- Drafting a fresh doc shows the AI proposing a document type that fits the case's tone (Victorian séance pamphlet, 1970s precinct file, etc.) instead of a generic memo.
- Drafting the 2nd, 3rd, 4th documents in the same case yields visibly different document types/papers from each other.
- If the user explicitly types "make it a typewritten memo" in user instructions, that still wins (existing user-instruction-overrides-everything rule is preserved).
