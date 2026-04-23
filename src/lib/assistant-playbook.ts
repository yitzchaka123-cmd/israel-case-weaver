// Assistant Playbook — single source of truth for the assistant's "house rules"
// defaults that previously lived hardcoded inside supabase/functions/assistant-chat.
//
// IMPORTANT: keep this file in sync with `supabase/functions/_shared/assistant-playbook.ts`.
// Defaults are the SAME literal values in both files. If you change one, change the other.

export type CountRange = { min: number; max: number };

export type CanonicalValue = {
  value: string; // canonical English string the assistant must write
  synonyms: string[]; // free-text user inputs that should map to this value
};

export type PhaseSetupStep = {
  key: string; // stable id (mystery_type, genre, titles, difficulty, role, goal, year)
  label: string; // short human label shown in Settings
  enabled: boolean;
};

export type Playbook = {
  suspect_counts: {
    easy: CountRange;
    medium: CountRange;
    hard: CountRange;
  };
  hints: {
    per_stage: number;
    ladder_labels: string[]; // length should match per_stage
  };
  envelopes: {
    count: number;
    labels: string[]; // length === count
    closing_line_he: string; // the fixed Hebrew closing line on every envelope
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
  };
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
  },
  phase1_setup: {
    order: [
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
  },
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
  const closing_line_he =
    typeof o.envelopes?.closing_line_he === "string" && o.envelopes.closing_line_he.trim()
      ? o.envelopes.closing_line_he.trim()
      : d.envelopes.closing_line_he;

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
  const doc_generation = {
    default_mode,
    ask_each_new_project: o.doc_generation?.ask_each_new_project !== false,
  };

  return {
    suspect_counts,
    hints: { per_stage, ladder_labels },
    envelopes: { count: envCount, labels: labelsResized, closing_line_he },
    phase1_setup: { order, title_options_count },
    vocab,
    realism,
    doc_generation,
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

export function renderEnvelopesLine(p: Playbook): string {
  return `Envelopes (fixed ${p.envelopes.count}): ${p.envelopes.labels.join(" / ")}. Tasks short, bold, not overly revealing. Every envelope ends with: "${p.envelopes.closing_line_he}"`;
}

export function renderPhase1OrderSentence(p: Playbook): string {
  const enabled = p.phase1_setup.order.filter((s) => s.enabled);
  const parts = enabled.map((s) =>
    s.key === "titles" ? `${p.phase1_setup.title_options_count} numbered Hebrew title options` : s.label.toLowerCase(),
  );
  return `Phase 1 Setup: ${parts.join(" → ")}. For Hard games discuss an "extra selling point" (physical artifact, USB puzzle, coded insert, etc.).`;
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
