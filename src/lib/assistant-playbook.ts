// Assistant Playbook — single source of truth for the assistant's "house rules"
// defaults that previously lived hardcoded inside supabase/functions/assistant-chat.
//
// IMPORTANT: keep this file in sync with `supabase/functions/_shared/assistant-playbook.ts`.
// Defaults are the SAME literal values in both files. If you change one, change the other.

export type CountRange = { min: number; max: number };

export type CanonicalValue = {
  value: string;
  synonyms: string[];
};

export type PhaseSetupStep = {
  key: string;
  label: string;
  enabled: boolean;
};

export type DesignSkeletonSection = {
  key: string; // stable slug
  name: string; // section header (e.g. GOAL)
  note: string; // optional one-line guidance
  enabled: boolean;
};

export type PhaseDefinition = {
  key: string; // slug, [a-z_]{1,32}, used as `phase` value
  label: string; // human label
  description: string; // short one-liner
};

export type Playbook = {
  suspect_counts: {
    easy: CountRange;
    medium: CountRange;
    hard: CountRange;
  };
  hints: {
    per_stage: number;
    ladder_labels: string[];
  };
  envelopes: {
    count: number;
    labels: string[];
    closing_line_he: string;
    design_brief_template: string;
  };
  phase1_setup: {
    order: PhaseSetupStep[];
    title_options_count: number;
  };
  vocab: {
    mystery_type: CanonicalValue[];
    genre: CanonicalValue[];
    difficulty: CanonicalValue[];
  };
  realism: {
    realworld_min_details: number;
    creative_min_details: number;
    creative_max_details: number;
  };
  doc_generation: {
    default_mode: "drafts" | "auto" | "ask" | "unset";
    ask_each_new_project: boolean;
    direct_file_first: boolean;
    strict_model_ownership: boolean;
    save_file_prompts: boolean;
    output_type_default: "image" | "document" | "both" | "ask";
  };
  explanations: {
    paragraphs: number;
    max_words: number;
    include_suggestion: boolean;
  };
  // ---- v2 additions ----
  identity: {
    planning_language: string;
    final_content_language: string;
    brand_voice: string;
    setting_flavor: string;
  };
  content_rules: string[];
  design_skeleton: DesignSkeletonSection[];
  doc_mode_copy: {
    drafts_label: string;
    auto_label: string;
    ask_label: string;
    logic_gate_refusal: string;
  };
  catalogs: {
    print_sizes: string[];
    document_types: string[];
    unusual_document_types: string[];
  };
  languages: {
    options: string[];
  };
  phases: PhaseDefinition[];
};

