// Shared prompt composers for the front+back cover pair generator.
// Pulled out of CoverAndVisuals + BarcodeAndBackPanel so the new combined
// "Generate front + back" flow can build BOTH halves of the prompt in one
// place and ship them to the gpt-image-2 batch (n=2) call.

export interface ProjectMeta {
  title?: string | null;
  subtitle?: string | null;
  mystery_type?: string | null;
  setting?: string | null;
  genre?: string | null;
  year?: number | string | null;
}

export interface FrontMarketingMeta {
  /** Tagline baked directly under the title. */
  tagline?: string | null;
  /** Bottom paragraph baked across the bottom strip. */
  front_subtext?: string | null;
  /** Age / duration / players, also baked on the front. */
  back_specs?: string | null;
}

export interface BackMarketingMeta {
  back_headline?: string | null;
  back_body?: string | null;
  back_teaser?: string | null;
  back_whats_in_box?: string | null;
  back_specs?: string | null;
  back_footer_text?: string | null;
  tagline?: string | null;
  barcode_value?: string | null;
}

export interface CompanyMeta {
  company_name?: string | null;
  tagline?: string | null;
  cover_design_brief?: string | null;
  address?: string | null;
  legal_text?: string | null;
  warning_text?: string | null;
  box_footer_line?: string | null;
  manufactured_by?: string | null;
  distributed_by?: string | null;
  age_rating?: string | null;
  made_in?: string | null;
}

export interface QrLite {
  label?: string | null;
  is_primary?: boolean;
}

export const FRONT_LAYOUT_SUFFIX = `

LAYOUT REQUIREMENTS (PRINT-CRITICAL — overlays will be added later):
- Vertical 3:4 print-ready canvas, atmospheric, evocative.
- Reserve a CLEAN UNTEXTURED rectangle at TOP-CENTER (~30% × 12%) for the title wordmark.
- Reserve a CLEAN UNTEXTURED rectangle directly under the title (~60% × 5%) for the tagline.
- Reserve a CLEAN UNTEXTURED rectangle in the TOP-LEFT (~18% × 12%) for the publisher logo.
- Reserve a CLEAN UNTEXTURED small badge near the BOTTOM-RIGHT (~22% × 6%) for the specs badge (age/duration/players).
- Reserve a CLEAN UNTEXTURED strip across the BOTTOM (~100% × 14%) for the bottom paragraph.
- No text rendered into the artwork itself — typography is added in post.`;

export const BACK_LAYOUT_SUFFIX = `

LAYOUT REQUIREMENTS (PRINT-CRITICAL — overlays will be added later):
- Vertical 3:4 print-ready canvas, atmospheric, evocative.
- Genre-appropriate imagery; do NOT spoil the solution.
- Reserve a CLEAN UNTEXTURED rectangular area in the LOWER-RIGHT (~22% × 18%) for a barcode.
- Reserve a CLEAN UNTEXTURED square in the LOWER-LEFT (~20% × 20%) for a primary QR code.
- Reserve a CLEAN UNTEXTURED rectangle at TOP-CENTER (~22% × 10%) for the company logo.
- Reserve a CLEAN UNTEXTURED horizontal strip across the BOTTOM (~100% × 8%) for company address & legal text.
- Reserve negative space across the central body region for paragraph copy.
- No text rendered into the artwork itself — typography and brand marks are added in post.`;

/** Build the FRONT-cover prompt half. Mirrors the historical
 * `composeFrontPrompt` in CoverAndVisuals but is reference-image agnostic
 * (the shared brand-continuity preface lives in the combined prompt builder). */
export function composeFrontPrompt(args: {
  basePrompt: string;
  project: ProjectMeta | null | undefined;
  marketing: FrontMarketingMeta | null | undefined;
  company: CompanyMeta | null | undefined;
}): string {
  const { basePrompt, project, marketing, company } = args;
  const parts: string[] = [];
  parts.push(basePrompt.trim() || "Atmospheric front cover for a boxed murder-mystery game.");
  const meta: string[] = [];
  if (project?.title) meta.push(`TITLE (must appear large on cover, top-center): "${project.title}"`);
  if (marketing?.tagline) meta.push(`TAGLINE (baked directly under the title): "${marketing.tagline}"`);
  if (project?.subtitle) meta.push(`SUBTITLE (small line under title/tagline): "${project.subtitle}"`);
  if (project?.mystery_type) meta.push(`Mystery type: ${project.mystery_type}`);
  if (project?.setting) meta.push(`Setting: ${project.setting}`);
  if (project?.genre) meta.push(`Genre: ${project.genre}`);
  if (project?.year) meta.push(`Year: ${project.year}`);
  if (marketing?.front_subtext) meta.push(`BOTTOM PARAGRAPH (baked across the bottom strip): "${marketing.front_subtext}"`);
  if (marketing?.back_specs) meta.push(`SPECS BADGE (small, baked above the bottom strip — Age / duration / players): "${marketing.back_specs}"`);
  if (company?.company_name) meta.push(`Publisher (logo will be baked TOP-LEFT): ${company.company_name}`);
  if (company?.cover_design_brief) meta.push(`Publisher cover design brief (always-on house style): ${company.cover_design_brief}`);
  if (meta.length) {
    parts.push("");
    parts.push("FRONT BOX-COVER COPY DECK (leave clean zones for these — they will be baked on top):");
    parts.push(meta.map((m) => `- ${m}`).join("\n"));
  }
  parts.push(FRONT_LAYOUT_SUFFIX);
  return parts.join("\n");
}

/** Build the BACK-cover prompt half. Extracted from
 * BarcodeAndBackPanel.composeFinalPrompt so the combined generator can call
 * the same logic without depending on that component. */
