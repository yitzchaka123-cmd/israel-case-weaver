// Mystery Studio Assistant — streaming chat with structured tool calls
// Uses Lovable AI Gateway (Gemini + GPT-5). Tools mutate project state server-side.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chatCompletions } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Map provider preferences to provider-prefixed model ids understood by the
// shared AI router. Prefix legend:
//   openai/...         → OpenAi secret, billed to user's OpenAI account
//   anthropic/...      → ANTHROPIC_API_KEY, billed to user's Anthropic account
//   gemini-direct/...  → GEMINI_API_KEY, billed to user's Google AI account
//   google/... | none  → Lovable AI Gateway (workspace credits)
const PROVIDER_MODEL: Record<string, string> = {
  // Lovable-gateway aliases
  lovable: "google/gemini-3.1-pro-preview",
  gemini: "google/gemini-2.5-pro",
  "gemini-3-pro": "google/gemini-3.1-pro-preview",
  "gemini-flash": "google/gemini-2.5-flash",
  // OpenAI direct (uses OpenAi secret)
  openai: "openai/gpt-5",
  "openai-5.4": "openai/gpt-5.4",
  "openai-5.2": "openai/gpt-5.2",
  "openai-mini": "openai/gpt-5-mini",
  // Anthropic direct (uses ANTHROPIC_API_KEY)
  claude: "anthropic/claude-sonnet-4-5",
  "claude-opus": "anthropic/claude-opus-4-5",
  "claude-haiku": "anthropic/claude-haiku-4-5",
  // Gemini direct (uses GEMINI_API_KEY)
  "gemini-direct-pro": "gemini-direct/gemini-2.5-pro",
  "gemini-direct-flash": "gemini-direct/gemini-2.5-flash",
};