export const PLAYBOOK_DEFAULTS: Playbook = {
  suspect_counts: {
    easy: { min: 5, max: 6 },
    medium: { min: 6, max: 7 },
    hard: { min: 8, max: 10 },
  },
  hints: {
    per_stage: 3,
    ladder_labels: ["vague", "helpful", "gives away the task"],
  },
  envelopes: {
    count: 5,
    labels: ["Open First", "1", "2", "3", "4"],
    closing_line_he:
      "פתחו את המעטפה הבאה רק אם אתם בטוחים שביצעתם את המשימה הקודמת כראוי.",
    design_brief_template:
      `GOAL
A single sealed kraft-paper envelope, photographed flat on a neutral background. In-world prop, premium tactile feel — heavy paper stock, slight tooth, faintly aged. The envelope is closed with a wax seal and stamped with the case file's classification.

OUTPUT FORMAT
Single image, portrait orientation, ~2480×3508 px (A4 at 300 DPI). Flat archival-style scan: no hands, no desk, no shadows from a photographer. The envelope fills ~70% of the frame, centered, with a small gutter of clean off-white margin around it.

VISUAL STYLE
- Era-appropriate kraft / manila stock, mild edge wear, faint horizontal fold line.
- One dark red wax seal centered on the flap; subtle cracks along the wax edges.
- A diagonal classification stamp in muted red ink (era-appropriate) — e.g. "סודי" / "Top Secret" / case-specific category.
- A typewritten or rubber-stamped label in the upper-left or center showing the envelope number and short Hebrew label (RTL).
- Optional smaller marks: routing initials in pencil, a small punched hole, a string-and-button closure, an ink fingerprint smudge.

LAYOUT
1. Center: large Hebrew label (RTL) — the envelope's name.
2. Below or beside it: envelope number, framed.
3. Diagonal classification stamp across the upper-third.
4. Bottom-right: small reference code (case id + envelope #).
5. Wax seal centered over the flap line.

TYPOGRAPHY
- Bold formal Hebrew label, era-correct (typewriter, rubber-stamp, or hand-lettered depending on the case).
- All Hebrew text grammatically correct, RTL, no gibberish, no Latin filler.

AUTHENTICITY
Looks like an actual archival envelope from the case era — NOT a modern Canva mock-up. Period-correct paper, ink, and stamp shapes. Never invent real institutional emblems or signatures.`,
  },
  phase1_setup: {
    order: [
      { key: "language", label: "Game language", enabled: true },
      { key: "mystery_type", label: "Mystery type", enabled: true },
      { key: "genre", label: "Genre", enabled: true },
      { key: "titles", label: "Hebrew title options", enabled: true },
      { key: "difficulty", label: "Difficulty", enabled: true },
      { key: "role", label: "Player role", enabled: true },
      { key: "goal", label: "Case goal", enabled: true },
      { key: "year", label: "Year / setting", enabled: true },
    ],
    title_options_count: 5,
  },
  vocab: {
    mystery_type: [
      { value: "Espionage / Intelligence", synonyms: ["ריגול", "Spy", "Espionage"] },
      { value: "Political Intrigue", synonyms: ["פוליטי", "Political"] },
      { value: "Based on Real Events", synonyms: ["אמיתי", "Real Events"] },
      { value: "Terror Plot", synonyms: ["טרור", "Terror"] },
      { value: "Cybercrime", synonyms: ["סייבר", "Cyber"] },
      { value: "Courtroom Drama", synonyms: ["משפט", "Courtroom"] },
      { value: "Murder & Homicide", synonyms: ["רצח", "Murder", "Police procedural"] },
    ],
    genre: [
      { value: "Technological", synonyms: ["טכנולוגי", "Tech"] },
      { value: "Mathematical", synonyms: ["מתמטי", "Math"] },
      { value: "Historical", synonyms: ["היסטורי"] },
      { value: "Forensics", synonyms: ["פרוצדורלי", "Procedural", "Forensic"] },
      { value: "Psychological", synonyms: ["פסיכולוגי"] },
    ],
    difficulty: [
      { value: "easy", synonyms: ["קל", "Easy"] },
      { value: "medium", synonyms: ["בינוני", "Medium"] },
      { value: "hard", synonyms: ["קשה", "Hard"] },
    ],
  },
  realism: {
    realworld_min_details: 20,
    creative_min_details: 8,
    creative_max_details: 15,
  },
  doc_generation: {
    default_mode: "unset",
    ask_each_new_project: true,
    direct_file_first: true,
    strict_model_ownership: true,
    save_file_prompts: true,
    output_type_default: "ask",
  },
  explanations: {
    paragraphs: 2,
    max_words: 120,
    include_suggestion: false,
  },
  identity: {
    planning_language: "English",
    final_content_language: "Hebrew, grammatical, RTL-ready, immersive",
    brand_voice:
      "Premium realism, intelligence-style deduction, layered non-linear solvability. No fantasy. No external knowledge required.",
    setting_flavor: "Always set stories in Israeli environments with Israeli flavor.",
  },
  content_rules: [
    "No sexual content, no sex scandals.",
    "No real politicians or army figures by name. Institutions like Mossad / Shabak are OK.",
    "No single document may spoil the solution. Evidence must cross-reference.",
    "For document/file output, ask the selected model to create the actual file directly first; if it cannot, report that clearly instead of silently rendering or switching models.",
    "Claude document/file requests may use enabled built-in and custom Claude Skills with code execution; skills should grow over time through installed/enabled skills.",
    "Save the exact prompt used for PDF/document generation in logs, prompt history, and generated asset metadata so it can be reviewed or copied later.",
  ],
  design_skeleton: [
    { key: "goal", name: "GOAL", note: "What the document is and what the player should feel.", enabled: true },
    { key: "text_quality", name: "CRITICAL TEXT QUALITY RULES", note: "Hebrew must be perfect, no gibberish, no Latin filler.", enabled: true },
    { key: "output_format", name: "OUTPUT FORMAT", note: "Size + DPI matching print_size.", enabled: true },
    { key: "visual_style", name: "VISUAL STYLE", note: "Era, palette, paper feel.", enabled: true },
    { key: "layout", name: "LAYOUT", note: "Numbered, document-type specific.", enabled: true },
    { key: "typography", name: "TYPOGRAPHY", note: "Fonts, weights, alignment, RTL.", enabled: true },
    { key: "authenticity", name: "AUTHENTICITY RULES", note: "Period-correct details, no anachronisms.", enabled: true },
    { key: "exact_hebrew", name: "EXACT HEBREW TEXT TO PLACE", note: "Mirror the Hebrew body verbatim — no paraphrasing.", enabled: true },
    { key: "realism_details", name: "ADDITIONAL REALISM DETAILS", note: "Concrete stains, stamps, marginalia, etc.", enabled: true },
    { key: "final_instruction", name: "FINAL INSTRUCTION", note: "One-line directive to the image model.", enabled: true },
  ],
  doc_mode_copy: {
    drafts_label: "Drafts only — I'll generate myself",
    auto_label: "Full auto — generate text + image now",
    ask_label: "Ask me each time",
    logic_gate_refusal:
      "Before we generate documents, jump to the Canvas → Logic Flow board and click 'Generate logic flow'. Review the clues, red herrings and final solution it proposes, edit anything you want, then click 'Approve logic'. Once that solution summary is locked in, every document I write will be consistent with it.",
  },
  catalogs: {
    print_sizes: ["A4", "A5", "Letter", "Half-letter", "Square 15×15", "Index card 4×6", "Photo 10×15"],
    document_types: [
      "memo", "letter", "report", "transcript", "newspaper", "photo",
      "ID card", "receipt", "telegram", "police form", "bank statement",
      "medical record", "ticket stub", "business card", "map", "diagram",
      "cipher", "blueprint", "ransom note",
    ],
    unusual_document_types: [
      "hand-drawn map", "treasure-style chart", "matchbook cover", "napkin sketch",
      "tarot card", "playing card with markings", "photo collage", "surveillance polaroid",
      "evidence bag tag", "ship/building blueprint", "coded crossword", "torn diary page",
      "wax-sealed letter", "microfilm strip", "punched IBM card", "morse code sheet",
      "one-time pad page", "invisible-ink note", "lipstick mirror message", "pressed flower with note",
      "child's crayon drawing", "annotated photograph", "shopping list with hidden cipher",
      "fortune-cookie slip", "pawn-shop receipt with code", "concert ticket with seat-number cipher",
      "bus transfer with handwritten time", "library checkout slip", "dry-cleaning tag",
      "audio cassette J-card", "VHS rental sleeve", "luggage tag",
    ],
  },
  languages: {
    options: ["Hebrew", "English", "Arabic", "Spanish", "French", "German", "Russian"],
  },
  phases: [
    { key: "setup", label: "Setup", description: "Phase 1 — gather case identity & brief." },
    { key: "summary", label: "Summary", description: "Phase 2 — write the news-style solution summary." },
    { key: "structure", label: "Structure", description: "Phase 3 — suspects, clues, red herrings, envelope flow." },
    { key: "documents", label: "Documents", description: "Phase 4 — generate the printable documents." },
    { key: "envelopes", label: "Envelopes", description: "Phase 5 — finalise envelope tasks & order." },
    { key: "hints", label: "Hints", description: "Phase 6 — write the graduated hint ladder per stage." },
    { key: "packaging", label: "Packaging", description: "Phase 7 — physical box / print / fulfilment notes." },
    { key: "done", label: "Done", description: "Project complete and ready to ship." },
  ],
};

