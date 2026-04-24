Here’s the honest explanation first, then the build plan.

## Why GPT 5.2 made a PDF in ChatGPT, but not here

In ChatGPT’s own app, GPT 5.2 is surrounded by ChatGPT product tools: file creation, code/runtime tools, PDF rendering, and attachment handling. The model can ask those built-in app tools to make a PDF and then ChatGPT gives you the file.

In this app, when we call GPT 5.2 through your OpenAI API key, we are currently using the chat-completions style endpoint. That endpoint can return text/tool calls, but it does not automatically return a downloadable PDF file just because the ChatGPT app can. So the app asked GPT 5.2 to “create the PDF directly,” but GPT 5.2 returned a chat response rather than an actual downloadable PDF file. Because we removed hidden fallback rendering, the app correctly refused to fake a PDF.

So the rule should become:

- GPT 5.2 can create document text and document plans through your OpenAI key.
- GPT image models can create image previews through your OpenAI key.
- Real direct PDF/DOCX/PPTX/XLSX generation should be routed only to a model/tool path that can actually return files, currently Claude with document skills.
- If the selected model cannot return files, the app should say that before trying, not after failing.

## Build plan

### 1. Make the document file error pre-emptive and understandable

Update the document generation backend so that when the selected document model is GPT/OpenAI or Gemini direct and the requested output is PDF/DOCX/PPTX/XLSX, it does not waste a call asking for a file it cannot retrieve.

Instead it will return a clear message like:

> ChatGPT 5.2 in this app is connected through your OpenAI API key for chat/text. It can write the document content, but this route cannot return a downloadable PDF file. Switch Documents to Claude with document skills for PDF/DOCX/PPTX/XLSX, or choose Image-only with ChatGPT Image.

This keeps your “no hidden fallback” rule and avoids confusing “provider returned 400/422” failures.

### 2. Keep image generation separate from PDF generation

Keep the successful image path as-is for ChatGPT Image / Nano Banana, but make the assistant’s receipts say exactly what happened:

- Image generated successfully via the selected image model.
- PDF was not attempted or not available because the current document model cannot return downloadable files.
- Recommended next action: switch document model to Claude with document skills, or continue image-only.

### 3. Add a required “Final Documents Map” step before creating final document rows

Change the Phase 4 assistant workflow so that after Logic Flow is approved, it must first build the Final board document map before generating final documents.

New workflow:

```text
Approved Logic Flow
  -> Create Final Documents Map on Case Board / Final board
  -> User reviews/approves the mapped document nodes
  -> Assistant creates real document rows from that map
  -> User chooses Image / PDF / Both per document or batch
  -> Assets generate only after rows exist
```

The Final board should contain one node per planned real game document, including Doc 0.

Each document node should include:

- doc number
- title
- document type
- envelope number, if relevant
- purpose in the mystery
- status: `ungenerated` / `draft row created` / `image generated` / `file generated`
- link to the real document row once created

### 4. Make “ungenerated” document nodes visible and useful

Update the Final board UI so document nodes show whether the document is only planned or already generated.

Planned nodes should visibly say something like:

> Ungenerated — to be generated in the future

Generated/linked nodes should show links/actions in the side panel:

- Open document row in Documents tab
- Open generated image if available
- Open/download generated PDF/DOCX if available
- Show linked suspects/nodes where relevant

### 5. Add backend support for generating the Final Documents Map

Add a backend function or assistant tool that creates/replaces Final board document nodes from the approved logic flow and solution summary.

It should not create document rows yet unless the user approves. It only maps the intended documents first.

It will use the project’s selected planning model, preferably GPT 5.2 if that is what the assistant is using, and output structured nodes.

### 6. Tie document rows back to Final board nodes

When a document row is later created from a Final board node, store the relationship both ways using the existing `linked_node_ids` mechanism and node `data` metadata.

This makes click-through work:

- Final board node -> Documents tab document
- Document row -> related Final board node
- Generated assets -> document row -> node

### 7. Make Doc 0 a universal contents / box checklist document

Update the assistant/playbook rules so Doc 0 is not just a generic table of contents. It should be a player-facing contents list for the game box: the buyer can check that they received all documents and pieces.

Doc 0 should include:

- title like “Contents / Case File Inventory”
- all included documents and physical pieces
- envelope grouping if relevant
- clear checklist/table formatting
- generated/printable as part of the final kit
- no solution spoilers

### 8. Add a “Universal documents” section to the Playbook editor

Add a new editable section in Settings -> Assistant Playbook for universal documents that apply to every game.

Initial fields:

- Enable Doc 0
- Doc 0 title template
- Doc 0 purpose/instructions
- Doc 0 default document type
- Doc 0 default print size
- Whether Doc 0 should list generated assets only or all planned assets
- Additional universal docs list for future items, e.g. rules page, welcome letter, evidence inventory, hint instructions

These values will be injected into the assistant system prompt and used by the Final Documents Map generator.

### 9. Update the assistant prompt/playbook rules

The assistant should learn these hard rules:

- Never begin final document generation immediately after Logic Flow approval.
- First create/review the Final Documents Map on the Final board.
- Treat Final board document nodes as the production checklist.
- Mark uncreated documents as “ungenerated / to be generated.”
- Create Doc 0 as the universal box contents checklist from playbook settings.
- If the user requests PDF while using GPT 5.2, explain that GPT 5.2 here can write content but cannot return direct downloadable PDF files through this route; recommend Claude document skills.

### 10. Manual Documents tab alignment

Update manual Documents tab behavior so it matches the same rules:

- Image generation remains available through selected image models.
- PDF/DOCX/PPTX/XLSX generation shows a clear model capability message before attempting when the selected document model cannot return files.
- If a document is linked to a Final board node, show that relationship in the document details.

## Technical notes

Likely files/functions to update:

- `supabase/functions/generate-document/index.ts`
- `supabase/functions/assistant-chat/index.ts`
- `supabase/functions/generate-logic-flow/index.ts` or a new final-map generation function
- `src/features/project/CanvasSection.tsx`
- `src/features/project/canvas/CanvasNodeTypes.tsx`
- `src/features/project/DocumentsSection.tsx`
- `src/features/settings/AssistantPlaybookPanel.tsx`
- `src/lib/assistant-playbook.ts`
- `supabase/functions/_shared/assistant-playbook.ts`

A small database migration may be needed if we decide to store explicit final-map approval or richer node/document metadata outside the existing `canvas_nodes.data` JSON field. I’ll prefer using existing `canvas_nodes.data` and `documents.linked_node_ids` first to avoid unnecessary schema changes.

## Recommended next build chunk

Build this in one focused chunk:

1. Add the universal Doc 0 playbook settings.
2. Add the Final Documents Map workflow rule/tool.
3. Update Final board document nodes to show ungenerated/generated status and link to documents.
4. Add the pre-emptive GPT 5.2 PDF capability message.

After that, we can run the current case through the corrected flow: generate the Final Documents Map first, approve it, then create/generate Doc 0 and the rest from the mapped nodes.