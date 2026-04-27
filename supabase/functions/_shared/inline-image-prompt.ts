// Consistency-aware prompt builder for inline images embedded inside a document
// (e.g. the four drone aerials at the bottom of a surveillance report).
//
// The first image of a group is the "anchor" — its prompt is generated normally.
// Every subsequent (non-anchor) image is generated as a *variation of the
// anchor image* via the shared `generate-image` edit-mode path, with the
// anchor's URL passed as a reference image. We also fold the anchor's prompt
// into the new prompt so text + reference-image both push the model toward
// "same drone, same camera, same lighting, just a different angle".
//
// Returns a fully-formed prompt string ready to send to suggest-image-prompt
// (when the assistant just wants to draft) or directly to generate-image (when
// the user clicks Generate).

export interface DocContext {
  title: string;
  doc_type: string | null;
  design_instructions: string | null;
  inline_images_caption?: string | null;
}

export interface SlotRow {
  slot_label: string;
  prompt: string | null;
  position: number;
  group_key: string | null;
}

export interface AnchorRow {
  slot_label: string;
  prompt: string | null;
  url: string | null;
}

export interface BuildOpts {
  doc: DocContext;
  thisImage: SlotRow;
  anchor: AnchorRow | null;
  groupSiblings: SlotRow[];          // already-generated siblings in same group
  projectImageStyle: string;         // project.image_prompt_instructions + user notes
}

const CONSISTENCY_LOCK_SECTION = (anchor: AnchorRow) => `
ANCHOR REFERENCE IMAGE (IMAGE #1 IN THIS GROUP — locked visual properties):
- Anchor prompt: ${anchor.prompt ?? "(no prompt available)"}
${anchor.url ? `- Anchor image URL (passed as reference image to the model): ${anchor.url}` : ""}

LOCKED VISUAL PROPERTIES (must match the anchor exactly — the new image is a sibling, not a different photo session):
- Camera / sensor type and lens feel
- Lighting condition (time of day, light direction, weather, color temperature)
- Color palette and grading
- Subject style and material rendering
- Framing / aspect ratio language
- Post-processing look (grain, sharpness, contrast)

VARY ONLY:
- Subject framing or angle as described by THIS slot's prompt below
- Foreground composition specific to THIS slot
Everything else MUST read as if shot moments later by the same camera operator.
`.trim();

export function buildInlineImagePrompt(opts: BuildOpts): string {
  const { doc, thisImage, anchor, groupSiblings, projectImageStyle } = opts;

  const header = [
    projectImageStyle.trim()
      ? `USER GLOBAL IMAGE INSTRUCTIONS (apply to every image in this project — highest priority):\n${projectImageStyle.trim()}\n\n---\n`
      : "",
    `INLINE IMAGE INSIDE A DOCUMENT — slot "${thisImage.slot_label}" (position ${thisImage.position + 1}).`,
    `Document: "${doc.title}"${doc.doc_type ? ` (${doc.doc_type})` : ""}.`,
    doc.design_instructions?.trim()
      ? `Document design context:\n${doc.design_instructions.trim()}\n`
      : "",
  ].filter(Boolean).join("\n");

  const slotPrompt = (thisImage.prompt ?? "").trim()
    || `Render an image for the "${thisImage.slot_label}" slot, matching the document's tone.`;

  if (!anchor) {
    // This IS the anchor (or there is no group). Generate normally — but make
    // sure the result is a strong, opinionated reference shot so future
    // siblings can inherit its visual properties.
    return [
      header,
      `THIS IS THE ANCHOR / REFERENCE IMAGE for its group. Treat it as the canonical "first frame" — every later sibling will be generated as a variation of this image, so commit to a clear visual identity (camera type, lighting, palette, framing language).`,
      groupSiblings.length > 0
        ? `Sibling slots that will inherit this look: ${groupSiblings.map((s) => `"${s.slot_label}"`).join(", ")}.`
        : "",
      ``,
      `SLOT BRIEF: ${slotPrompt}`,
    ].filter(Boolean).join("\n\n");
  }

  // Child image — anchor exists. Lock visual properties + describe variation.
  return [
    header,
    CONSISTENCY_LOCK_SECTION(anchor),
    ``,
    `THIS SLOT'S VARIATION BRIEF: ${slotPrompt}`,
    ``,
    `Output: a single image that reads as a sibling of the anchor — same world, same gear, same moment-in-time, just framed/angled per the variation brief above.`,
  ].filter(Boolean).join("\n\n");
}