const clamp = (n: number, lo: number, hi: number) =>
  Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : lo;

const cleanRange = (r: unknown, fallback: CountRange): CountRange => {
  if (!r || typeof r !== "object") return fallback;
  const o = r as { min?: unknown; max?: unknown };
  const min = clamp(Number(o.min ?? fallback.min), 1, 30);
  const max = clamp(Number(o.max ?? fallback.max), 1, 30);
  return { min: Math.min(min, max), max: Math.max(min, max) };
};

const cleanStringArray = (a: unknown, fallback: string[]): string[] => {
  if (!Array.isArray(a)) return fallback;
  const out = a.map((x) => String(x ?? "").trim()).filter(Boolean);
  return out.length > 0 ? out : fallback;
};

const cleanString = (s: unknown, fallback: string): string => {
  if (typeof s !== "string") return fallback;
  const trimmed = s.trim();
  return trimmed || fallback;
};

const cleanVocab = (a: unknown, fallback: CanonicalValue[]): CanonicalValue[] => {
  if (!Array.isArray(a)) return fallback;
  const out = a
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const e = entry as { value?: unknown; synonyms?: unknown };
      const value = String(e.value ?? "").trim();
      if (!value) return null;
      const synonyms = Array.isArray(e.synonyms)
        ? e.synonyms.map((s) => String(s ?? "").trim()).filter(Boolean)
        : [];
      return { value, synonyms };
    })
    .filter((x): x is CanonicalValue => !!x);
  return out.length > 0 ? out : fallback;
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);

