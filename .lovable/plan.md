## Goal

When a project has a `cover_reference_url` selected from the active company profile, the front-cover generator should pass that image as a **real vision reference** to the image model — not just mention its URL in the text prompt — and the prompt should explicitly tell the model that the new cover is for the **same publisher/brand** as the reference and must match its visual identity.

## What changes

### 1. Frontend — `CoverAndVisuals.tsx`

- In `composeFrontPrompt`, when a `cover_reference_url` is present, replace the current "Reference cover to emulate: <url>" line with a strong, structured **brand-match preface** placed at the top of the prompt:

  > "BRAND CONTINUITY — CRITICAL: This cover is a new release in the SAME publisher line as the attached REFERENCE IMAGE (publisher: `<company.company_name>`). Treat the reference as our house style guide. Match its illustration technique, color palette, lighting, typography hierarchy, framing, paper/print finish and overall mood. Do NOT copy its scene or subject — tell THIS case's story with the same brand fingerprint, so the two boxes sit side-by-side as siblings on a shelf."
  > Plus the optional `cover_reference_notes` and the always-on `company.cover_design_brief`.

- In `handleGenerateCover`, pass two new fields into `fireBackgroundImage`:
  - `referenceImageUrl: project.cover_reference_url`
  - `referenceLabel: company?.company_name ?? null` (used only for logging/telemetry)

### 2. Frontend — `fireBackgroundImage.ts`

- Extend `FireBackgroundImageInput` with optional `referenceImageUrl?: string` and `referenceLabel?: string`. Forward them in the POST body to `generate-image`.

### 3. Edge function — `supabase/functions/generate-image/index.ts`

- Accept `referenceImageUrl` on the `Body` type and persist it through the background-mode synthetic request (already passes raw body, so no extra plumbing).
- When `referenceImageUrl` is set, fetch the image once as bytes (with size guard, e.g. ≤ 8 MB) before calling the model.
- **OpenAI path (`gpt-image-2` / `gpt-image-1`)**: switch from `POST /v1/images/generations` to `POST /v1/images/edits` (multipart/form-data) with fields `model`, `prompt`, `size`, `quality`, `n`, `image=<reference bytes>`. Keep the existing generations call when no reference is provided. Response shape (`data[0].b64_json`) is identical.
- **Gemini direct path** (`generateImage` in `_shared/ai-router.ts`): extend the helper to accept an optional `referenceImage: { bytes: Uint8Array; mime: string }`. When present, append a second `parts` entry with `inlineData: { mimeType, data: base64(bytes) }` alongside the text part. This is the documented Nano Banana edit-mode input.
- **Lovable AI Gateway fallback path**: when used, pass the reference as a `image_url` content block in the `messages` array (gateway already supports `modalities: ["image","text"]` with mixed text + image_url content — see the AI-gateway docs in context).
- Log the reference URL on the prompt excerpt (truncated) so `ai_run_logs` shows that brand-continuity mode was used.

### 4. No DB migration needed
`projects.cover_reference_url` and `projects.cover_reference_notes` already exist; `company_profiles_v2.reference_covers` already feeds the picker.

## Out of scope (intentionally)
- Changing the storyboard / barcode / back-of-box generators to also vision-attach the reference. This plan is front-cover only — same-brand visual continuity is what the user asked for.
- Multi-reference (passing several covers at once). Single reference per project for now; the picker already enforces that.
- UI changes to the picker itself.

## Acceptance check
After shipping, generating a cover with a reference selected should:
1. Send a multipart `images/edits` request to OpenAI (or `inlineData` to Gemini) — verifiable via `supabase--edge_function_logs`.
2. The resulting image visibly inherits palette / illustration style / typography mood from the reference, while depicting this case's own scene.
3. The prompt logged in `ai_run_logs` starts with the BRAND CONTINUITY preface naming the publisher.