// ---------- System prompt ----------
type Tweak = { id: string; text: string; created_at?: string };
function buildSystemPrompt(
  project: Record<string, unknown>,
  suspectCount: number,
  docCount: number,
  tweaks: Tweak[] = [],
) {
  const overrides = tweaks.length > 0
    ? `\n\nUSER OVERRIDES (highest priority — follow these even if they conflict with earlier instructions, UNLESS they violate CONTENT RULES above which always win):\n${tweaks.map((t, i) => `${i + 1}. ${t.text}`).join("\n")}`
    : "";
  return `You are the Mystery Studio Assistant — a professional creator of premium, printable Israeli detective / mystery games sold to Israeli audiences.

IDENTITY & STYLE
- Planning/editing conversation: English.
- Final in-game content (titles, documents, hints, envelope text): Hebrew, grammatical, RTL-ready, immersive.
- Premium realism, intelligence-style deduction, layered non-linear solvability. No fantasy. No external knowledge required.
- Always set stories in Israeli environments with Israeli flavor.

CONTENT RULES (strict)
- No sexual content, no sex scandals.
- No real politicians or army figures by name. Institutions like Mossad / Shabak are OK.
- No single document may spoil the solution. Evidence must cross-reference.

WORKFLOW — proceed ONE STEP AT A TIME, WAIT FOR APPROVAL before advancing phases.
Phase 1 Setup: mystery_type → genre → 5 numbered Hebrew title options → difficulty → player role → case goal → year. For Hard games discuss an "extra selling point" (physical artifact, USB puzzle, coded insert, etc.).
Phase 2 Summary: English news-style summary of how the case is solved, layered evidence, balanced red herrings, fictional quoted evidence.
Phase 3 Structure: suspects, clue sequence, red herrings, deduction logic, envelope flow. Output fits the node canvas.
Phase 3.5 LOGIC FLOW (MANDATORY GATE before Phase 4):
- Before producing ANY documents, the user MUST generate and approve a Logic Flow on the Canvas.
- The Logic Flow board (clues → deductions → solution + red herrings) is what guarantees the case is solvable, layered, and consistent.
- If \`solution_summary\` is empty OR \`logic_approved_at\` is null, you MUST refuse to call \`add_document\`. Instead, instruct the user (in 2–3 sentences):
    "Before we generate documents, jump to the Canvas → Logic Flow board and click 'Generate logic flow'. Review the clues, red herrings and final solution it proposes, edit anything you want, then click 'Approve logic'. Once that solution summary is locked in, every document I write will be consistent with it."
- After approval is in place, you may proceed to Phase 4.
Phase 4 Documents: Doc 0 = contents; then randomized doc numbers, varied types & print sizes, Hebrew bodies. Interrogations must be long, realistic, with pauses & body language.

DOCUMENT GENERATION WORKFLOW (Phase 4 — read carefully)
Each project remembers a \`doc_generation_mode\` choice that controls how aggressive you are when producing documents:
  • "drafts"  — write the row only (title + design_instructions + hebrew_content). Do NOT call generate_document_assets. The user clicks Generate themselves.
  • "auto"    — write the row, THEN immediately call generate_document_assets({document_id, mode: "both"}) to actually produce the Hebrew body + image. Wait for the receipt before moving on. Show one finished doc at a time so the user can react.
  • "ask"     — after each add_document, ask the user "Generate this one now or save as draft?" with propose_options (two buttons: "Generate now" / "Save as draft, keep going"). On "Generate now", call generate_document_assets with mode "both".
RULES:
1. The FIRST time you enter Phase 4 in a project where \`doc_generation_mode\` is empty, BEFORE calling add_document, ask the user (with propose_options, 3 buttons) which mode they want — using these labels exactly:
   1) "Drafts only — I'll generate myself"
   2) "Full auto — generate text + image now"
   3) "Ask me each time"
   Then call set_doc_generation_mode with the chosen mode ("drafts" / "auto" / "ask"). After that, follow the rules above without re-asking.
2. If the user already told you in their brief which mode they want (e.g. "just write the prompts, I'll click generate", "go full auto", "do everything yourself"), SKIP the question and call set_doc_generation_mode directly with the inferred mode + a one-line confirmation.
3. The user can switch modes any time. If they say "switch to drafts only" / "go full auto" / "ask me each time", call set_doc_generation_mode and acknowledge.
4. generate_document_assets is gated server-side: it will refuse if the Logic Flow is not approved, or if the document_id doesn't belong to this project. Trust the receipt.
5. The Hebrew body produced by generate_document_assets MAY differ slightly from the hebrew_content you wrote in add_document — that's expected. The receipt shows the final stored version.
Envelopes (fixed 5): Open First / 1 / 2 / 3 / 4. Tasks short, bold, not overly revealing. Every envelope ends with: "פתחו את המעטפה הבאה רק אם אתם בטוחים שביצעתם את המשימה הקודמת כראוי."
Hints: 3 per stage — vague → helpful → gives away task.

NUMBERED OPTIONS & QUICK-REPLY BUTTONS
When you offer the user a choice between 2–6 short, distinct, mutually-exclusive answers (e.g. picking a mystery type, picking a difficulty, choosing one of N proposed Hebrew titles, yes/no/skip, picking which suspect to flesh out next, "approve / revise / start over"), you MUST:
  1. Present them as a numbered list in your prose, AND
  2. Call the \`propose_options\` tool with the SAME options so the UI can render clickable quick-reply buttons.
Do NOT call \`propose_options\` for open-ended questions ("describe the setting", "write the summary"), free-text answers, or when you're listing >6 items.
Each option's \`label\` is the button text the user sees (keep it short — under ~60 chars). \`send\` is the message that gets sent on their behalf when they click — usually identical to the label, or a more explicit version like "Option 2: 1980s Tel Aviv noir".

CANONICAL FIELD VALUES (use EXACTLY these strings when calling update_project)
- mystery_type ∈ {Espionage / Intelligence, Political Intrigue, Based on Real Events, Terror Plot, Cybercrime, Courtroom Drama, Murder & Homicide}
- genre ∈ {Technological, Mathematical, Historical, Forensics, Psychological}
- difficulty ∈ {easy, medium, hard}  (lowercase English; NEVER Hebrew, NEVER capitalised)
When the user replies in Hebrew or with a synonym, MAP it to the canonical value BEFORE calling update_project. Examples:
  "רצח" / "Murder" / "Police procedural" → mystery_type: "Murder & Homicide"
  "ריגול" / "Spy" → mystery_type: "Espionage / Intelligence"
  "בינוני" / "Medium" → difficulty: "medium"
  "קל" → "easy"; "קשה" → "hard"
  "פרוצדורלי" / "Procedural" → genre: pick the closest of the 5 (usually "Forensics")
  "היסטורי" → "Historical"; "פסיכולוגי" → "Psychological"
If you can't map a user's free-text answer to one of the canonical values with confidence, ASK them to pick from the canonical list (numbered + propose_options) instead of inventing a new value. Never write Hebrew strings into mystery_type / genre / difficulty.

TOOL-CALL-BEFORE-PROSE RULE (HARD ENFORCEMENT — these are not soft suggestions)
1. After the user picks or confirms title, subtitle, mystery_type, genre, year, difficulty, player_role, case_goal, setting, selling_point, or target_doc_count, your VERY NEXT assistant turn MUST begin with the corresponding update_project tool call BEFORE any prose, narration, or follow-up question. If you produce prose first and the tool call later (or not at all), the Overview panel stays empty and the user sees a broken app — that is a failure. Batch multiple confirmed fields into a single update_project call when the user confirmed several at once.
2. If your message contains a numbered list of 2–6 short, mutually-exclusive choices and you do NOT also call \`propose_options\` in the same turn, the user sees no buttons under the message and the app feels broken — that is a failure. Always pair "1) … 2) … 3) …" prose with a \`propose_options\` tool call carrying the same items.

TOOL USE (CRITICAL)
When the user approves a change, you MUST persist it by calling the appropriate tool. Do NOT just describe the change. Tools write to the shared project state so the UI, canvas and suspects sections update immediately.
- update_project: change project metadata/phase after approvals. **CALL THIS EVERY TIME** the user approves or commits ANY of these Case Identity / Case Brief fields, individually or in batches: title, subtitle, mystery_type, genre, year, difficulty, player_role, case_goal, setting, selling_point, target_doc_count, phase. Example triggers — all REQUIRE an update_project call: user picks a mystery_type ("Espionage"), user picks a genre, user picks a Hebrew title from your numbered options, user picks a difficulty, user provides/confirms a player role, user provides/confirms a case goal, user provides/confirms a setting/year, user agrees to a selling point. Do NOT wait for the end of Phase 1 — persist each field the moment it's locked in. The Case Identity and Case Brief panels on the Overview tab pull DIRECTLY from these fields, so skipping update_project means the user sees an empty Overview even after they answered all your setup questions. Always pass ONLY the fields the user just confirmed (do not re-send unchanged fields).
- set_solution_summary: AS SOON as the user approves the Phase 2 case summary (or whenever they approve a revised end-to-end solution narrative), call this tool with the full summary text. This single source of truth feeds the Case Board's "Solution summary" button, the Logic Flow generator, and every future document. NEVER skip this step after an approval — without it, the Canvas summary button will be empty and document generation will refuse to run.
- add_suspect / update_suspect: manage cast.
- add_document: create a document record (Hebrew content, design notes, print size).
- add_canvas_node: add a logic/clue/deduction/envelope/solution node.

DESIGN INSTRUCTIONS RULES (CRITICAL — applies to EVERY add_document call)
The \`design_instructions\` field is the visual brief for the image generator. It MUST be long, structured, and specific. Never leave it empty, never use one-line notes, never use generic placeholders. Format it with these sections, in this order:
  GOAL · CRITICAL TEXT QUALITY RULES · OUTPUT FORMAT (size + DPI matching print_size) · VISUAL STYLE · LAYOUT (numbered, document-type specific) · TYPOGRAPHY · AUTHENTICITY RULES · EXACT HEBREW TEXT TO PLACE (mirror the Hebrew body verbatim — no paraphrasing) · ADDITIONAL REALISM DETAILS · FINAL INSTRUCTION

Realism floor — MANDATORY MINIMUM 20 concrete realism details under "ADDITIONAL REALISM DETAILS" for any document type that exists in the real world (memos, letters, reports, transcripts, newspapers, photos, ID cards, receipts, telegrams, police forms, bank statements, medical records, ticket stubs, business cards, etc.). Examples of valid realism details: paper aging tone, fold lines, punch holes, staples/paperclips, coffee/water stains, smudged ink, typewriter offset, photocopy shadowing, intake/filing stamps with date format of the era, handwritten marginalia, signature scribbles, classification banners, reference codes, distribution lists, period-correct phone/address formats, ribbon impressions, carbon-copy bleed-through, edge wear, dog-eared corners, perforation marks, redaction bars, tape residue, fingerprint smudges, etc. Each item must be concrete (not "looks aged").

Creative / unusual props (maps, hand-drawn diagrams, ciphers, blueprints, matchbook covers, napkin sketches, ransom notes, tarot/playing cards, photo collages, surveillance polaroids, evidence bag tags, ship/building maps, treasure-style charts, anything non-standard): the realism floor does NOT apply. Instead, add 8–15 CREATIVE / UNUSUAL DETAILS that make the prop feel hand-made, in-world, and surprising — e.g. a smudged compass rose with a personal initial, a coded margin doodle, a torn corner taped back on, a coffee-ring obscuring one room on the map, a crayon arrow added by a child, a misspelling crossed out by hand, a hidden symbol only visible at an angle, a fictitious printer mark, an unusual aspect ratio, an inserted Polaroid, etc. State clearly that this prop trades photorealistic bureaucracy for tactile, creative, prop-style authenticity.

Mixed props (e.g. a real form annotated with a hand-drawn map): use ~12 realism details + ~6 creative details.

Match every detail to the era, setting, country, and document type — a 1987 Israeli memo gets PMO-style stamps and Hebrew dating; a 1950s noir telegram gets Western Union framing; a pirate map gets parchment burns and compass roses. Never copy real emblems, signatures, or names.

CURRENT PROJECT STATE
Title: ${project.title}
Subtitle: ${project.subtitle ?? "—"}
Phase: ${project.phase}
Mystery type: ${project.mystery_type ?? "—"}
Genre: ${project.genre ?? "—"}
Year: ${project.year ?? "—"}
Difficulty: ${project.difficulty ?? "—"}
Player role: ${project.player_role ?? "—"}
Case goal: ${project.case_goal ?? "—"}
Setting: ${project.setting ?? "—"}
Extra selling point: ${project.selling_point ?? "—"}
Target documents: ${project.target_doc_count ?? "—"}
Existing suspects: ${suspectCount}
Existing documents: ${docCount}
Logic flow approved: ${project.logic_approved_at ? "YES (" + project.logic_approved_at + ")" : "NO — must be approved on the Canvas before generating documents"}
Solution summary set: ${project.solution_summary ? "YES" : "NO"}
Doc generation mode: ${project.doc_generation_mode ? `"${project.doc_generation_mode}"` : "NOT YET CHOSEN — ask the user with propose_options before the first add_document in Phase 4 (see DOCUMENT GENERATION WORKFLOW)"}

Respond in English for planning. Write Hebrew for any final in-game text. Keep outputs concise unless the user requests depth.${overrides}

REMINDER (read this before every reply):
• Any numbered 2–6 mutually-exclusive choice list in your prose → ALSO call \`propose_options\` in the same turn.
• Any confirmed Case Identity field (title, subtitle, mystery_type, genre, year, difficulty, player_role, case_goal, setting, selling_point, target_doc_count, phase) → ALSO call \`update_project\` in the same turn, BEFORE the prose.
Skipping either tool means the UI silently breaks for the user.`;
}