const cleanSectionList = (
  a: unknown,
  fallback: DesignSkeletonSection[],
): DesignSkeletonSection[] => {
  if (!Array.isArray(a)) return fallback;
  const out = a
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const e = entry as Partial<DesignSkeletonSection>;
      const name = String(e.name ?? "").trim();
      if (!name) return null;
      const key = String(e.key ?? slug(name) ?? "").trim() || slug(name);
      if (!key) return null;
      return {
        key,
        name,
        note: String(e.note ?? "").trim(),
        enabled: e.enabled !== false,
      };
    })
    .filter((x): x is DesignSkeletonSection => !!x)
    .slice(0, 24);
  return out.length > 0 ? out : fallback;
};

const cleanPhaseList = (a: unknown, fallback: PhaseDefinition[]): PhaseDefinition[] => {
  if (!Array.isArray(a)) return fallback;
  const seen = new Set<string>();
  const out = a
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const e = entry as Partial<PhaseDefinition>;
      let key = String(e.key ?? "").toLowerCase().replace(/[^a-z_]/g, "").slice(0, 32);
      if (!key) key = slug(String(e.label ?? ""));
      if (!key || seen.has(key)) return null;
      seen.add(key);
      const label = String(e.label ?? key).trim() || key;
      const description = String(e.description ?? "").trim();
      return { key, label, description };
    })
    .filter((x): x is PhaseDefinition => !!x)
    .slice(0, 16);
  return out.length > 0 ? out : fallback;
};

/**
 * Deep-merge a (possibly partial / malformed) override onto PLAYBOOK_DEFAULTS.
 * Unknown keys are silently dropped; numbers are clamped to safe ranges.
 * A malformed playbook never breaks anything — worst case it falls back to defaults.
 */
