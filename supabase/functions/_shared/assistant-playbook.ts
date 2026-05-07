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

export type UniversalDocumentDefinition = {
  key: string;
  enabled: boolean;
  title_template: string;
  purpose: string;
  doc_type: string;
  print_size: string;
  list_scope: "planned" | "generated";
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
    task_voice_template: string;
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
    diversity: {
      max_share_per_family_pct: number; // e.g. 25 = no doc_type family > 25% of the set
      min_distinct_doc_types: number; // floor on unique doc_type values across the proposal
      min_distinct_print_sizes: number; // floor on unique print_size values across the proposal
      min_unusual_props_pct: number; // floor share of unusual / creative-prop docs
      min_handwritten_pct: number; // floor share of handwritten/hand-made-feel docs
      paper_palette: string[]; // explicit paper-stock + color/tint variety options to draw from
      family_groups: Record<string, string[]>; // doc_type → family bucket (so "report"/"autopsy report" both count as REPORT)
      rules: string[]; // free-text rules surfaced to the model
    };
  };
  languages: {
    options: string[];
  };
  universal_documents: {
    doc0_enabled: boolean;
    docs: UniversalDocumentDefinition[];
  };
  phases: PhaseDefinition[];
  planning_depth: {
    default: PlanningDepth;
    express: { auto_fill_defaults: Record<string, string>; ask_title: boolean };
    guided: { ask_steps: string[] };
    deep: { extra_probes: string[] };
  };
};