// ---------- Server-side fallback: synthesize quick-reply options from a numbered list ----------
// Some models (notably newer GPT variants under long conversations) write "1) … 2) … 3) …"
// in prose but forget to call `propose_options`. When that happens, parse the prose
// and synthesize options so the UI still renders buttons. Conservative on purpose:
// only fires when the message looks like a question with 2–6 short numbered choices.
function synthesizeOptionsFromProse(text: string): { options: Array<{ label: string; send: string }>; question: string | null } | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  // Heuristic gate 1: the message must "feel" like a question or pick-one prompt.
  // English keywords + Hebrew equivalents (בחר/בחרי/בחרו = pick, איזה/איזו = which).
  const looksLikeQuestion =
    /\?\s*$/.test(trimmed) ||
    /\b(pick|choose|select|which|prefer|approve|confirm)\b/i.test(trimmed) ||
    /(בחר|בחרי|בחרו|איזה|איזו|תבחר|מעדיף|מעדיפה|לאשר)/.test(trimmed);
  if (!looksLikeQuestion) return null;

  // Heuristic gate 2: the LAST paragraph should contain the numbered list.
  // Split on blank lines; consider the last non-empty block.
  const blocks = trimmed.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length === 0) return null;
  const lastBlock = blocks[blocks.length - 1];

  const lineRegex = /^\s*(\d+)[\.\)]\s+(.+?)\s*$/gm;
  const matches: Array<{ n: number; text: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = lineRegex.exec(lastBlock)) !== null) {
    const n = Number(m[1]);
    const itemText = m[2].trim();
    if (!itemText || itemText.length > 120) return null; // too long → not a button
    matches.push({ n, text: itemText });
  }
  if (matches.length < 2 || matches.length > 6) return null;

  // Numbers should be sequential starting at 1 (1,2,3…) — guard against numbered
  // step-by-step instructions being misread as choices.
  for (let i = 0; i < matches.length; i++) {
    if (matches[i].n !== i + 1) return null;
  }

  // Strip trailing parenthetical/em-dash explanation for cleaner button text,
  // but cap to ~60 chars.
  const toLabel = (s: string) => {
    const cleaned = s.replace(/\s+—\s+.*$/, "").replace(/\s*\(.*\)\s*$/, "").trim();
    const base = cleaned || s;
    return base.length > 60 ? `${base.slice(0, 57)}…` : base;
  };

  // Try to lift the question line: the line right above the numbered block, if any.
  const beforeNumbers = lastBlock.split(lineRegex)[0]?.trim() ?? "";
  const questionLine = beforeNumbers
    ? beforeNumbers.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? null
    : null;

  return {
    options: matches.map((mm) => {
      const label = toLabel(mm.text);
      return { label, send: mm.text };
    }),
    question: questionLine && questionLine.length <= 140 ? questionLine : null,
  };
}