export function resolvePlaybook(override: unknown): Playbook {
  const o = (override && typeof override === "object" ? override : {}) as Partial<Playbook>;
  const d = PLAYBOOK_DEFAULTS;

  const suspect_counts = {
    easy: cleanRange(o.suspect_counts?.easy, d.suspect_counts.easy),
    medium: cleanRange(o.suspect_counts?.medium, d.suspect_counts.medium),
    hard: cleanRange(o.suspect_counts?.hard, d.suspect_counts.hard),
  };

  const per_stage = clamp(Number(o.hints?.per_stage ?? d.hints.per_stage), 1, 10);
  const ladder_labels = cleanStringArray(o.hints?.ladder_labels, d.hints.ladder_labels);

  const envCount = clamp(Number(o.envelopes?.count ?? d.envelopes.count), 1, 12);
  const envLabels = cleanStringArray(o.envelopes?.labels, d.envelopes.labels);
  const labelsResized =
    envLabels.length === envCount
      ? envLabels
      : envLabels.length > envCount
        ? envLabels.slice(0, envCount)
        : [...envLabels, ...Array.from({ length: envCount - envLabels.length }, (_, i) => String(envLabels.length + i))];
  const closing_line_he = cleanString(o.envelopes?.closing_line_he, d.envelopes.closing_line_he);
  const design_brief_template = cleanString(
    o.envelopes?.design_brief_template,
    d.envelopes.design_brief_template,
  );

  const orderRaw = Array.isArray(o.phase1_setup?.order) ? o.phase1_setup!.order : null;
  const order = orderRaw
    ? orderRaw
        .map((s) => {
          if (!s || typeof s !== "object") return null;
          const key = String((s as PhaseSetupStep).key ?? "").trim();
          const def = d.phase1_setup.order.find((x) => x.key === key);
          if (!def) return null;
          return {
            key,
            label: String((s as PhaseSetupStep).label ?? def.label).trim() || def.label,
            enabled: (s as PhaseSetupStep).enabled !== false,
          };
        })
        .filter((x): x is PhaseSetupStep => !!x)
    : d.phase1_setup.order;
  for (const def of d.phase1_setup.order) {
    if (!order.some((step) => step.key === def.key)) order.push(def);
  }
  const title_options_count = clamp(
    Number(o.phase1_setup?.title_options_count ?? d.phase1_setup.title_options_count),
    2,
    10,
  );

  const vocab = {
    mystery_type: cleanVocab(o.vocab?.mystery_type, d.vocab.mystery_type),
    genre: cleanVocab(o.vocab?.genre, d.vocab.genre),
    difficulty: cleanVocab(o.vocab?.difficulty, d.vocab.difficulty),
  };

  const realism = {
    realworld_min_details: clamp(Number(o.realism?.realworld_min_details ?? d.realism.realworld_min_details), 5, 60),
    creative_min_details: clamp(Number(o.realism?.creative_min_details ?? d.realism.creative_min_details), 1, 40),
    creative_max_details: clamp(Number(o.realism?.creative_max_details ?? d.realism.creative_max_details), 1, 60),
  };
  if (realism.creative_max_details < realism.creative_min_details) {
    realism.creative_max_details = realism.creative_min_details;
  }

  const modeRaw = String(o.doc_generation?.default_mode ?? d.doc_generation.default_mode);
  const default_mode = (["drafts", "auto", "ask", "unset"].includes(modeRaw) ? modeRaw : "unset") as Playbook["doc_generation"]["default_mode"];
  const outputTypeRaw = String(o.doc_generation?.output_type_default ?? d.doc_generation.output_type_default);
  const doc_generation = {
    default_mode,
    ask_each_new_project: o.doc_generation?.ask_each_new_project !== false,
    direct_file_first: o.doc_generation?.direct_file_first !== false,
    strict_model_ownership: o.doc_generation?.strict_model_ownership !== false,
    save_file_prompts: o.doc_generation?.save_file_prompts !== false,
    output_type_default: (["image", "document", "both", "ask"].includes(outputTypeRaw) ? outputTypeRaw : "ask") as Playbook["doc_generation"]["output_type_default"],
  };

  const explanations = {
    paragraphs: clamp(Number(o.explanations?.paragraphs ?? d.explanations.paragraphs), 1, 5),
    max_words: clamp(Number(o.explanations?.max_words ?? d.explanations.max_words), 40, 300),
    include_suggestion: o.explanations?.include_suggestion === true,
  };

  const identity = {
    planning_language: cleanString(o.identity?.planning_language, d.identity.planning_language),
    final_content_language: cleanString(o.identity?.final_content_language, d.identity.final_content_language),
    brand_voice: cleanString(o.identity?.brand_voice, d.identity.brand_voice),
    setting_flavor: cleanString(o.identity?.setting_flavor, d.identity.setting_flavor),
  };

  const content_rules = cleanStringArray(o.content_rules, d.content_rules).slice(0, 24);
  const design_skeleton = cleanSectionList(o.design_skeleton, d.design_skeleton);

  const doc_mode_copy = {
    drafts_label: cleanString(o.doc_mode_copy?.drafts_label, d.doc_mode_copy.drafts_label),
    auto_label: cleanString(o.doc_mode_copy?.auto_label, d.doc_mode_copy.auto_label),
    ask_label: cleanString(o.doc_mode_copy?.ask_label, d.doc_mode_copy.ask_label),
    logic_gate_refusal: cleanString(o.doc_mode_copy?.logic_gate_refusal, d.doc_mode_copy.logic_gate_refusal),
  };

  const catalogs = {
    print_sizes: cleanStringArray(o.catalogs?.print_sizes, d.catalogs.print_sizes).slice(0, 24),
    document_types: cleanStringArray(o.catalogs?.document_types, d.catalogs.document_types).slice(0, 60),
    unusual_document_types: cleanStringArray(
      o.catalogs?.unusual_document_types,
      d.catalogs.unusual_document_types,
    ).slice(0, 60),
  };

  const languages = {
    options: cleanStringArray(o.languages?.options, d.languages.options).slice(0, 24),
  };

  const phases = cleanPhaseList(o.phases, d.phases);

  return {
    suspect_counts,
    hints: { per_stage, ladder_labels },
    envelopes: { count: envCount, labels: labelsResized, closing_line_he, design_brief_template },
    phase1_setup: { order, title_options_count },
    vocab,
    realism,
    doc_generation,
    explanations,
    identity,
    content_rules,
    design_skeleton,
    doc_mode_copy,
    catalogs,
    languages,
    phases,
  };
}