export type PlanningDepth = "express" | "guided" | "deep";

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
    labels: ["1", "2", "3", "4", "5"],
    closing_line_he:
      "פתחו את המעטפה הבאה רק לאחר שסיימתם את המשימה במעטפה זו. כל המסמכים כבר בקופסה — המשיכו לחקור איתם.",
    design_brief_template: `GOAL
A single full-page A4 case-officer briefing page that will be placed inside a physical envelope by the game maker. This is NOT an envelope cover and must never look like an envelope, folder, package, wax-sealed object, or external mailer. It is the printed insert the player reads after opening the physical envelope: an in-world task briefing, recap, or final accusation hand-off.

OUTPUT FORMAT
Single image, portrait orientation, A4 ratio (~2480×3508 px at 300 DPI). Flat archival-style scan of one printed page: no hands, no desk, no envelope, no envelope flap, no wax seal, no photographer shadows. The page fills most of the frame with a small clean gutter, fully legible margins, and enough text-area structure to feel like a real briefing sheet.

VISUAL STYLE
- Choose a page style that fits THIS case's era, setting, genre, and envelope beat: police memo, dispatch briefing, field-office letterhead, intelligence hand-off, captain's note, case-room recap, court-clerk notice, or another page format that makes sense for the story.
- Use appropriate paper stock for a printed insert: official letterhead, thin copier paper, aged station stationery, typed memo paper, faxed sheet, carbon-copy form, telegram-style memo, or other case-specific paper — not kraft/manila envelope stock.
- Include the envelope label/number as a small filing marker or header on the page, not as an envelope-front label.
- Layout should contain a strong briefing title, body text blocks, a clear task section, and a short seal/next-envelope instruction area.
- The page can include subtle stamps, routing marks, signatures, marginal notes, tabs, redactions, or filing codes ONLY when they fit this specific page style.

LAYOUT
1. Top zone: the WORKSPACE COMPANY BRANDING lockup (real publisher logo + company name) when configured — see the COMPANY BRANDING block in the prompt. Envelopes are publisher-branded inserts, NOT in-world agency letterhead, so do NOT invent a fictional precinct/dispatch/ministry crest here. If no company branding is configured, leave the top zone clean (small filing marker only) — do NOT invent a logo.
2. Header: the page insert label and envelope marker (1 / 2 / 3 / 4 / 5) in the game language.
3. Main body: visually believable dense briefing text blocks, with paragraph rhythm and section breaks.
4. Task area: a clearly separated 'Your task' section in the game language.
5. Footer: small reference code, date/time stamp, or officer signature line appropriate to the case.

TYPOGRAPHY
- All game-language text grammatically correct and directionally correct (RTL for Hebrew/Arabic/etc.). No gibberish, no Latin filler.
- Use period-appropriate type: typewriter, government memo typography, police report type, or clean official letterhead depending on the case.
- Make text look like real printed paragraphs, but do not require microscopic fully readable body copy if the image model cannot render every word.

AUTHENTICITY / REALISM VARIETY
Design realism must be chosen fresh for this exact page and must NOT repeat the same generic details across the set. Do not default to coffee stains. Only use coffee/water stains if they make story and document-style sense.
Pick 3–6 tactile details that belong to THIS page format: examples include carbon-copy offset, stapled corner impression, fax noise, uneven typewriter baseline, registrar stamp, punched binder holes, folded dispatch crease, smudged signature, redaction tape, circled paragraph in pencil, archival scan shadow at page edge, official routing initials, courier receipt tear, docket number, or period-correct date stamp. Vary the details, paper, ink, and administrative markings from one page insert to the next.
Looks like a real publisher-branded printed insert from the game maker — NOT a modern Canva mock-up, NOT an envelope, NOT a decorative poster. The only logo on the page is the workspace company logo (when configured). Do NOT invent fictional in-world agency emblems for envelope inserts — those belong on documents, not envelopes.`,
    task_voice_template: `ENVELOPE TASK BODY — A4 IN-CHARACTER LETTER (workspace default)

Each envelope's "task" is the FULL printed insert that goes inside the envelope. It must read like a real case-officer hand-off to the detective and EASILY FILL AN A4 PAGE — sometimes spilling onto a second. Thin notes are unacceptable.

LENGTH
- Envelope #1 and middle envelopes: ~450–700 words. Hard floor: 400 words. Do NOT ship short.
- Final envelope (accusation / solution reveal): ~150–250 words — it carries the accusation form / solution card.

VOICE
- Second-person, addressing "Detective" (game-language equivalent).
- Written in-world by a Case Officer / Dispatcher / Captain.
- Sober, direct, a little weight to it. Period- and setting-appropriate.
- Ends with a short in-character signature line (e.g. "— Dispatch, Central Precinct").

REQUIRED THREE-PART STRUCTURE — every middle and #1 envelope's task body, in this order:

PART A — BRIEFING (env #1) or RECAP (envs #2..#N-1). At least 2 real paragraphs, ~180–280 words.
- Envelope #1 (Mission Briefing): Opens with the equivalent of "Hi, Detective — you've been assigned to this case." Two paragraphs that set the scene: the victim (use approved Phase-1 facts only — never invent a different victim or solution), where and when it happened, the detective's role/jurisdiction, the mood/era of the case, and that the case file in front of them is everything they get. NEVER mention Doc 0, "the contents list", "the index", or "the table of contents" — refer to the materials only as "the case file" / "what's in front of you". Vivid and atmospheric, never spoils the solution.
- Envelopes #2..#N-1 (Stage Recap): Opens with the equivalent of "By now you've probably worked out that…" Two paragraphs that summarise — in-world, as if the player succeeded — what the detective should have figured out by this beat, anchored to the Logic Flow node this envelope gates. Refer to suspects by name when the beat is about them. Acknowledge what's still open ahead. Never name a specific document, never reveal the final culprit/method/motive/red-herring/decisive-clue.

PART B — YOUR TASK. ~80–140 words.
- A clear, visually set-off line: "Your task:" (game-language equivalent).
- ONE vague-but-clear investigative goal in the world, invented to fit THIS case's beat — not template phrasing. Examples of the SHAPE only: "Identify which of the suspects is lying in their statement.", "Place each suspect on the map between 21:00 and 22:30.", "Decide who actually had a reason to want him dead." Use the Logic Flow node and case context to write a fresh, specific-to-this-case goal each time.
- Then 3–5 GENERAL investigative prompts — verbs like work out, narrow down, account for, rule out, reconstruct. NO specific doc/clue/mechanic references.

PART C — SEAL INSTRUCTION. 2–3 lines.
- The equivalent of "Only break the seal on the next envelope once you are sure you have completed this task correctly." Always references "the next envelope" generically — never hints what is inside it.
- One-line sign-off + in-character signature.

ENVELOPE #1 — also:
- Part A is the BRIEFING variant above, with a 2–4 sentence CINEMATIC scene-set opener (weather/place/mood, the moment the case file lands on the desk) before the case-officer's greeting. The case is brand new — no "you've probably worked out…".
- Part B walks the player into the first beat of the Logic Flow with ONE straightforward task on the red bold line.

PART B FORMATTING — RED BOLD TASK LINE (envs #1..#N-1):
- The "Your task:" sentence is ONE single bold red line, on its own line, visually unmistakable on the printed A4 page (period-appropriate equivalents: red typewriter ribbon, red rubber stamp, red marker underline). The 3–5 supporting prompts that follow stay in normal body type.

ENVELOPE #2 RECAP RULE:
- Envelope #2 must open by recapping what the player should have discovered after working through envelope #1's task, then deliver its own follow-up task.

OPTIONAL FOLLOW-UP-CLUE INSERT (any envelope, rare):
- If the writer attaches a follow-up clue note to an envelope, weave a short 2–3 sentence beat into the body telling the detective that an additional in-world enclosure is included in this envelope (e.g. "you'll find a fresh page in this envelope — handle it as new evidence"). Do NOT spoil what's on the extra page.

FINAL ENVELOPE — special shorter shape (~200–320 words):
- One short Part-A-style recap of the whole case so far (1 paragraph).
- SOLUTION CONFIRMATION (the ONE place the answer is allowed): in-character paragraph that confirms the correct accusation — "If you've named [Culprit], you've cracked it. Here's how it really went down…" + 2–4 sentences of what actually happened.
- VIDEO / QR CALL-OUT: instruct the detective to scan the QR code printed on this same page to view the official news report on the case (a fake YouTube news segment). The page mock-up must include a printed QR placeholder + caption.
- Closing line. Does NOT contain a next-task list.

ANTI-SPOILER RULE (LOCKED — non-negotiable, applies to ALL three parts including the new recap)
The task body MUST NOT:
- Name or reference any specific document by number, title, or filename (including Doc 0, "the contents list", "the index", "the table of contents"). Documents are NEVER named in any envelope.
- Reference a specific clue mechanic ("decode the cipher on page 2", "compare the alibis on the timeline grid", "match the prints", "check the receipts").
- Reveal or strongly hint at the culprit, the motive, the murder method, the red herring, or which clue is decisive.
- Tell the player which evidence proves what.
- In Part A recap, reveal answers to beats AFTER the previous envelope's task — only summarise what should already be solved.

Allowed in Part A: naming suspects (they're public), naming the victim, summarising in-world events, naming what the detective is still unsure about. Goals stay at the category level at most ("the materials in your case file", "what you've gathered so far", "the statements you have").`,
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
    "Claude document/file requests may use enabled built-in and custom Claude Skills with code execution; skills should grow over time through installed/enabled SKILL.md packages.",
    "Claude Skills are SKILL.md-based packages: the description/when_to_use frontmatter controls when Claude should use them, supporting files must be referenced from SKILL.md, and disable-model-invocation means manual-only.",
    "When a repeated checklist/playbook/procedure emerges, suggest turning it into a Claude Skill package instead of repeatedly pasting the same instructions.",
    "Save the exact prompt used for PDF/document generation in logs, prompt history, and generated asset metadata so it can be reviewed or copied later.",
    "When generating an asset, choose or ask for the intended output type: Image, Document/file, or Both. Evidence documents default to Document/file, visual props default to Image, and marketing/box assets may use Both.",
    "If the user asks for a document/file from a media or marketing prompt, preserve that prompt as a first-class project asset and route real file creation through the strict document generation flow rather than silently rendering a fake fallback.",
  ],
  design_skeleton: [
    {
      key: "goal",
      name: "GOAL",
      note: "What the document is and what the player should feel.",
      enabled: true,
    },
    {
      key: "text_quality",
      name: "CRITICAL TEXT QUALITY RULES",
      note: "Hebrew must be perfect, no gibberish, no Latin filler.",
      enabled: true,
    },
    {
      key: "output_format",
      name: "OUTPUT FORMAT",
      note: "Size + DPI matching print_size.",
      enabled: true,
    },
    { key: "visual_style", name: "VISUAL STYLE", note: "Era, palette, paper feel.", enabled: true },
    { key: "layout", name: "LAYOUT", note: "Numbered, document-type specific.", enabled: true },
    {
      key: "typography",
      name: "TYPOGRAPHY",
      note: "Fonts, weights, alignment, RTL.",
      enabled: true,
    },
    {
      key: "authenticity",
      name: "AUTHENTICITY RULES",
      note: "Period-correct details, no anachronisms.",
      enabled: true,
    },
    {
      key: "exact_hebrew",
      name: "EXACT HEBREW TEXT TO PLACE",
      note: "Mirror the Hebrew body verbatim — no paraphrasing.",
      enabled: true,
    },
    {
      key: "realism_details",
      name: "ADDITIONAL REALISM DETAILS",
      note: "Concrete stains, stamps, marginalia, etc.",
      enabled: true,
    },
    {
      key: "final_instruction",
      name: "FINAL INSTRUCTION",
      note: "One-line directive to the image model.",
      enabled: true,
    },
  ],
  doc_mode_copy: {
    drafts_label: "Drafts only — I'll generate myself",
    auto_label: "Full auto — ask Image/PDF/Both per doc",
    ask_label: "Ask me each time",
    logic_gate_refusal:
      "Before we generate documents, jump to the Canvas → Logic Flow board and click 'Generate logic flow'. Review the clues, red herrings and final solution it proposes, edit anything you want, then click 'Approve logic'. Once that solution summary is locked in, every document I write will be consistent with it.",
  },
  catalogs: {
    print_sizes: [
      "A4",
      "A5",
      "Letter",
      "Half-letter",
      "Square 15×15",
      "Index card 4×6",
      "Photo 10×15",
    ],
    document_types: [
      "memo",
      "letter",
      "report",
      "transcript",
      "newspaper",
      "photo",
      "ID card",
      "receipt",
      "telegram",
      "police form",
      "bank statement",
      "medical record",
      "ticket stub",
      "business card",
      "map",
      "diagram",
      "cipher",
      "blueprint",
      "ransom note",
    ],
    unusual_document_types: [
      "hand-drawn map",
      "treasure-style chart",
      "matchbook cover",
      "napkin sketch",
      "tarot card",
      "playing card with markings",
      "photo collage",
      "surveillance polaroid",
      "evidence bag tag",
      "ship/building blueprint",
      "coded crossword",
      "torn diary page",
      "wax-sealed letter",
      "microfilm strip",
      "punched IBM card",
      "morse code sheet",
      "one-time pad page",
      "invisible-ink note",
      "lipstick mirror message",
      "pressed flower with note",
      "child's crayon drawing",
      "annotated photograph",
      "shopping list with hidden cipher",
      "fortune-cookie slip",
      "pawn-shop receipt with code",
      "concert ticket with seat-number cipher",
      "bus transfer with handwritten time",
      "library checkout slip",
      "dry-cleaning tag",
      "audio cassette J-card",
      "VHS rental sleeve",
      "luggage tag",
    ],
    diversity: {
      max_share_per_family_pct: 20,
      min_distinct_doc_types: 12,
      min_distinct_print_sizes: 4,
      min_unusual_props_pct: 25,
      min_handwritten_pct: 15,
      paper_palette: [
        "white office bond",
        "cream archival",
        "manila / kraft tan",
        "yellow legal pad",
        "pink carbon-copy",
        "blue carbon-copy",
        "green ledger",
        "newsprint grey",
        "graph paper",
        "lined notebook",
        "onion-skin onionskin",
        "telex / thermal roll",
        "photo glossy",
        "photo matte",
        "vellum / tracing",
        "brown cardboard tag",
        "blueprint cyan",
      ],
      family_groups: {
        REPORT: [
          "report",
          "autopsy report",
          "forensic report",
          "incident report",
          "surveillance report",
          "intelligence report",
          "police report",
          "lab report",
          "after-action report",
        ],
        LETTER: [
          "letter",
          "memo",
          "ransom note",
          "telegram",
          "postcard",
          "wax-sealed letter",
          "torn diary page",
        ],
        TRANSCRIPT: ["transcript", "interrogation transcript", "wiretap transcript", "phone log"],
        FORM: [
          "police form",
          "intake form",
          "evidence bag tag",
          "library checkout slip",
          "dry-cleaning tag",
          "luggage tag",
          "bus transfer",
          "pawn-shop receipt",
        ],
        FINANCIAL: [
          "receipt",
          "bank statement",
          "invoice",
          "ledger entry",
          "ticket stub",
          "concert ticket",
        ],
        ID: ["ID card", "business card", "passport page", "press pass", "badge"],
        MEDIA: [
          "photo",
          "photograph",
          "annotated photograph",
          "surveillance polaroid",
          "photo collage",
          "newspaper",
          "newspaper clipping",
          "microfilm strip",
          "audio cassette J-card",
          "VHS rental sleeve",
        ],
        MAP_DIAGRAM: [
          "map",
          "hand-drawn map",
          "treasure-style chart",
          "diagram",
          "blueprint",
          "ship/building blueprint",
          "floor plan",
        ],
        CIPHER: [
          "cipher",
          "coded crossword",
          "morse code sheet",
          "one-time pad page",
          "invisible-ink note",
          "punched IBM card",
          "shopping list with hidden cipher",
        ],
        TACTILE: [
          "matchbook cover",
          "napkin sketch",
          "tarot card",
          "playing card with markings",
          "child's crayon drawing",
          "fortune-cookie slip",
          "lipstick mirror message",
          "pressed flower with note",
          "wax-sealed letter",
        ],
      },
      rules: [
        "DIVERSITY IS MANDATORY. A document set is FAILED if more than ~20% of items belong to the same family bucket (e.g. > 7 REPORTs in a 35-doc case = REJECT and rebalance). Apply this BEFORE finalising the proposal — don't propose 18 reports and call it done.",
        "Every proposal must hit at least 12 DISTINCT doc_type values (not 12 reports with different titles). Spread across REPORT, LETTER, TRANSCRIPT, FORM, FINANCIAL, ID, MEDIA, MAP_DIAGRAM, CIPHER and TACTILE families — aim for at least 6 different families represented.",
        "Use at least 4 DISTINCT print_size values across the set. A box where every doc is A4 is a failure. Mix in A5, photo sizes, index cards, ticket stubs, half-letter, square formats — drive size off what the prop physically is in the real world.",
        "At least ~25% of the documents should be UNUSUAL / creative-prop types (matchbooks, napkin sketches, tarot, polaroids, hand-drawn maps, cassette J-cards, etc.) — not bureaucratic paperwork. These are what make the box feel tactile.",
        "At least ~15% of the documents should feel HANDWRITTEN or hand-made (margin notes, diary pages, crayon, lipstick, ransom notes) — not typed/printed.",
        "COLOR & PAPER VARIETY: pick paper stock per document from the paper_palette (white bond, cream archival, manila, yellow legal pad, pink/blue carbon, green ledger, newsprint, graph, blueprint cyan, photo glossy, etc.). The proposal must list visibly different paper colors/tints. A monochrome white-paper box is a failure.",
        "Self-audit BEFORE calling propose_document_set: count items per family, count distinct doc_types, count distinct print_sizes, count unusual %, count handwritten %, list paper colors used. If any threshold fails, rebalance the proposal first — do not ship a failing set.",
      ],
    },
  },
  languages: {
    options: ["Hebrew", "English", "Arabic", "Spanish", "French", "German", "Russian"],
  },
  universal_documents: {
    doc0_enabled: true,
    docs: [
      {
        key: "doc0_contents",
        enabled: true,
        title_template: "Doc 0 — Contents / Case File Inventory",
        purpose:
          "Bare contents list for the box. ONE line per item — no descriptions, no purposes, no commentary. Two sections only: (1) Documents — each line is exactly \"#N — Short Name\" (every loose-pile document, including one Police Briefing AND one Interrogation Transcript per suspect, ordered first). (2) Envelopes — each line is exactly \"Envelope N — Short Label\". No tasks, no opening triggers, no spoilers, no solution.",
        doc_type: "contents checklist",
        print_size: "A4",
        list_scope: "planned",
      },
    ],
  },
  phases: [
    { key: "setup", label: "Setup", description: "Phase 1 — gather case identity & brief." },
    {
      key: "summary",
      label: "Summary",
      description: "Phase 2 — write the news-style solution summary.",
    },
    {
      key: "structure",
      label: "Structure",
      description:
        "Phase 3 — suspects, clues, red herrings, deduction logic, sealed task-envelope plan.",
    },
    {
      key: "documents",
      label: "Documents",
      description: "Phase 4 — generate the printable documents (all in the box from the start).",
    },
    {
      key: "envelopes",
      label: "Envelopes",
      description:
        "Phase 5 — finalise sealed task-gate envelopes (opening trigger + payload per envelope).",
    },
    {
      key: "hints",
      label: "Hints",
      description: "Phase 6 — write the graduated hint ladder per stage.",
    },
    {
      key: "packaging",
      label: "Packaging",
      description: "Phase 7 — physical box / print / fulfilment notes.",
    },
    { key: "done", label: "Done", description: "Project complete and ready to ship." },
  ],
  planning_depth: {
    default: "guided",
    express: {
      ask_title: true,
      auto_fill_defaults: {
        mystery_type: "Murder & Homicide",
        genre: "Forensics",
        difficulty: "medium",
        year: "Present day",
        game_language: "Hebrew",
        player_role: "Lead detective",
        case_goal: "Identify the culprit and reconstruct the crime",
        setting: "Israel, present day",
      },
    },
    guided: {
      ask_steps: ["language", "mystery_type", "genre", "titles", "difficulty", "year"],
    },
    deep: {
      extra_probes: [
        "per_suspect_motive",
        "per_suspect_secret",
        "per_suspect_contradiction",
        "per_suspect_relationship_to_victim",
        "per_clue_reasoning",
        "red_herring_rationale",
        "validate_deduction_chain",
      ],
    },
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

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);

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
      let key = String(e.key ?? "")
        .toLowerCase()
        .replace(/[^a-z_]/g, "")
        .slice(0, 32);
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