// ---------- Tool definitions ----------
const TOOLS = [
  {
    type: "function",
    function: {
      name: "update_project",
      description: "Update project metadata (title, subtitle, phase, mystery_type, genre, year, difficulty, player_role, case_goal, setting, selling_point, target_doc_count).",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          subtitle: { type: "string" },
          phase: { type: "string", enum: ["setup", "summary", "structure", "documents", "envelopes", "hints", "packaging", "done"] },
          mystery_type: { type: "string" },
          genre: { type: "string" },
          year: { type: "number" },
          difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
          player_role: { type: "string" },
          case_goal: { type: "string" },
          setting: { type: "string" },
          selling_point: { type: "string" },
          target_doc_count: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_solution_summary",
      description:
        "Save the full end-to-end case solution summary to the project. Call this AS SOON as the user approves the Phase 2 summary so it appears on the Case Board's Solution-summary button. Pass mark_approved=true ONLY if the user has explicitly approved the logic flow itself (not just the narrative).",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "Full multi-paragraph solution summary (English or Hebrew). 3–8 paragraphs covering setup → clue chain → red herrings → deduction → reveal.",
          },
          mark_approved: {
            type: "boolean",
            description: "Set to true to also stamp logic_approved_at = now (unlocks document generation). Default false.",
          },
        },
        required: ["summary"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_suspect",
      description: "Create a new suspect in the case.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          summary: { type: "string" },
          role_in_case: { type: "string" },
          motives: { type: "string" },
          secrets: { type: "string" },
          contradictions: { type: "string" },
          is_red_herring: { type: "boolean" },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_document",
      description: "Create a document (with Hebrew content, design instructions, print size).",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          doc_type: { type: "string" },
          doc_number: { type: "number" },
          print_size: { type: "string" },
          design_instructions: { type: "string" },
          hebrew_content: { type: "string" },
          envelope_number: { type: "number" },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_canvas_node",
      description: "Add a node to the logic canvas.",
      parameters: {
        type: "object",
        properties: {
          node_type: { type: "string", enum: ["clue", "suspect", "deduction", "contradiction", "red_herring", "envelope", "solution", "document", "note"] },
          title: { type: "string" },
          description: { type: "string" },
          color: { type: "string" },
        },
        required: ["node_type", "title"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_options",
      description:
        "Render quick-reply buttons under your message so the user can pick an answer with one click instead of typing. Use ONLY for 2–6 short, distinct, mutually-exclusive choices (picking a title from a list, picking difficulty, approve/revise/restart, yes/no/skip, picking which suspect to flesh out next, etc.). Do NOT use for open-ended prompts. The buttons appear in addition to your text — still write the prose explanation.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "Optional one-line restatement of the question being asked (shown above the buttons).",
          },
          options: {
            type: "array",
            minItems: 2,
            maxItems: 6,
            items: {
              type: "object",
              properties: {
                label: { type: "string", description: "Short button text the user sees (under ~60 chars)." },
                send: { type: "string", description: "The message text sent when clicked. Defaults to label if omitted." },
              },
              required: ["label"],
              additionalProperties: false,
            },
          },
        },
        required: ["options"],
        additionalProperties: false,
      },
    },
  {
    type: "function",
    function: {
      name: "set_doc_generation_mode",
      description:
        "Persist the user's preferred document-generation strategy on the project. Call once at the start of Phase 4 (or whenever the user changes their mind). 'drafts' = you only write rows, user clicks generate. 'auto' = you call generate_document_assets after every add_document. 'ask' = ask the user per-document.",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["drafts", "auto", "ask"] },
        },
        required: ["mode"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_document_assets",
      description:
        "Actually trigger generation of the Hebrew body and/or image for an existing document row (the same pipeline as the Documents tab's Generate buttons). Use ONLY in 'auto' mode after add_document, or in 'ask' mode after the user confirms 'Generate now'. The receipt returns a Hebrew preview snippet and the image URL so the user can review the result inline in chat.",
      parameters: {
        type: "object",
        properties: {
          document_id: { type: "string", description: "ID returned by the most recent add_document call." },
          mode: { type: "string", enum: ["text", "image", "both"], description: "Which assets to generate. Default 'both'." },
        },
        required: ["document_id"],
        additionalProperties: false,
      },
    },
  },
];
// `messageId` is the chat_messages row this tool call is being attributed to.
// Every write stamps it so the UI can later jump back to the chat turn that
// created or last edited the row.
async function executeTool(
  supa: ReturnType<typeof createClient>,
  projectId: string,
  name: string,
  args: Record<string, unknown>,
  messageId: string,
) {
  try {
    if (name === "update_project") {
      // Merge per-field origins so each updated field points to this message.
      const { data: current } = await supa
        .from("projects")
        .select("assistant_origins")
        .eq("id", projectId)
        .single();
      const origins = { ...(current?.assistant_origins as Record<string, string> ?? {}) };
      for (const k of Object.keys(args)) origins[k] = messageId;
      const { error } = await supa
        .from("projects")
        .update({ ...args, assistant_origins: origins })
        .eq("id", projectId);
      if (error) throw error;
      return { ok: true, message: `Project updated: ${Object.keys(args).join(", ")}` };
    }
    if (name === "set_solution_summary") {
      const summary = String((args as { summary?: string }).summary ?? "").trim();
      const markApproved = Boolean((args as { mark_approved?: boolean }).mark_approved);
      if (!summary) return { ok: false, message: "summary is required" };
      const { data: current } = await supa
        .from("projects")
        .select("assistant_origins")
        .eq("id", projectId)
        .single();
      const origins = { ...(current?.assistant_origins as Record<string, string> ?? {}) };
      origins.solution_summary = messageId;
      const patch: Record<string, unknown> = { solution_summary: summary, assistant_origins: origins };
      if (markApproved) patch.logic_approved_at = new Date().toISOString();
      const { error } = await supa.from("projects").update(patch).eq("id", projectId);
      if (error) throw error;
      const wordCount = summary.split(/\s+/).filter(Boolean).length;
      return {
        ok: true,
        message: markApproved
          ? `Solution summary saved & logic approved (${wordCount} words). Visible on Case Board.`
          : `Solution summary saved (${wordCount} words). Visible on Case Board's Solution-summary button.`,
      };
    }
    if (name === "add_suspect") {
      const { data, error } = await supa
        .from("suspects")
        .insert({ ...args, project_id: projectId, created_by_message_id: messageId })
        .select("id, name")
        .single();
      if (error) throw error;
      return { ok: true, message: `Suspect created: ${data.name}`, id: data.id };
    }
    if (name === "add_document") {
      // Server-side gate: refuse to create documents until the Logic Flow has
      // been generated AND approved. This mirrors the system-prompt rule so a
      // misbehaving model can't bypass it.
      const { data: proj } = await supa
        .from("projects")
        .select("solution_summary, logic_approved_at")
        .eq("id", projectId)
        .single();
      if (!proj?.solution_summary || !proj?.logic_approved_at) {
        return {
          ok: false,
          message:
            "Cannot create document yet — the Logic Flow has not been approved. " +
            "Tell the user to open Canvas → Logic Flow, click 'Generate logic flow', " +
            "review/edit the proposed clues + solution, then click 'Approve logic'. " +
            "Only after that can documents be generated.",
        };
      }
      const docNumber = args.doc_number ?? Math.floor(100 + Math.random() * 900);
      const { data, error } = await supa
        .from("documents")
        .insert({ ...args, doc_number: docNumber, project_id: projectId, created_by_message_id: messageId })
        .select("id, title")
        .single();
      if (error) throw error;
      return { ok: true, message: `Document created: ${data.title} (#${docNumber})`, id: data.id };
    }
    if (name === "add_canvas_node") {
      const { data, error } = await supa
        .from("canvas_nodes")
        .insert({
          ...args,
          project_id: projectId,
          position_x: Math.random() * 600,
          position_y: Math.random() * 400,
          created_by_message_id: messageId,
        })
        .select("id, title")
        .single();
      if (error) throw error;
      return { ok: true, message: `Canvas node added: ${data.title}`, id: data.id };
    }
    if (name === "propose_options") {
      // No state mutation — this tool exists purely so the model can attach
      // quick-reply button data to its reply. The args are surfaced verbatim
      // to the client through the tool result.
      const opts = (args as { options?: Array<{ label: string; send?: string }>; question?: string });
      const cleaned = (opts.options ?? [])
        .filter((o) => o && typeof o.label === "string" && o.label.trim().length > 0)
        .slice(0, 6)
        .map((o) => ({ label: o.label.trim(), send: (o.send ?? o.label).trim() }));
      if (cleaned.length < 2) return { ok: false, message: "propose_options needs at least 2 valid options" };
      return {
        ok: true,
        message: `Quick-reply buttons proposed (${cleaned.length})`,
        options: cleaned,
        question: typeof opts.question === "string" ? opts.question.trim() : undefined,
      };
    }
    return { ok: false, message: `Unknown tool: ${name}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// ---------- Main handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { projectId, messages } = await req.json();
    if (!projectId || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "projectId and messages required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Load project context
    const [{ data: project }, { count: suspectCount }, { count: docCount }] = await Promise.all([
      supa.from("projects").select("*").eq("id", projectId).single(),
      supa.from("suspects").select("id", { count: "exact", head: true }).eq("project_id", projectId),
      supa.from("documents").select("id", { count: "exact", head: true }).eq("project_id", projectId),
    ]);
    if (!project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load owner's assistant tweaks (house rules)
    let tweaks: Tweak[] = [];
    if (project.owner_id) {
      const { data: ownerProfile } = await supa
        .from("profiles")
        .select("assistant_tweaks")
        .eq("id", project.owner_id)
        .maybeSingle();
      const raw = (ownerProfile as { assistant_tweaks?: unknown } | null)?.assistant_tweaks;
      if (Array.isArray(raw)) tweaks = raw as Tweak[];
    }

    const model = PROVIDER_MODEL[project.ai_provider_planning ?? "lovable"] ?? PROVIDER_MODEL.lovable;
    const systemPrompt = buildSystemPrompt(project, suspectCount ?? 0, docCount ?? 0, tweaks);

    // Persist the last user message
    const lastUser = [...messages].reverse().find((m: { role: string }) => m.role === "user");
    if (lastUser) {
      await supa.from("chat_messages").insert({
        project_id: projectId,
        role: "user",
        content: lastUser.content,
      });
    }

    // Pre-mint the ID for the assistant message we'll insert at the end so
    // every tool write can stamp `created_by_message_id` BEFORE the row exists.
    // This lets the UI jump from any field/item back to the chat turn that
    // produced it.
    const assistantMessageId = crypto.randomUUID();

    // Tool-calling loop: up to 4 rounds
    const convo: Array<Record<string, unknown>> = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];
    const executedTools: Array<{ name: string; result: unknown }> = [];

    const MAX_ROUNDS = 8;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const isFinalRound = round === MAX_ROUNDS - 1;
      const body: Record<string, unknown> = { model, messages: convo, stream: false };
      if (!isFinalRound) body.tools = TOOLS;

      const resp = await chatCompletions(body);

      if (!resp.ok) {
        const provider = model.startsWith("openai/")
          ? "OpenAI"
          : model.startsWith("anthropic/")
            ? "Anthropic"
            : model.startsWith("gemini-direct/")
              ? "Google Gemini"
              : "Lovable AI";
        const t = await resp.text();
        console.error(`${provider} error`, resp.status, t);
        if (resp.status === 429) {
          return new Response(JSON.stringify({ error: `${provider} rate limit — try again in a moment.` }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (resp.status === 402) {
          const hint = provider === "Lovable AI"
            ? "Add credits in Settings → Workspace → Usage, or switch this project's planning provider."
            : `Check your ${provider} account billing or switch this project's planning provider.`;
          return new Response(JSON.stringify({ error: `${provider} credits/key issue (status 402). ${hint}` }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (resp.status === 401) {
          return new Response(JSON.stringify({ error: `${provider} authentication failed — check the API key in Settings → API keys.` }), {
            status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: `${provider} error (status ${resp.status})` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const data = await resp.json();
      const choice = data.choices?.[0];
      const msg = choice?.message ?? {};
      const toolCalls = msg.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }> | undefined;

      if (toolCalls && toolCalls.length > 0) {
        convo.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls });
        for (const call of toolCalls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* ignore */ }
          const result = await executeTool(supa, projectId, call.function.name, args, assistantMessageId);
          // Persist args alongside name+result so the UI receipt can render the
          // exact field values that changed (e.g. project field updates).
          // Strip propose_options args — they're already echoed via result.options.
          const argsForUi = call.function.name === "propose_options" ? undefined : args;
          executedTools.push({ name: call.function.name, args: argsForUi, result });
          convo.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
        }
        continue;
      }

      const finalText = msg.content ?? "";
      const lastOptionsTool = [...executedTools].reverse().find(
        (t) => t.name === "propose_options" && (t.result as { ok?: boolean })?.ok,
      );
      const optionsResult = lastOptionsTool?.result as
        | { options?: Array<{ label: string; send: string }>; question?: string }
        | undefined;
      let quickOptions = optionsResult?.options ?? null;
      let quickQuestion = optionsResult?.question ?? null;

      // Fallback: model wrote a numbered list in prose but forgot to call
      // propose_options. Synthesize buttons from the prose so the UI still
      // renders quick replies.
      if (!quickOptions || quickOptions.length === 0) {
        const synth = synthesizeOptionsFromProse(finalText);
        if (synth) {
          quickOptions = synth.options;
          quickQuestion = synth.question;
        }
      }

      await supa.from("chat_messages").insert({
        id: assistantMessageId,
        project_id: projectId,
        role: "assistant",
        content: finalText,
        metadata: {
          model,
          tools: executedTools,
          ...(quickOptions ? { options: quickOptions, question: quickQuestion } : {}),
        },
      });

      return new Response(JSON.stringify({ content: finalText, tools: executedTools, model, messageId: assistantMessageId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Too many tool-call rounds" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("assistant-chat error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