// ---------- Prompt fragment renderers (used by both UI preview & edge function) ----------

export function renderSuspectCountsLine(p: Playbook): string {
  const { easy, medium, hard } = p.suspect_counts;
  return `Suspect counts by difficulty — easy: ${easy.min}–${easy.max}, medium: ${medium.min}–${medium.max}, hard: ${hard.min}–${hard.max}.`;
}

export function renderHintsLine(p: Playbook): string {
  return `Hints: ${p.hints.per_stage} per stage — ${p.hints.ladder_labels.join(" → ")}.`;
}

export function renderHintsSystemBlock(p: Playbook): string {
  const ladder = p.hints.ladder_labels
    .map((label, i) => `  Level ${i + 1} — ${label}`)
    .join("\n");
  return `HINT SYSTEM (Phase 5/6 — read carefully)
Each "stage" represents ONE moment in the player's solving journey where they get stuck (a specific clue, deduction, or envelope task). For every stage you write a graduated ladder of ${p.hints.per_stage} Hebrew hints, escalating from a soft nudge to a near-spoiler:
${ladder}

WHEN TO CALL WHICH TOOL:
• \`generate_hint_stage\` — preferred. Given a stage number + (optional) steering, you write all ${p.hints.per_stage} Hebrew hints in one tool call.
• \`add_hint\` — single-row create. Use only when the user asks for ONE hint at a specific stage+level.
• \`update_hint\` — edit an existing hint row by id from the roster.

LINKING HINTS TO THE BOARD:
After writing a stage, drop a matching \`hint\` node on the canvas via \`add_canvas_node\` so the detective board shows which clue/deduction it supports.`;
}

export function renderEnvelopesLine(p: Playbook): string {
  return `Envelopes (fixed ${p.envelopes.count}): ${p.envelopes.labels.join(" / ")}. Tasks short, bold, not overly revealing. Every envelope ends with: "${p.envelopes.closing_line_he}"`;
}

export function renderEnvelopeDesignTemplate(p: Playbook): string {
  return `ENVELOPE DESIGN BRIEF TEMPLATE (workspace default — use as the seed when drafting an image prompt for any envelope row, then customise per envelope's label/task and the case era/genre):
${p.envelopes.design_brief_template}`;
}

export function renderPhase1OrderSentence(p: Playbook): string {
  const enabled = p.phase1_setup.order.filter((s) => s.enabled);
  const parts = enabled.map((s) =>
    s.key === "titles" ? `${p.phase1_setup.title_options_count} numbered Hebrew title options` : s.label.toLowerCase(),
  );
  return `Phase 1 Setup: ${parts.join(" → ")}. Save game language to game_language before writing final in-game content. For Hard games discuss an "extra selling point" (physical artifact, USB puzzle, coded insert, etc.).`;
}

export function renderCanonicalVocabBlock(p: Playbook): string {
  const fmt = (list: CanonicalValue[]) => list.map((v) => v.value).join(", ");
  const examples = [
    ...p.vocab.mystery_type,
    ...p.vocab.genre,
    ...p.vocab.difficulty,
  ]
    .flatMap((v) => v.synonyms.map((syn) => `  "${syn}" → "${v.value}"`))
    .slice(0, 12)
    .join("\n");
  return `CANONICAL FIELD VALUES (use EXACTLY these strings when calling update_project)
- mystery_type ∈ {${fmt(p.vocab.mystery_type)}}
- genre ∈ {${fmt(p.vocab.genre)}}
- difficulty ∈ {${fmt(p.vocab.difficulty)}}  (lowercase English; NEVER Hebrew, NEVER capitalised)
When the user replies in Hebrew or with a synonym, MAP it to the canonical value BEFORE calling update_project. Examples:
${examples}
If you can't map a user's free-text answer to one of the canonical values with confidence, ASK them to pick from the canonical list (numbered + propose_options) instead of inventing a new value. Never write Hebrew strings into mystery_type / genre / difficulty.`;
}