const cleanUniversalDocs = (
  a: unknown,
  fallback: UniversalDocumentDefinition[],
): UniversalDocumentDefinition[] => {
  if (!Array.isArray(a)) return fallback;
  const out = a
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const e = entry as Partial<UniversalDocumentDefinition>;
      const key = String(e.key ?? slug(String(e.title_template ?? "universal_doc"))).trim();
      const title_template = String(e.title_template ?? "").trim();
      if (!key || !title_template) return null;
      return {
        key,
        enabled: e.enabled !== false,
        title_template,
        purpose: String(e.purpose ?? "").trim(),
        doc_type: String(e.doc_type ?? "contents checklist").trim() || "contents checklist",
        print_size: String(e.print_size ?? "A4").trim() || "A4",
        list_scope: e.list_scope === "generated" ? "generated" : "planned",
      };
    })
    .filter((x): x is UniversalDocumentDefinition => !!x)
    .slice(0, 12);
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
        : [
            ...envLabels,
            ...Array.from({ length: envCount - envLabels.length }, (_, i) =>
              String(envLabels.length + i),
            ),
          ];
  const closing_line_he = cleanString(o.envelopes?.closing_line_he, d.envelopes.closing_line_he);
  const design_brief_template = cleanString(
    o.envelopes?.design_brief_template,
    d.envelopes.design_brief_template,
  );
  const task_voice_template = cleanString(
    (o.envelopes as { task_voice_template?: unknown } | undefined)?.task_voice_template,
    d.envelopes.task_voice_template,
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
    realworld_min_details: clamp(
      Number(o.realism?.realworld_min_details ?? d.realism.realworld_min_details),
      5,
      60,
    ),
    creative_min_details: clamp(
      Number(o.realism?.creative_min_details ?? d.realism.creative_min_details),
      1,
      40,
    ),
    creative_max_details: clamp(
      Number(o.realism?.creative_max_details ?? d.realism.creative_max_details),
      1,
      60,
    ),
  };
  if (realism.creative_max_details < realism.creative_min_details) {
    realism.creative_max_details = realism.creative_min_details;
  }

  const modeRaw = String(o.doc_generation?.default_mode ?? d.doc_generation.default_mode);
  const default_mode = (
    ["drafts", "auto", "ask", "unset"].includes(modeRaw) ? modeRaw : "unset"
  ) as Playbook["doc_generation"]["default_mode"];
  const outputTypeRaw = String(
    o.doc_generation?.output_type_default ?? d.doc_generation.output_type_default,
  );
  const doc_generation = {
    default_mode,
    ask_each_new_project: o.doc_generation?.ask_each_new_project !== false,
    direct_file_first: o.doc_generation?.direct_file_first !== false,
    strict_model_ownership: o.doc_generation?.strict_model_ownership !== false,
    save_file_prompts: o.doc_generation?.save_file_prompts !== false,
    output_type_default: (["image", "document", "both", "ask"].includes(outputTypeRaw)
      ? outputTypeRaw
      : "ask") as Playbook["doc_generation"]["output_type_default"],
  };

  const explanations = {
    paragraphs: clamp(Number(o.explanations?.paragraphs ?? d.explanations.paragraphs), 1, 5),
    max_words: clamp(Number(o.explanations?.max_words ?? d.explanations.max_words), 40, 300),
    include_suggestion: o.explanations?.include_suggestion === true,
  };

  const identity = {
    planning_language: cleanString(o.identity?.planning_language, d.identity.planning_language),
    final_content_language: cleanString(
      o.identity?.final_content_language,
      d.identity.final_content_language,
    ),
    brand_voice: cleanString(o.identity?.brand_voice, d.identity.brand_voice),
    setting_flavor: cleanString(o.identity?.setting_flavor, d.identity.setting_flavor),
  };

  const content_rules = cleanStringArray(o.content_rules, d.content_rules).slice(0, 24);
  const design_skeleton = cleanSectionList(o.design_skeleton, d.design_skeleton);

  const doc_mode_copy = {
    drafts_label: cleanString(o.doc_mode_copy?.drafts_label, d.doc_mode_copy.drafts_label),
    auto_label: cleanString(o.doc_mode_copy?.auto_label, d.doc_mode_copy.auto_label),
    ask_label: cleanString(o.doc_mode_copy?.ask_label, d.doc_mode_copy.ask_label),
    logic_gate_refusal: cleanString(
      o.doc_mode_copy?.logic_gate_refusal,
      d.doc_mode_copy.logic_gate_refusal,
    ),
  };

  const divRaw = (o.catalogs?.diversity ?? {}) as Partial<Playbook["catalogs"]["diversity"]>;
  const dDiv = d.catalogs.diversity;
  const cleanFamilyGroups = (() => {
    const src =
      divRaw.family_groups && typeof divRaw.family_groups === "object"
        ? divRaw.family_groups
        : null;
    if (!src) return dDiv.family_groups;
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(src)) {
      if (typeof k !== "string" || !Array.isArray(v)) continue;
      const arr = v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
      if (arr.length > 0) out[k] = arr;
    }
    return Object.keys(out).length > 0 ? out : dDiv.family_groups;
  })();
  const num = (v: unknown, fb: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fb;
  const catalogs = {
    print_sizes: cleanStringArray(o.catalogs?.print_sizes, d.catalogs.print_sizes).slice(0, 24),
    document_types: cleanStringArray(o.catalogs?.document_types, d.catalogs.document_types).slice(
      0,
      60,
    ),
    unusual_document_types: cleanStringArray(
      o.catalogs?.unusual_document_types,
      d.catalogs.unusual_document_types,
    ).slice(0, 60),
    diversity: {
      max_share_per_family_pct: num(divRaw.max_share_per_family_pct, dDiv.max_share_per_family_pct),
      min_distinct_doc_types: num(divRaw.min_distinct_doc_types, dDiv.min_distinct_doc_types),
      min_distinct_print_sizes: num(divRaw.min_distinct_print_sizes, dDiv.min_distinct_print_sizes),
      min_unusual_props_pct: num(divRaw.min_unusual_props_pct, dDiv.min_unusual_props_pct),
      min_handwritten_pct: num(divRaw.min_handwritten_pct, dDiv.min_handwritten_pct),
      paper_palette: cleanStringArray(divRaw.paper_palette, dDiv.paper_palette).slice(0, 32),
      family_groups: cleanFamilyGroups,
      rules: cleanStringArray(divRaw.rules, dDiv.rules).slice(0, 16),
    },
  };

  const languages = {
    options: cleanStringArray(o.languages?.options, d.languages.options).slice(0, 24),
  };

  const universal_documents = {
    doc0_enabled: o.universal_documents?.doc0_enabled !== false,
    docs: cleanUniversalDocs(o.universal_documents?.docs, d.universal_documents.docs),
  };

  const phases = cleanPhaseList(o.phases, d.phases);

  const pdRaw = o.planning_depth as Partial<Playbook["planning_depth"]> | undefined;
  const defaultDepth: PlanningDepth =
    pdRaw?.default === "express" || pdRaw?.default === "deep" || pdRaw?.default === "guided"
      ? pdRaw.default
      : d.planning_depth.default;
  const expressFill =
    pdRaw?.express?.auto_fill_defaults && typeof pdRaw.express.auto_fill_defaults === "object"
      ? Object.fromEntries(
          Object.entries(pdRaw.express.auto_fill_defaults)
            .filter(([k, v]) => typeof k === "string" && typeof v === "string")
            .map(([k, v]) => [k, String(v)]),
        )
      : d.planning_depth.express.auto_fill_defaults;
  const planning_depth = {
    default: defaultDepth,
    express: {
      ask_title: pdRaw?.express?.ask_title !== false,
      auto_fill_defaults: expressFill,
    },
    guided: {
      ask_steps: cleanStringArray(pdRaw?.guided?.ask_steps, d.planning_depth.guided.ask_steps),
    },
    deep: {
      extra_probes: cleanStringArray(pdRaw?.deep?.extra_probes, d.planning_depth.deep.extra_probes),
    },
  };

  return {
    suspect_counts,
    hints: { per_stage, ladder_labels },
    envelopes: { count: envCount, labels: labelsResized, closing_line_he, design_brief_template, task_voice_template },
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
    universal_documents,
    phases,
    planning_depth,
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
  const ladder = p.hints.ladder_labels.map((label, i) => `  Level ${i + 1} — ${label}`).join("\n");
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
  return `Envelopes (workspace default ≈ ${p.envelopes.count}; the project's APPROVED envelopes roster in CURRENT PROJECT STATE is the source of truth — match that count exactly, typically 5–6, do NOT force the default if the roster differs): ${p.envelopes.labels.join(" / ")}. Envelopes are SEALED TASK GATES, not document containers. All evidence documents live loose in the box from the start; envelopes only hold a full A4 in-character letter from the Case Officer to the Detective (the "task" — vague-but-clear goal, NEVER references specific docs/clues, NEVER spoils the solution). Each envelope has an opening trigger (the case beat that unlocks it). Envelope #1 is the mission briefing (opened first; NEVER names Doc 0 or any specific document — the case file is referred to only as "the case file" / "what's in front of you"). The final envelope is the accusation/solution reveal (shorter, ceremonial). Closing line when language matches: "${p.envelopes.closing_line_he}"`;
}

export function renderEnvelopeDesignTemplate(p: Playbook): string {
  return `A4 PAGE INSERT DESIGN BRIEF TEMPLATE (workspace default — use as the seed when drafting an image prompt for any envelope row, then customise per envelope's label/task and the case era/genre). The generated image is the page placed inside the physical envelope, not the envelope itself:
${p.envelopes.design_brief_template}`;
}

export function renderEnvelopeTaskVoiceTemplate(p: Playbook): string {
  return p.envelopes.task_voice_template;
}

export function renderPhase1OrderSentence(p: Playbook): string {
  const enabled = p.phase1_setup.order.filter((s) => s.enabled);
  const parts = enabled.map((s) =>
    s.key === "titles"
      ? `${p.phase1_setup.title_options_count} numbered Hebrew title options`
      : s.label.toLowerCase(),
  );
  return `Phase 1 Setup: ${parts.join(" → ")}. Save game language to game_language before writing final in-game content. For Hard games discuss an "extra selling point" (physical artifact, USB puzzle, coded insert, etc.).`;
}

export function renderCanonicalVocabBlock(p: Playbook): string {
  const fmt = (list: CanonicalValue[]) => list.map((v) => v.value).join(", ");
  const examples = [...p.vocab.mystery_type, ...p.vocab.genre, ...p.vocab.difficulty]
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
  return `Realism floor — MANDATORY MINIMUM ${p.realism.realworld_min_details} concrete realism details under "ADDITIONAL REALISM DETAILS" for any real-world document type. CRITICAL: realism details must be REASONED FROM THIS SPECIFIC DOCUMENT TYPE + THE GAME'S ERA AND SETTING. Do NOT pick from a generic prop list. Ask yourself "what would a real example of THIS exact document, in THIS year, in THIS setting, actually have on it?" and write THOSE details.

Worked examples of type-driven realism (do NOT copy these — derive your own per document):
  • Police booking sheet (1970s precinct) → mugshot photo strip clipped to top-right, ten-print fingerprint card, booking number stamped in red, arresting officer signature, intake date stamp, height chart background visible behind mugshot.
  • Autopsy report (1950s county morgue) → medical examiner letterhead, toe-tag reference number, anatomical front/back diagram with marks, chain-of-custody seal, pathologist initials in margin.
  • School detention slip (1990s middle school) → student name field, period number circled, teacher initials, three-hole punch, hallway crease from being folded into a pocket, principal's stamp.
  • Telegram (1920s) → Western Union–style header lines (or in-world equivalent), block-cap typed text, time/origin code in top corner, paste-strip seam between header and body.
  • Hotel receipt (1980s motel) → carbon-copy pink underlay bleed, room number scrawled in pen, NCR perforation, manager signature.

HARD RULES:
- Coffee stains and water rings are massively overused. DEFAULT = NONE. The entire game should ship with at most ONE coffee/water stain across the whole document set, and only when it serves the story (e.g. a doc found at a café). Never add one to a clean admin doc, a printed form, an ID card, a receipt, a transcript, a school page, etc.
- Two documents in the same case must NOT share the same realism details. Each doc gets its own type-specific list.
- Generic fallback motifs to avoid as defaults: coffee stains, water rings, fold lines, "smudged ink", staples, "paper aging" without a reason. Use them only when the SPECIFIC document type genuinely calls for them.
- Each item must be concrete (not "looks aged").

Creative / unusual props (maps, hand-drawn diagrams, ciphers, blueprints, matchbook covers, napkin sketches, ransom notes, tarot/playing cards, photo collages, surveillance polaroids, evidence bag tags, ship/building maps, treasure-style charts, anything non-standard): the realism floor does NOT apply. Instead, add ${p.realism.creative_min_details}–${p.realism.creative_max_details} CREATIVE / UNUSUAL DETAILS reasoned from what THIS prop physically is and where it came from in the case. State clearly that this prop trades photorealistic bureaucracy for tactile, creative, prop-style authenticity.`;
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
  const div = p.catalogs.diversity;
  const families = Object.entries(div.family_groups)
    .map(([k, v]) => `    • ${k}: ${v.join(", ")}`)
    .join("\n");
  const rules = div.rules.map((r) => `  - ${r}`).join("\n");
  return `Available print sizes (pick from this list when proposing print_size): ${p.catalogs.print_sizes.join(", ")}.

PER-GAME DOCUMENT TYPE BRAINSTORM (do this BEFORE calling propose_document_set):
The list below is REFERENCE EXAMPLES ONLY — it is NOT a menu to pick from. The actual doc_type values for THIS proposal must be invented from THIS game's setting, era, and characters. Spend a moment brainstorming 8–15 document types that NATURALLY EXIST in this world, then use those.
  • School setting → homework page, hall pass, yearbook page, detention slip, cafeteria menu, report card, locker combination card, science-fair ribbon.
  • Corporate HQ → expense report, business card, lanyard ID badge, internal memo, performance review, conference-room booking slip, severance letter.
  • 1920s séance / occult → calling card, telegram, séance log, newspaper clipping, palmistry diagram, theatre playbill, train ticket stub.
  • 1970s precinct → booking sheet, evidence inventory tag, beat-cop notebook page, polaroid, dispatch radio log, parking citation.
  • Cruise ship / hotel → folio receipt, room-service docket, deck plan, key-card sleeve, cocktail-menu insert, life-raft drill checklist.
  • Hospital → admission form, prescription pad slip, x-ray envelope, nurse's chart, visitor badge, lab requisition.
Do NOT default to police-procedural types unless the case actually involves law enforcement. Do NOT pad with generic "reports". Each doc_type should make a player think "of course this exists in this world".

Reference examples of common types you MAY draw inspiration from (still — invent the actual doc_type strings to fit THIS game): ${p.catalogs.document_types.join(", ")}.
Reference examples of unusual / creative-prop types (these trigger the creative-realism floor, not photo-realism): ${p.catalogs.unusual_document_types.join(", ")}.

DOCUMENT-SET DIVERSITY (HARD RULES — apply to propose_document_set BEFORE you call the tool):
  - No single doc_type family may exceed ${div.max_share_per_family_pct}% of the proposal. Specifically: the player must NOT receive a box where most documents are "reports" — that is the #1 failure mode and is forbidden.
  - At least ${div.min_distinct_doc_types} DISTINCT doc_type values across the proposal.
  - At least ${div.min_distinct_print_sizes} DISTINCT print_size values across the proposal (mix A4 with A5, photo, ticket-stub, index card, half-letter, square, etc. — drive size from what the prop physically is).
  - At least ${div.min_unusual_props_pct}% of items must be unusual / creative-prop types (matchbook, napkin, polaroid, hand-drawn map, cassette J-card, tarot card, etc.).
  - At least ${div.min_handwritten_pct}% of items must feel handwritten or hand-made (margin notes, diary pages, ransom notes, crayon, lipstick, etc.).
  - PAPER & COLOR variety: pick paper stock per document from this palette so the box visually pops — ${div.paper_palette.join(", ")}. A monochrome white-paper box is a failure; the proposal text MUST mention the paper/color choice for each item (e.g. "(yellow legal pad)", "(pink carbon copy)", "(blueprint cyan)").
  - Family buckets used for the cap above:
${families}
  - Rules summary:
${rules}
  - SELF-AUDIT BEFORE CALLING propose_document_set: in your reasoning, list (a) count per family, (b) distinct doc_type count, (c) distinct print_size count, (d) % unusual, (e) % handwritten, (f) the paper colors used. If ANY threshold fails, REBALANCE the proposal first — do not ship a failing set.`;
}

export function renderLanguagesBlock(p: Playbook): string {
  return `Game languages available for per-case final in-game content: ${p.languages.options.join(", ")}. Ask for and save one game_language during Phase 1 unless already set.`;
}

export function renderUniversalDocumentsBlock(p: Playbook): string {
  const docs = p.universal_documents.docs
    .filter((d) => d.enabled)
    .map(
      (d, i) =>
        `${i + 1}. ${d.title_template} (${d.doc_type}, ${d.print_size}) — ${d.purpose} List scope: ${d.list_scope}.`,
    )
    .join("\n");
  return `UNIVERSAL DOCUMENTS (apply to every game)\nDoc 0 enabled: ${p.universal_documents.doc0_enabled ? "yes" : "no"}.\n${docs || "No universal documents enabled."}`;
}

export function renderPhaseEnumComment(p: Playbook): string {
  const lines = p.phases
    .map((ph) => `  • ${ph.key} — ${ph.label}${ph.description ? `: ${ph.description}` : ""}`)
    .join("\n");
  return `PHASES (the \`phase\` field on update_project must be one of these keys):\n${lines}`;
}

export function getPhaseEnum(p: Playbook): string[] {
  return p.phases.map((ph) => ph.key);
}

// ---------- Planning depth ----------

export function normalizePlanningDepth(
  value: unknown,
  fallback: PlanningDepth = "guided",
): PlanningDepth {
  if (value === "express" || value === "guided" || value === "deep") return value;
  return fallback;
}

export function renderPlanningDepthBlock(
  depth: PlanningDepth,
  p: Playbook,
  prevDepth?: PlanningDepth | null,
): string {
  const effectivePrevDepth =
    prevDepth ?? (depth !== p.planning_depth.default ? p.planning_depth.default : null);
  const depthJustChanged = !!effectivePrevDepth && effectivePrevDepth !== depth;
  const changeNotice = depthJustChanged
    ? `🔁 DEPTH CHANGE NOTICE — the user just flipped the Depth selector from "${effectivePrevDepth}" to "${depth}" mid-conversation. Your previous assistant turn was written under the OLD depth ("${effectivePrevDepth}") and is now STALE.

On THIS turn you MUST:
  - Do NOT continue the question ladder you were running under "${effectivePrevDepth}". If your last assistant message asked the user to pick option 1–5 / step N / a phase choice that only existed because of the OLD depth, treat that question as CANCELLED.
  - Open with ONE short acknowledgement sentence ("Got it — switching to ${depth} mode.") and then act per the "${depth}" rules below from this point on.
  - Keep everything that's already APPROVED and PERSISTED in CURRENT PROJECT STATE (title, language, target docs, mystery type, genre, year, difficulty, player role, case goal, setting, selling point, summary, suspects, logic flow, documents). Do NOT re-ask for any of those. Do NOT restart Phase 1 from scratch.
  - Just adjust how much you ask GOING FORWARD per the "${depth}" rules.

`
    : "";
  const header =
    changeNotice +
    `The current PLANNING DEPTH is "${depth}". This value comes from the **Depth selector** in the Assistant header — it is the single source of truth. NEVER ask the user "how deep should we plan?" and NEVER call propose_options for depth choices; the selector already answered. If the user explicitly picks a depth in chat anyway ("Express", "Guided", or "Deep Dive"), immediately call update_project({planning_depth: ...}) before doing anything else so the header selector stays synchronized. The user may flip the selector to a different depth at ANY point during the build (Phase 1, 2, 3, mid-document, anywhere). When they do, the next system prompt arrives with a 🔁 DEPTH CHANGE NOTICE — adopt it immediately on your next turn without re-asking, without restarting earlier work, and without prompting them to confirm. Preserve everything already approved (case identity, summary, suspects, logic flow, document proposals) and just adjust how much you ask going forward.\n\n`;
  if (depth === "express") {
    const fills = Object.entries(p.planning_depth.express.auto_fill_defaults)
      .map(([k, v]) => `      ${k} = ${v}`)
      .join("\n");
    return (
      header +
      `PLANNING DEPTH = EXPRESS (the user wants the AI to plan everything, ask almost nothing)

There are TWO sub-cases — pick the one that matches CURRENT PROJECT STATE:

═══════════════════════════════════════════════════════════════════
SUB-CASE A — EXPRESS ON A FRESH CASE (project.title is empty / placeholder like "New Case", "Untitled", "Test 1" with no other fields filled)
═══════════════════════════════════════════════════════════════════
- Ask the user for ONLY ONE thing: the case TITLE. Either propose 5 Hebrew title options with propose_options OR accept whatever they type.
- After the title is locked in, IMMEDIATELY:
    1. Call \`update_project\` once, passing ALL of these fields together (skip any the user already filled):
${fills}
    2. Then write a short solution summary on your own (3–6 paragraphs) and call \`set_solution_summary\`.
    3. Then call \`generate_logic_flow\`.
    4. Then send ONE assistant message: "✨ Express mode: I've drafted the case identity, summary, and logic flow. Open the Canvas tab, review the Logic Flow board, and click 'Approve logic' when you're happy. From there I'll keep going on documents."

═══════════════════════════════════════════════════════════════════
SUB-CASE B — EXPRESS MID-BUILD (project.title is already a real title — switching INTO Express partway through)
═══════════════════════════════════════════════════════════════════
- Do NOT ask for the title again — it's already set.
- Do NOT continue any Phase 1 question ladder. STOP asking the user step-by-step questions immediately.
- In the SAME turn:
    1. Look at CURRENT PROJECT STATE. For every Phase 1 field that is currently null or empty (player_role, case_goal, setting, selling_point, mystery_type, genre, year, difficulty), pick a sensible default that fits what's already locked in.
    2. Call \`update_project\` ONCE with all those filled-in defaults together. Skip any field the user already answered.
    3. If \`solution_summary\` is empty, draft a short summary (3–6 paragraphs) and call \`set_solution_summary\`.
    4. If \`logic_approved_at\` is null AND a summary now exists, call \`generate_logic_flow\`. (Note: even if you forget, the backend auto-starts logic-flow generation the moment \`set_solution_summary\` is saved on an empty board — but you should still call it explicitly so the chat stays consistent.)
    5. Send ONE short assistant message: "✨ Switched to Express. I filled the remaining setup, drafted the summary, and queued the logic flow — review and approve on the Canvas when ready."

🔴 ABSOLUTE HARD RULE FOR LOGIC FLOW: Writing prose like "I've started drawing the Logic Flow", "the Canvas is being painted", "open Canvas → Logic Flow to watch it paint itself live", or "I've queued the logic flow" WITHOUT first emitting either a \`generate_logic_flow\` tool call OR a \`set_solution_summary\` tool call (which auto-starts the flow as a safety net) IS A HALLUCINATION. The flow does not start. The Canvas stays empty. The user is being lied to. Always emit the tool call first, prose second.
- Do NOT pause for confirmation between steps. The depth switch IS the green light.

═══════════════════════════════════════════════════════════════════
APPLIES TO BOTH SUB-CASES:
- Do NOT ask the user about: player_role, case_goal, setting, selling_point, mystery_type, genre, year, difficulty, suspects' motives, suspects' secrets, contradictions, red herrings, clue-by-clue reasoning, or anything else. The user has explicitly chosen to skip these questions.
- The user may still volunteer extra info — if they do, persist it via update_project and continue.`
    );
  }
  if (depth === "deep") {
    const probes = p.planning_depth.deep.extra_probes
      .map((x) => `  - ${x.replaceAll("_", " ")}`)
      .join("\n");
    return (
      header +
      `PLANNING DEPTH = DEEP DIVE (the user wants to plan thoroughly with lots of detail)
- Use the FULL Phase 1 setup ladder (one question per turn, propose_options where applicable). Do not skip any setup field.
- During Phase 2 / Phase 3 (summary + structure), interrogate the case in depth. For each of these probes, ask a separate question and capture the answer:
${probes}
- For every suspect: ask SEPARATELY about their motive, their secret, their contradiction, and how they relate to the victim. Persist each via update_suspect the moment it's confirmed.
- For every clue: confirm out loud what it proves, what it eliminates, and what red herring (if any) it counters.
- Before moving from Phase 3 to Phase 3.5 (Logic Flow), summarise the deduction chain in prose and ask the user to confirm "yes, generate the Logic Flow" or "wait, I want to revise X".
- Take more turns. The user picked Deep Dive precisely to be asked these questions — do NOT shortcut them.
- IF SWITCHING INTO DEEP DIVE MID-BUILD: do NOT re-litigate already-approved fields from CURRENT PROJECT STATE. Only open up deeper probes for the phase you're currently on or the next one ahead.`
    );
  }
  // guided (default)
  const ask = p.planning_depth.guided.ask_steps.join(", ");
  return (
    header +
    `PLANNING DEPTH = GUIDED (default — basic questions only)
- During Phase 1, ask only the basics IN THIS ORDER, ONE QUESTION PER TURN: ${ask}.
- Skip player_role, case_goal, setting, selling_point unless the user volunteers them in their own message. If they're missing when Phase 1 ends, fill them silently with sensible defaults via update_project — do NOT ask.
- After the year/setting question, propose generating the Logic Flow with propose_options ("Generate Logic Flow now" / "Add a player role first" / "Add a case goal first"). Default to generating immediately.
- During Phase 3 (Structure), ask high-level questions only — name + role for each suspect, the murder weapon, the location. Do NOT ask separately about motives / secrets / contradictions per suspect (Deep Dive does that).
- IF SWITCHING INTO GUIDED MID-BUILD: simply resume basics-only questioning for whatever phase is currently in progress. Do NOT restart Phase 1 if it's already complete; pick up from the next unanswered basic question (or from Phase 2/3 if Phase 1 is done).`
  );
}