export function composeBackPrompt(args: {
  draft: string;
  back: BackMarketingMeta | null | undefined;
  company: CompanyMeta | null | undefined;
  qrCodes: QrLite[] | null | undefined;
}): string {
  const { draft, back, company, qrCodes } = args;
  const headline = back?.back_headline ?? "";
  const body = back?.back_body ?? "";
  const tagline = back?.tagline ?? "";
  const primaryQr = (qrCodes ?? []).find((q) => q.is_primary);
  const secondaryQrs = (qrCodes ?? []).filter((q) => !q.is_primary);
  const copyDeck: string[] = [];
  if (back?.back_teaser) copyDeck.push(`TEASER (ends with arrow → primary QR; YouTube teaser must match): "${back.back_teaser}"`);
  if (back?.back_whats_in_box) copyDeck.push(`CONTENTS: ${back.back_whats_in_box}`);
  if (back?.back_specs) copyDeck.push(`SPECS (Age / duration / players): ${back.back_specs}`);
  if (back?.back_footer_text) copyDeck.push(`FOOTER LINE: "${back.back_footer_text}"`);
  if (company?.company_name) copyDeck.push(`PUBLISHER: ${company.company_name}${company.tagline ? ` — "${company.tagline}"` : ""}`);
  if (company?.address) copyDeck.push(`ADDRESS (printed in bottom strip): ${company.address}`);
  if (company?.legal_text) copyDeck.push(`LEGAL: ${company.legal_text}`);
  if (company?.warning_text) copyDeck.push(`WARNING: ${company.warning_text}`);
  if (company?.box_footer_line) copyDeck.push(`BOX FOOTER LINE: "${company.box_footer_line}"`);
  if (company?.manufactured_by) copyDeck.push(`MANUFACTURED BY: ${company.manufactured_by}`);
  if (company?.distributed_by) copyDeck.push(`DISTRIBUTED BY: ${company.distributed_by}`);
  if (company?.age_rating) copyDeck.push(`AGE RATING: ${company.age_rating}`);
  if (company?.made_in) copyDeck.push(`MADE IN: ${company.made_in}`);

  const qrLines: string[] = [];
  if (primaryQr) qrLines.push(`Primary QR — label "${primaryQr.label ?? "Scan"}", baked LARGE in the LOWER-LEFT.`);
  secondaryQrs.forEach((q, i) => qrLines.push(`Secondary QR ${i + 1} — label "${q.label ?? "Link"}", appears small in the strip below.`));

  return `Design the printable BACK-OF-BOX cover for a premium boxed murder-mystery game.

ART DIRECTION FROM THE WRITER:
${draft.trim() || "(no extra direction — use the headline + body below to set the tone)"}

HEADLINE (place prominently at top): "${headline}"

BODY COPY (reserve enough negative space for it; do NOT render this text):
"""
${body}
"""

${tagline ? `TAGLINE (small): "${tagline}"\n` : ""}${copyDeck.length ? `\nADDITIONAL COPY DECK (the AI does not render these — leave clean negative space for them):\n${copyDeck.map((c) => `- ${c}`).join("\n")}\n` : ""}${qrLines.length ? `\nCODES & LINKS:\n${qrLines.map((l) => `- ${l}`).join("\n")}\nThe ACTUAL barcode (EAN-13 ${back?.barcode_value ?? ""}) and the ACTUAL QR PNGs will be stamped on after generation — do NOT invent fake codes.\n` : ""}${BACK_LAYOUT_SUFFIX}`;
}

/** Compose the single mega-prompt sent to gpt-image-2 with n=2. The model
 *  returns two images that share style across the batch. */
export function composeCoverPairPrompt(args: {
  frontPrompt: string;
  backPrompt: string;
  publisherName: string | null;
  hasReference: boolean;
  /** Number of in-game scene reference images attached after the brand ref. */
  sceneCount?: number;
}): string {
  const { frontPrompt, backPrompt, publisherName, hasReference, sceneCount = 0 } = args;
  const publisher = publisherName ? `publisher: ${publisherName}` : "the same publisher";
  const refLines: string[] = [];
  if (hasReference) {
    refLines.push(
      `REFERENCE 1 (BRAND HOUSE STYLE — ${publisher}): match its palette, lighting, illustration technique, typography mood and paper finish. Do NOT copy its scene; tell THIS case's story with the same brand fingerprint.`,
    );
  }
  if (sceneCount > 0) {
    const start = hasReference ? 2 : 1;
    const end = start + sceneCount - 1;
    refLines.push(
      `REFERENCES ${start}–${end} (${sceneCount} IN-GAME SCENES from this case): these images already exist INSIDE this case's world. The FRONT cover may quote a hero detail from them; the BACK cover MUST visually unify with them — same palette, same lighting, same world.`,
    );
  }
  if (refLines.length === 0) {
    refLines.push(
      `Both images must share the SAME palette, lighting, illustration technique, typography mood and brand fingerprint (${publisher}).`,
    );
  }

  return `You are producing a TWO-IMAGE BATCH for the FRONT and BACK of the SAME boxed murder-mystery game.

CRITICAL — BRAND & WORLD CONTINUITY:
${refLines.join("\n")}
Both images must look like the front and back of the SAME physical box: same world, same color palette, same illustration technique, same lighting, same paper/print finish, same typographic mood. They will sit on the same shelf together.

================================
IMAGE 1 — FRONT COVER (portrait, print-ready, 1024×1536)
================================
${frontPrompt}

================================
IMAGE 2 — BACK COVER (portrait, print-ready, 1024×1536)
================================
${backPrompt}

Return BOTH images. Image 1 = FRONT. Image 2 = BACK. They must be visually unified as the two faces of one product.`;
}