export function renderRealismParagraphs(p: Playbook): string {
  return `Realism floor — MANDATORY MINIMUM ${p.realism.realworld_min_details} concrete realism details under "ADDITIONAL REALISM DETAILS" for any document type that exists in the real world (memos, letters, reports, transcripts, newspapers, photos, ID cards, receipts, telegrams, police forms, bank statements, medical records, ticket stubs, business cards, etc.). Examples of valid realism details: paper aging tone, fold lines, punch holes, staples/paperclips, coffee/water stains, smudged ink, typewriter offset, photocopy shadowing, intake/filing stamps with date format of the era, handwritten marginalia, signature scribbles, classification banners, reference codes, distribution lists, period-correct phone/address formats, ribbon impressions, carbon-copy bleed-through, edge wear, dog-eared corners, perforation marks, redaction bars, tape residue, fingerprint smudges, etc. Each item must be concrete (not "looks aged").

Creative / unusual props (maps, hand-drawn diagrams, ciphers, blueprints, matchbook covers, napkin sketches, ransom notes, tarot/playing cards, photo collages, surveillance polaroids, evidence bag tags, ship/building maps, treasure-style charts, anything non-standard): the realism floor does NOT apply. Instead, add ${p.realism.creative_min_details}–${p.realism.creative_max_details} CREATIVE / UNUSUAL DETAILS that make the prop feel hand-made, in-world, and surprising — e.g. a smudged compass rose with a personal initial, a coded margin doodle, a torn corner taped back on, a coffee-ring obscuring one room on the map, a crayon arrow added by a child, a misspelling crossed out by hand, a hidden symbol only visible at an angle, a fictitious printer mark, an unusual aspect ratio, an inserted Polaroid, etc. State clearly that this prop trades photorealistic bureaucracy for tactile, creative, prop-style authenticity.`;
}

export function renderExplanationLengthLine(p: Playbook): string {
  return `Canvas node AI explanations: ${p.explanations.paragraphs} short paragraph(s), maximum ${p.explanations.max_words} words total${p.explanations.include_suggestion ? ", include one concrete strengthening suggestion when useful" : ", do not add a strengthening suggestion unless essential"}.`;
}

// ---------- v2 renderers ----------

export function renderIdentityBlock(p: Playbook): string {
  return `IDENTITY & STYLE
- Planning/editing conversation: ${p.identity.planning_language}.
- Final in-game content (titles, documents, hints, envelope text): ${p.identity.final_content_language}.
- ${p.identity.brand_voice}
- ${p.identity.setting_flavor}`;
}

export function renderContentRulesBlock(p: Playbook): string {
  const lines = p.content_rules.map((r) => `- ${r}`).join("\n");
  return `CONTENT RULES (strict)\n${lines}`;
}

export function renderDesignSkeletonLine(p: Playbook): string {
  const enabled = p.design_skeleton.filter((s) => s.enabled);
  const ordered = enabled.map((s) => s.name).join(" · ");
  return `Format it with these sections, in this order:\n  ${ordered}`;
}

export function renderDocModeButtonsBlock(p: Playbook): string {
  return `   1) "${p.doc_mode_copy.drafts_label}"
   2) "${p.doc_mode_copy.auto_label}"
   3) "${p.doc_mode_copy.ask_label}"`;
}

export function renderLogicGateRefusal(p: Playbook): string {
  return `"${p.doc_mode_copy.logic_gate_refusal}"`;
}

export function renderCatalogsBlock(p: Playbook): string {
  return `Available print sizes (pick from this list when proposing print_size): ${p.catalogs.print_sizes.join(", ")}.
Common document types (pick from this list when proposing doc_type, but invent variants when needed): ${p.catalogs.document_types.join(", ")}.
Unusual / creative-prop document types (use these when the case calls for tactile, surprising, hand-made props instead of bureaucratic paperwork — they trigger the creative-realism floor, not the photo-realism one): ${p.catalogs.unusual_document_types.join(", ")}.`;
}

export function renderLanguagesBlock(p: Playbook): string {
  return `Game languages available for per-case final in-game content: ${p.languages.options.join(", ")}. Ask for and save one game_language during Phase 1 unless already set.`;
}

export function renderPhaseEnumComment(p: Playbook): string {
  const lines = p.phases.map((ph) => `  • ${ph.key} — ${ph.label}${ph.description ? `: ${ph.description}` : ""}`).join("\n");
  return `PHASES (the \`phase\` field on update_project must be one of these keys):\n${lines}`;
}

export function getPhaseEnum(p: Playbook): string[] {
  return p.phases.map((ph) => ph.key);
}
