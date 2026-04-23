// Mystery Studio Assistant — streaming chat with structured tool calls
// Uses Lovable AI Gateway (Gemini + GPT-5). Tools mutate project state server-side.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chatCompletions, extractFallback, logAiRun, getUserIdFromAuth } from "../_shared/ai-router.ts";
import {
  PLAYBOOK_DEFAULTS,
  resolvePlaybook,
  renderSuspectCountsLine,
  renderHintsLine,
  renderHintsSystemBlock,
  renderEnvelopesLine,
  renderPhase1OrderSentence,
  renderCanonicalVocabBlock,
  renderRealismParagraphs,
  renderIdentityBlock,
  renderContentRulesBlock,
  renderDesignSkeletonLine,
  renderDocModeButtonsBlock,
  renderLogicGateRefusal,
  renderCatalogsBlock,
  renderPhaseEnumComment,
  getPhaseEnum,
  type Playbook,
} from "../_shared/assistant-playbook.ts";

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
  "gemini-3-flash": "google/gemini-3-flash-preview",
  "gemini-flash": "google/gemini-2.5-flash",
  "gemini-flash-lite": "google/gemini-2.5-flash-lite",
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
  "gemini-direct-flash-lite": "gemini-direct/gemini-2.5-flash-lite",
  "gemini-direct-3-pro": "gemini-direct/gemini-3.1-pro-preview",
  "gemini-direct-3-flash": "gemini-direct/gemini-3-flash-preview",
};

// ---------- System prompt ----------
type Tweak = { id: string; text: string; created_at?: string };
type RosterRow = Record<string, unknown>;
type Rosters = {
  suspects: RosterRow[];
  documents: RosterRow[];
  envelopes: RosterRow[];
  hints: RosterRow[];
  canvas_nodes: RosterRow[];
};
function truncate(s: unknown, n = 60): string {
  const str = String(s ?? "").replace(/\s+/g, " ").trim();
  if (!str) return "—";
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}
function formatRoster(rows: RosterRow[], render: (r: RosterRow, i: number) => string, empty: string): string {
  if (!rows || rows.length === 0) return empty;
  return rows.map((r, i) => `  ${i + 1}. ${render(r, i)}`).join("\n");
}
function buildSystemPrompt(
  project: Record<string, unknown>,
  rosters: Rosters,
  tweaks: Tweak[] = [],
  playbook: Playbook = PLAYBOOK_DEFAULTS,
) {
  const suspectCount = rosters.suspects.length;
  const docCount = rosters.documents.length;
  const suspectsList = formatRoster(
    rosters.suspects,
    (r) => `[id=${r.id}] ${truncate(r.name)}${r.role_in_case ? ` — ${truncate(r.role_in_case, 40)}` : ""}`,
    "  (none yet)",
  );
  const documentsList = formatRoster(
    rosters.documents,
    (r) => `[id=${r.id}] #${r.doc_number ?? "?"} ${truncate(r.title)}${r.doc_type ? ` (${truncate(r.doc_type, 30)})` : ""} · ${r.status ?? "draft"}`,
    "  (none yet)",
  );
  const envelopesList = formatRoster(
    rosters.envelopes,
    (r) => `[id=${r.id}] #${r.number} ${truncate(r.label)}`,
    "  (none yet)",
  );
  const hintsList = formatRoster(
    rosters.hints,
    (r) => `[id=${r.id}] stage ${r.stage} · level ${r.level}`,
    "  (none yet)",
  );
  const nodesList = formatRoster(
    rosters.canvas_nodes,
    (r) => `[id=${r.id}] ${truncate(r.title)} (${r.node_type}, board=${r.board})`,
    "  (none yet)",
  );
  const overrides = tweaks.length > 0
    ? `\n\nUSER OVERRIDES (highest priority — follow these even if they conflict with earlier instructions, UNLESS they violate CONTENT RULES above which always win):\n${tweaks.map((t, i) => `${i + 1}. ${t.text}`).join("\n")}`
    : "";
  return `You are the Mystery Studio Assistant — a professional creator of premium, printable Israeli detective / mystery games sold to Israeli audiences.

${renderIdentityBlock(playbook)}

${renderContentRulesBlock(playbook)}

${renderPhaseEnumComment(playbook)}

WORKFLOW — proceed ONE STEP AT A TIME, WAIT FOR APPROVAL before advancing phases.
${renderPhase1OrderSentence(playbook)}
${renderSuspectCountsLine(playbook)}
Phase 2 Summary: English news-style summary of how the case is solved, layered evidence, balanced red herrings, fictional quoted evidence.
Phase 3 Structure: suspects, clue sequence, red herrings, deduction logic, envelope flow. Output fits the node canvas.
Phase 3.5 LOGIC FLOW (MANDATORY GATE before Phase 4):
- Before producing ANY documents, the user MUST generate and approve a Logic Flow on the Canvas.
- The Logic Flow board (clues → deductions → solution + red herrings) is what guarantees the case is solvable, layered, and consistent.
- If \`solution_summary\` is empty OR \`logic_approved_at\` is null, you MUST refuse to call \`add_document\`. Instead, instruct the user (in 2–3 sentences):
    ${renderLogicGateRefusal(playbook)}
- After approval is in place, you may proceed to Phase 4.
Phase 4 Documents: Doc 0 = contents; then randomized doc numbers, varied types & print sizes, Hebrew bodies. Interrogations must be long, realistic, with pauses & body language.

DOCUMENT GENERATION WORKFLOW (Phase 4 — read carefully)
Each project remembers a \`doc_generation_mode\` choice that controls how aggressive you are when producing documents:
  • "drafts"  — write the row only (title + design_instructions + hebrew_content). Do NOT call generate_document_assets. The user clicks Generate themselves.
  • "auto"    — write the row, THEN immediately call generate_document_assets({document_id, mode: "both"}) to actually produce the Hebrew body + image. Wait for the receipt before moving on. Show one finished doc at a time so the user can react.
  • "ask"     — after each add_document, ask the user "Generate this one now or save as draft?" with propose_options (two buttons: "Generate now" / "Save as draft, keep going"). On "Generate now", call generate_document_assets with mode "both".
RULES:
1. The FIRST time you enter Phase 4 in a project where \`doc_generation_mode\` is empty, BEFORE calling add_document, ask the user (with propose_options, 3 buttons) which mode they want — using these labels exactly:
${renderDocModeButtonsBlock(playbook)}
   Then call set_doc_generation_mode with the chosen mode ("drafts" / "auto" / "ask"). After that, follow the rules above without re-asking.
2. If the user already told you in their brief which mode they want (e.g. "just write the prompts, I'll click generate", "go full auto", "do everything yourself"), SKIP the question and call set_doc_generation_mode directly with the inferred mode + a one-line confirmation.
3. The user can switch modes any time. If they say "switch to drafts only" / "go full auto" / "ask me each time", call set_doc_generation_mode and acknowledge.
4. generate_document_assets is gated server-side: it will refuse if the Logic Flow is not approved, or if the document_id doesn't belong to this project. Trust the receipt.
5. The Hebrew body produced by generate_document_assets MAY differ slightly from the hebrew_content you wrote in add_document — that's expected. The receipt shows the final stored version.
${renderEnvelopesLine(playbook)}
${renderHintsLine(playbook)}

NUMBERED OPTIONS & QUICK-REPLY BUTTONS
When you offer the user a choice between 2–6 short, distinct, mutually-exclusive answers (e.g. picking a mystery type, picking a difficulty, choosing one of N proposed Hebrew titles, yes/no/skip, picking which suspect to flesh out next, "approve / revise / start over"), you MUST:
  1. Present them as a numbered list in your prose, AND
  2. Call the \`propose_options\` tool with the SAME options so the UI can render clickable quick-reply buttons.
Do NOT call \`propose_options\` for open-ended questions ("describe the setting", "write the summary"), free-text answers, or when you're listing >6 items.
Each option's \`label\` is the button text the user sees (keep it short — under ~60 chars). \`send\` is the message that gets sent on their behalf when they click — usually identical to the label, or a more explicit version like "Option 2: 1980s Tel Aviv noir".

ONE-QUESTION-PER-TURN RULE (HARD ENFORCEMENT)
Each assistant turn may ask AT MOST ONE pick-from-buttons question. NEVER bundle multiple choice questions into a single message (e.g. "Pick a mystery type… and also pick a genre… and also pick a difficulty"). The UI can only render quick-reply buttons for ONE \`propose_options\` call per message — every additional question you tack on becomes a numbered list with NO buttons, which silently breaks the flow and forces the user to type. Even if the next 2–3 setup steps feel obvious, ask them STRICTLY one at a time:
  • Turn N: ask only about mystery_type → wait for the user's pick → call update_project.
  • Turn N+1: ask only about genre → wait → update_project.
  • Turn N+2: ask only about difficulty → wait → update_project.
You may still mention upcoming questions in passing ("After this we'll pick the genre."), but you must not present them as numbered options or call \`propose_options\` for them in the same turn. Treat this as inviolable for setup fields (title, subtitle, mystery_type, genre, year, difficulty, player_role, case_goal, setting, selling_point, target_doc_count) and for any other situation where you would otherwise stack two button-style questions.

${renderCanonicalVocabBlock(playbook)}

TOOL-CALL-BEFORE-PROSE RULE (HARD ENFORCEMENT — these are not soft suggestions)
1. After the user picks or confirms title, subtitle, mystery_type, genre, year, difficulty, player_role, case_goal, setting, selling_point, or target_doc_count, your VERY NEXT assistant turn MUST begin with the corresponding update_project tool call BEFORE any prose, narration, or follow-up question. If you produce prose first and the tool call later (or not at all), the Overview panel stays empty and the user sees a broken app — that is a failure. Batch multiple confirmed fields into a single update_project call when the user confirmed several at once.
2. If your message contains a numbered list of 2–6 short, mutually-exclusive choices and you do NOT also call \`propose_options\` in the same turn, the user sees no buttons under the message and the app feels broken — that is a failure. Always pair "1) … 2) … 3) …" prose with a \`propose_options\` tool call carrying the same items.
3. The numbered list can be ANYWHERE in the message — opening, middle, or end — not just the last paragraph. A common failure mode is writing intro prose, then the numbered list, then a closing line like "Pick one." and forgetting the tool call because the list isn't at the very bottom. Whenever you produce ANY numbered list of 2–6 short choices anywhere in the message, you MUST call \`propose_options\` in the same turn. The "I forgot because the list wasn't at the end" failure is the #1 cause of broken UX. If in doubt, call it.
   POSITIVE EXAMPLE — list-in-the-middle pattern:
     "Here are 5 premium title options in Hebrew:
     1) **מבחן סופי**
     2) **אב‑טיפוס**
     3) **דליפה בהרצליה**
     4) **קו הגנה שבור**
     5) **שעת החשיפה**
     Pick one, or tell me to keep **final test** as the working title."
   → MUST also call propose_options with those 5 items in the same turn.
4. Every \`propose_options\` call must carry the EXACT options from THIS turn's prose. Do NOT copy a previous turn's \`propose_options\` arguments. The labels you pass in \`options[].label\` must match (substring-match) the items you just wrote in the numbered list above. Stale-option reuse is the #2 cause of broken UX after forgetting the tool entirely. If your prose lists cities (Haifa, Tel Aviv, …), your \`propose_options\` MUST list those same cities — never reuse the year-era options or any other prior choice list.
   WRONG — never do this:
     prose: "Pick the setting:
       1) Haifa industrial zone
       2) Tel Aviv tech district
       3) Jerusalem old city"
     propose_options args: [{label: "Late 1980s"}, {label: "1990s"}, {label: "Present day"}]   ← STALE, copied from previous turn. The user sees year buttons under city prose. Never do this.
   CORRECT for that prose:
     propose_options args: [{label: "Haifa industrial zone"}, {label: "Tel Aviv tech district"}, {label: "Jerusalem old city"}]

TOOL USE (CRITICAL)
When the user approves a change, you MUST persist it by calling the appropriate tool. Do NOT just describe the change. Tools write to the shared project state so the UI, canvas and suspects sections update immediately.
- update_project: change project metadata/phase after approvals. **CALL THIS EVERY TIME** the user approves or commits ANY of these Case Identity / Case Brief fields, individually or in batches: title, subtitle, mystery_type, genre, year, difficulty, player_role, case_goal, setting, selling_point, target_doc_count, phase. Example triggers — all REQUIRE an update_project call: user picks a mystery_type ("Espionage"), user picks a genre, user picks a Hebrew title from your numbered options, user picks a difficulty, user provides/confirms a player role, user provides/confirms a case goal, user provides/confirms a setting/year, user agrees to a selling point. Do NOT wait for the end of Phase 1 — persist each field the moment it's locked in. The Case Identity and Case Brief panels on the Overview tab pull DIRECTLY from these fields, so skipping update_project means the user sees an empty Overview even after they answered all your setup questions. Always pass ONLY the fields the user just confirmed (do not re-send unchanged fields). **ALSO** call update_project whenever the user approves or revises any of these case-level briefs: packaging_notes (Phase 7 packaging brief), image_prompt_instructions (per-project image style guide), video_prompt_instructions (per-project video style guide), hint_settings (stage/level hint config — pass the full object), envelope_settings (envelope numbering & defaults — pass the full object). Same rules as for title/genre: persist the moment it's locked in.
- set_solution_summary: AS SOON as the user approves the Phase 2 case summary (or whenever they approve a revised end-to-end solution narrative), call this tool with the full summary text. This single source of truth feeds the Case Board's "Solution summary" button, the Logic Flow generator, and every future document. NEVER skip this step after an approval — without it, the Canvas summary button will be empty and document generation will refuse to run.
- add_suspect / update_suspect: manage cast.
- add_document / update_document: create or edit a document record.
- add_canvas_node / update_canvas_node: add or edit a logic/clue/deduction/envelope/solution node.
- add_envelope / update_envelope: manage the 5 fixed envelopes (only update_envelope exists for editing labels/tasks/notes).
- add_hint / generate_hint_stage / update_hint: manage hints (see HINT SYSTEM block below). Prefer generate_hint_stage to scaffold a whole stage; use add_hint for single rows; use update_hint to edit existing rows.
- notify_user: drop a "callback" notification into the case's bell panel — use ONLY when the user defers a decision ("I'll write the title later"), skips a planning step, or asks something that needs revisiting later. Never use it for in-the-moment choices (use propose_options for those).

EDIT-VS-CREATE RULE (CRITICAL — prevents duplicate rows)
When the user references an EXISTING item — by name ("change Yossi's motive"), by number ("rename document 5", "envelope 3"), by pronoun ("make it shorter", "rename it"), by role ("the murder weapon node", "the red herring suspect"), or any other reference to something already in the rosters below — you MUST call the matching \`update_*\` tool, passing the \`id\` from the roster. NEVER call the \`add_*\` variant for an item that already exists — that creates a duplicate row and confuses the user. Use \`add_*\` ONLY for items that are not present in the rosters below.
Pass ONLY the fields the user wants to change in the update tool — undefined keys are ignored, so partial edits won't wipe other columns. The receipt will say "Updated X: <name> (<changed-fields>)" so the user can immediately see what was touched.

DESIGN INSTRUCTIONS RULES (CRITICAL — applies to EVERY add_document call)
The \`design_instructions\` field is the visual brief for the image generator. It MUST be long, structured, and specific. Never leave it empty, never use one-line notes, never use generic placeholders.
${renderDesignSkeletonLine(playbook)}

${renderCatalogsBlock(playbook)}

${renderRealismParagraphs(playbook)}

Mixed props (e.g. a real form annotated with a hand-drawn map): use ~12 realism details + ~6 creative details.

Match every detail to the era, setting, country, and document type — a 1987 Israeli memo gets PMO-style stamps and Hebrew dating; a 1950s noir telegram gets Western Union framing; a pirate map gets parchment burns and compass roses. Never copy real emblems, signatures, or names.

${renderHintsSystemBlock(playbook)}

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
Packaging notes: ${truncate(project.packaging_notes, 120)}
Image prompt style: ${truncate(project.image_prompt_instructions, 120)}
Video prompt style: ${truncate(project.video_prompt_instructions, 120)}
Hint settings: ${(() => { const v = project.hint_settings as Record<string, unknown> | null; if (!v || typeof v !== "object") return "—"; const keys = Object.keys(v); return keys.length === 0 ? "(empty)" : `(${keys.length} keys: ${truncate(keys.join(", "), 80)})`; })()}
Envelope settings: ${(() => { const v = project.envelope_settings as Record<string, unknown> | null; if (!v || typeof v !== "object") return "—"; const keys = Object.keys(v); return keys.length === 0 ? "(empty)" : `(${keys.length} keys: ${truncate(keys.join(", "), 80)})`; })()}
Existing suspects (${suspectCount}):
${suspectsList}
Existing documents (${docCount}):
${documentsList}
Existing envelopes (${rosters.envelopes.length}):
${envelopesList}
Existing hints (${rosters.hints.length}):
${hintsList}
Existing canvas nodes (${rosters.canvas_nodes.length}):
${nodesList}
Logic flow approved: ${project.logic_approved_at ? "YES (" + project.logic_approved_at + ")" : "NO — must be approved on the Canvas before generating documents"}
Solution summary set: ${project.solution_summary ? "YES" : "NO"}
Doc generation mode: ${project.doc_generation_mode ? `"${project.doc_generation_mode}"` : "NOT YET CHOSEN — ask the user with propose_options before the first add_document in Phase 4 (see DOCUMENT GENERATION WORKFLOW)"}

${(() => {
  // Derive USER-EDITED FIELDS: any tracked field that has a non-empty value
  // AND no entry in assistant_origins (= the user typed it themselves).
  const tracked: Array<[string, unknown]> = [
    ["title", project.title],
    ["subtitle", project.subtitle],
    ["mystery_type", project.mystery_type],
    ["genre", project.genre],
    ["year", project.year],
    ["difficulty", project.difficulty],
    ["player_role", project.player_role],
    ["case_goal", project.case_goal],
    ["setting", project.setting],
    ["selling_point", project.selling_point],
    ["target_doc_count", project.target_doc_count],
  ];
  const origins = (project.assistant_origins ?? {}) as Record<string, string>;
  const userEdited = tracked.filter(([k, v]) => {
    if (v === null || v === undefined) return false;
    const s = String(v).trim();
    if (s === "" || s === "—") return false;
    return !origins[k]; // no assistant stamp = user-entered
  });
  if (userEdited.length === 0) return "USER-EDITED FIELDS: (none — every populated field was set by the assistant)";
  const lines = userEdited.map(([k, v]) => `- ${k}: "${truncate(v, 120)}"`).join("\n");
  return `USER-EDITED FIELDS (the user typed these themselves — do NOT propose to fill them; instead acknowledge in your next reply, e.g. "I see you already filled in <field> as '<value>' — want me to refine it or move on?"):\n${lines}`;
})()}

Respond in English for planning. Write Hebrew for any final in-game text. Keep outputs concise unless the user requests depth.${overrides}

REMINDER (read this before every reply):
• Any numbered 2–6 mutually-exclusive choice list in your prose → ALSO call \`propose_options\` in the same turn.
• Any confirmed Case Identity field (title, subtitle, mystery_type, genre, year, difficulty, player_role, case_goal, setting, selling_point, target_doc_count, phase) → ALSO call \`update_project\` in the same turn, BEFORE the prose.
• USER-ENTERED FIELDS RULE: For every field listed under USER-EDITED FIELDS above, your first action is to acknowledge it out loud (e.g. "I see you already wrote the subtitle as '<value>' — keeping it.") and then either ask if the user wants you to refine it or skip past it to the next unfilled field. Do NOT silently overwrite a user-entered field with \`update_project\`, and do NOT propose options/numbered alternatives for a field the user already filled. The only exception is if the user explicitly asks you to rewrite or replace it.
• ONE-QUESTION-PER-TURN: ask AT MOST one pick-from-buttons question per turn. If you find yourself writing two questions ("now pick mystery_type… then pick genre…"), STOP, delete the second one, ask only the first, and ask the next one in your following turn after the user answers.
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

  // Heuristic gate 2: scan the WHOLE message line-by-line for a contiguous
  // run of numbered items (1, 2, 3, …). The list may sit anywhere — top,
  // middle (followed by a "Pick one." closer), or bottom.
  const lines = trimmed.split("\n");
  const itemLineRegex = /^\s*(\d+)[\.\)]\s+(.+?)\s*$/;
  let bestRun: { startIdx: number; items: Array<{ n: number; text: string }> } | null = null;
  let i = 0;
  while (i < lines.length) {
    const first = itemLineRegex.exec(lines[i]);
    if (first && Number(first[1]) === 1) {
      const run: Array<{ n: number; text: string }> = [{ n: 1, text: first[2].trim() }];
      const startIdx = i;
      let j = i + 1;
      while (j < lines.length) {
        const next = itemLineRegex.exec(lines[j]);
        if (!next) break;
        const n = Number(next[1]);
        if (n !== run.length + 1) break;
        run.push({ n, text: next[2].trim() });
        j++;
      }
      if (run.length >= 2 && run.length <= 6) {
        // Prefer the longest valid run if multiple exist.
        if (!bestRun || run.length > bestRun.items.length) {
          bestRun = { startIdx, items: run };
        }
      }
      i = j;
      continue;
    }
    i++;
  }
  if (!bestRun) return null;

  // Validate item lengths.
  for (const it of bestRun.items) {
    if (!it.text || it.text.length > 120) return null;
  }

  // Strip trailing parenthetical/em-dash explanation for cleaner button text,
  // but cap to ~60 chars.
  const toLabel = (s: string) => {
    const cleaned = s.replace(/\s+—\s+.*$/, "").replace(/\s*\(.*\)\s*$/, "").trim();
    const base = cleaned || s;
    return base.length > 60 ? `${base.slice(0, 57)}…` : base;
  };

  // Lift the question line from the line directly above the first numbered item.
  let questionLine: string | null = null;
  for (let k = bestRun.startIdx - 1; k >= 0; k--) {
    const candidate = lines[k].trim();
    if (candidate) {
      questionLine = candidate;
      break;
    }
  }

  return {
    options: bestRun.items.map((mm) => {
      const label = toLabel(mm.text);
      return { label, send: mm.text };
    }),
    question: questionLine && questionLine.length <= 140 ? questionLine : null,
  };
}

// ---------- Tool definitions ----------
const BASE_TOOLS = [
  {
    type: "function",
    function: {
      name: "update_project",
      description: "Update project metadata. Covers Case Identity (title, subtitle, phase, mystery_type, genre, year, difficulty, player_role, case_goal, setting, selling_point, target_doc_count) AND case-level briefs (packaging_notes, image_prompt_instructions, video_prompt_instructions, hint_settings, envelope_settings). Pass ONLY the fields that changed — undefined keys are ignored. For hint_settings/envelope_settings, pass the FULL object you want stored (it overwrites, no shallow merge).",
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
          packaging_notes: { type: "string", description: "Phase 7 packaging brief — physical box / print / fulfilment notes." },
          image_prompt_instructions: { type: "string", description: "Per-project visual style guide injected into every image-prompt call." },
          video_prompt_instructions: { type: "string", description: "Per-project style guide for video prompts." },
          hint_settings: { type: "object", description: "Stage/level hint configuration object. Replaces the existing value (no shallow merge)." },
          envelope_settings: { type: "object", description: "Envelope numbering & defaults object. Replaces the existing value (no shallow merge)." },
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
          node_type: { type: "string", enum: ["clue", "suspect", "deduction", "contradiction", "red_herring", "envelope", "solution", "document", "hint", "note"] },
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
        "Render quick-reply buttons under your message so the user can pick an answer with one click instead of typing. Use ONLY for 2–6 short, distinct, mutually-exclusive choices (picking a title from a list, picking difficulty, approve/revise/restart, yes/no/skip, picking which suspect to flesh out next, etc.). Do NOT use for open-ended prompts. The buttons appear in addition to your text — still write the prose explanation. CRITICAL: only ONE propose_options call per assistant turn — do NOT bundle a mystery-type question and a genre question in the same message. Ask one, wait for the answer, then ask the next.",
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
  {
    type: "function",
    function: {
      name: "update_suspect",
      description:
        "Edit an EXISTING suspect row by id (from the Existing suspects roster in CURRENT PROJECT STATE). Pass ONLY the fields you want to change — undefined fields are left alone. Use this instead of add_suspect any time the user references a suspect that already exists.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Suspect id from the roster." },
          name: { type: "string" },
          summary: { type: "string" },
          role_in_case: { type: "string" },
          motives: { type: "string" },
          secrets: { type: "string" },
          contradictions: { type: "string" },
          is_red_herring: { type: "boolean" },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_document",
      description:
        "Edit an EXISTING document row by id (from the Existing documents roster). Pass ONLY the fields you want to change. Use this instead of add_document whenever the user references a document that already exists.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Document id from the roster." },
          title: { type: "string" },
          doc_type: { type: "string" },
          doc_number: { type: "number" },
          print_size: { type: "string" },
          design_instructions: { type: "string" },
          hebrew_content: { type: "string" },
          envelope_number: { type: "number" },
          status: { type: "string" },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_envelope",
      description:
        "Edit an EXISTING envelope row by id (from the Existing envelopes roster). Pass ONLY the fields you want to change.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Envelope id from the roster." },
          label: { type: "string" },
          task: { type: "string" },
          notes: { type: "string" },
          status: { type: "string" },
          number: { type: "number" },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_hint",
      description:
        "Edit an EXISTING hint row by id (from the Existing hints roster). Pass ONLY the fields you want to change.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Hint id from the roster." },
          stage: { type: "number" },
          level: { type: "number" },
          text: { type: "string" },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_hint",
      description:
        "Create ONE new hint row. Use only when the user wants a single hint at a known stage+level (e.g. 'add stage 2 level 3 hint that says X'). For scaffolding a whole stage at once, use generate_hint_stage instead. For editing an existing hint, use update_hint.",
      parameters: {
        type: "object",
        properties: {
          stage: { type: "number", description: "Stage number (1-based). Each stage represents one moment the player gets stuck." },
          level: { type: "number", description: "Hint level within the stage (1=vague, 2=helpful, 3=reveals the task)." },
          text: { type: "string", description: "Hebrew hint text, RTL, grammatical, one or two short sentences." },
        },
        required: ["stage", "level"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_hint_stage",
      description:
        "Bulk-create an entire hint stage (vague → helpful → reveal) in one call. Provide all 3 Hebrew hints for the given stage. If hint rows already exist for that stage, this REPLACES them so the stage stays a clean 3-rung ladder. Use this as the default way to scaffold a new stage.",
      parameters: {
        type: "object",
        properties: {
          stage: { type: "number", description: "Stage number (1-based)." },
          hints: {
            type: "array",
            minItems: 1,
            maxItems: 6,
            description: "Hint rungs for this stage, ordered from vague (level 1) to reveal (last level). Each item is the Hebrew hint text for that rung.",
            items: { type: "string" },
          },
          context: {
            type: "string",
            description: "Optional one-line description of which clue/deduction/task this stage hints toward. Helps the user audit later.",
          },
        },
        required: ["stage", "hints"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_canvas_node",
      description:
        "Edit an EXISTING canvas node by id (from the Existing canvas nodes roster). Pass ONLY the fields you want to change.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Canvas node id from the roster." },
          title: { type: "string" },
          description: { type: "string" },
          node_type: { type: "string", enum: ["clue", "suspect", "deduction", "contradiction", "red_herring", "envelope", "solution", "document", "hint", "note"] },
          color: { type: "string" },
          position_x: { type: "number" },
          position_y: { type: "number" },
          locked: { type: "boolean" },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notify_user",
      description:
        "Drop a notification into the case's per-project Notification Panel (the bell in the workspace header). Use sparingly — only when something the user said or deferred should be revisited later. Examples: user said 'I'll write the title myself' → drop a reminder to confirm it. User skipped a planning step → flag it. Each notification optionally carries a `starter_prompt` that becomes the user's next message when they click 'Open in Assistant'. Do NOT use this for every reply — quick-reply buttons (propose_options) are still the default for in-the-moment choices.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short headline shown in the bell panel (under ~80 chars)." },
          body: { type: "string", description: "Optional 1–2 sentence detail." },
          starter_prompt: { type: "string", description: "Optional message text sent to you when the user clicks 'Open in Assistant'." },
          kind: { type: "string", description: "Short slug for grouping (e.g. 'reminder', 'follow_up', 'planning'). Defaults to 'general'." },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
  },
];

// Build the tool list with the playbook-derived `phase` enum substituted in.
function buildTools(playbook: Playbook): typeof BASE_TOOLS {
  const phaseEnum = getPhaseEnum(playbook);
  return BASE_TOOLS.map((tool) => {
    if (tool.function?.name !== "update_project") return tool;
    const cloned = JSON.parse(JSON.stringify(tool)) as typeof tool;
    const props = (cloned.function.parameters as { properties?: Record<string, { enum?: string[] }> }).properties;
    if (props?.phase) props.phase.enum = phaseEnum;
    return cloned;
  });
}

// ---------- Tool executor ----------
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
    if (name === "set_doc_generation_mode") {
      const mode = String((args as { mode?: string }).mode ?? "").trim();
      if (!["drafts", "auto", "ask"].includes(mode)) {
        return { ok: false, message: "mode must be 'drafts', 'auto', or 'ask'" };
      }
      const { data: current } = await supa
        .from("projects")
        .select("assistant_origins")
        .eq("id", projectId)
        .single();
      const origins = { ...(current?.assistant_origins as Record<string, string> ?? {}) };
      origins.doc_generation_mode = messageId;
      const { error } = await supa
        .from("projects")
        .update({ doc_generation_mode: mode, assistant_origins: origins })
        .eq("id", projectId);
      if (error) throw error;
      const friendly = mode === "drafts"
        ? "Drafts only — I'll write the rows, you press Generate"
        : mode === "auto"
          ? "Full auto — I'll generate text + image after every doc"
          : "Ask each time — I'll check before generating";
      return { ok: true, message: `Document workflow set: ${friendly}` };
    }
    if (name === "generate_document_assets") {
      const documentId = String((args as { document_id?: string }).document_id ?? "").trim();
      const requestedMode = String((args as { mode?: string }).mode ?? "both").trim();
      if (!documentId) return { ok: false, message: "document_id is required" };
      if (!["text", "image", "both"].includes(requestedMode)) {
        return { ok: false, message: "mode must be 'text', 'image', or 'both'" };
      }
      // Gate: logic flow must be approved + document must belong to project.
      const { data: proj } = await supa
        .from("projects")
        .select("solution_summary, logic_approved_at")
        .eq("id", projectId)
        .single();
      if (!proj?.solution_summary || !proj?.logic_approved_at) {
        return {
          ok: false,
          message: "Cannot generate — Logic Flow not approved yet. Tell the user to approve it on the Canvas first.",
        };
      }
      const { data: docRow } = await supa
        .from("documents")
        .select("id, project_id, title")
        .eq("id", documentId)
        .single();
      if (!docRow || docRow.project_id !== projectId) {
        return { ok: false, message: "Document not found in this project." };
      }

      const callGenerate = async (m: "text" | "image") => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 120_000);
        try {
          const r = await fetch(`${SUPABASE_URL}/functions/v1/generate-document`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ documentId, mode: m }),
            signal: ctrl.signal,
          });
          const body = await r.json().catch(() => ({}));
          return { ok: r.ok, status: r.status, body };
        } catch (e) {
          const aborted = (e as Error)?.name === "AbortError";
          return { ok: false, status: aborted ? 504 : 500, body: { error: aborted ? "timeout after 120s — generation continues server-side, check Documents tab" : (e as Error)?.message ?? "fetch failed" } };
        } finally {
          clearTimeout(timer);
        }
      };

      const errors: string[] = [];
      if (requestedMode === "text" || requestedMode === "both") {
        const r = await callGenerate("text");
        if (!r.ok) errors.push(`text: ${r.body?.error ?? r.status}`);
      }
      if (requestedMode === "image" || requestedMode === "both") {
        const r = await callGenerate("image");
        if (!r.ok) errors.push(`image: ${r.body?.error ?? r.status}`);
      }

      // Re-read row to grab whatever made it through.
      const { data: finalDoc } = await supa
        .from("documents")
        .select("hebrew_content, generated_asset_url, title")
        .eq("id", documentId)
        .single();
      const hebrew = (finalDoc?.hebrew_content ?? "").toString();
      const preview = hebrew.length > 240 ? `${hebrew.slice(0, 240)}…` : hebrew;
      const imageUrl = finalDoc?.generated_asset_url ?? null;

      if (errors.length > 0 && !imageUrl && !hebrew) {
        return { ok: false, message: `Generation failed — ${errors.join("; ")}`, id: documentId };
      }
      const partial = errors.length > 0 ? ` (partial: ${errors.join("; ")})` : "";
      return {
        ok: true,
        message: `Generated assets for "${finalDoc?.title ?? "document"}"${partial}`,
        id: documentId,
        hebrew_preview: preview || undefined,
        image_url: imageUrl || undefined,
      };
    }
    // ---------- Update tools ----------
    // Helper that strips undefined/null/empty-string keys, runs the update,
    // and verifies the row belongs to this project. Returns a uniform receipt.
    const runUpdate = async (
      table: "suspects" | "documents" | "envelopes" | "hints" | "canvas_nodes",
      label: string,
      stampMessage: boolean,
      selectAfter: string,
      formatName: (row: Record<string, unknown>) => string,
    ) => {
      const id = String((args as { id?: string }).id ?? "").trim();
      if (!id) return { ok: false, message: `${label} id is required` };
      // Build patch from args excluding id and undefined/empty values.
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(args)) {
        if (k === "id") continue;
        if (v === undefined || v === null) continue;
        if (typeof v === "string" && v.length === 0) continue;
        patch[k] = v;
      }
      if (Object.keys(patch).length === 0) {
        return { ok: false, message: `Nothing to update — pass at least one field besides id.` };
      }
      if (stampMessage) patch.created_by_message_id = messageId;
      // Verify ownership first so we can return a clean error.
      const { data: existing } = await supa
        .from(table)
        .select("id, project_id")
        .eq("id", id)
        .maybeSingle();
      if (!existing || (existing as { project_id?: string }).project_id !== projectId) {
        return { ok: false, message: `No ${label} with that id in this project.` };
      }
      const { data: updated, error } = await supa
        .from(table)
        .update(patch)
        .eq("id", id)
        .eq("project_id", projectId)
        .select(selectAfter)
        .single();
      if (error) throw error;
      const changed = Object.keys(patch).filter((k) => k !== "created_by_message_id");
      const niceName = formatName((updated ?? {}) as Record<string, unknown>);
      return {
        ok: true,
        message: `Updated ${label}: ${niceName} (${changed.join(", ")})`,
        id,
      };
    };

    if (name === "update_suspect") {
      return await runUpdate(
        "suspects",
        "suspect",
        true,
        "id, name",
        (r) => String(r.name ?? "—"),
      );
    }
    if (name === "update_document") {
      return await runUpdate(
        "documents",
        "document",
        true,
        "id, title, doc_number",
        (r) => `#${r.doc_number ?? "?"} ${r.title ?? "—"}`,
      );
    }
    if (name === "update_envelope") {
      return await runUpdate(
        "envelopes",
        "envelope",
        false,
        "id, number, label",
        (r) => `#${r.number ?? "?"} ${r.label ?? ""}`.trim(),
      );
    }
    if (name === "update_hint") {
      return await runUpdate(
        "hints",
        "hint",
        false,
        "id, stage, level",
        (r) => `stage ${r.stage ?? "?"} · level ${r.level ?? "?"}`,
      );
    }
    if (name === "update_canvas_node") {
      return await runUpdate(
        "canvas_nodes",
        "node",
        true,
        "id, title",
        (r) => String(r.title ?? "—"),
      );
    }
    if (name === "add_hint") {
      const a = args as { stage?: number; level?: number; text?: string };
      const stage = Number(a.stage);
      const level = Number(a.level);
      if (!Number.isFinite(stage) || stage < 1) return { ok: false, message: "stage must be a positive number" };
      if (!Number.isFinite(level) || level < 1) return { ok: false, message: "level must be a positive number" };
      const { data, error } = await supa
        .from("hints")
        .insert({
          project_id: projectId,
          stage,
          level,
          text: typeof a.text === "string" ? a.text : null,
        })
        .select("id, stage, level")
        .single();
      if (error) throw error;
      return { ok: true, message: `Hint added: stage ${data.stage} · level ${data.level}`, id: data.id };
    }
    if (name === "generate_hint_stage") {
      const a = args as { stage?: number; hints?: unknown[]; context?: string };
      const stage = Number(a.stage);
      if (!Number.isFinite(stage) || stage < 1) return { ok: false, message: "stage must be a positive number" };
      const rawHints = Array.isArray(a.hints) ? a.hints : [];
      const cleaned = rawHints
        .map((h) => (typeof h === "string" ? h.trim() : ""))
        .filter((h) => h.length > 0)
        .slice(0, 6);
      if (cleaned.length === 0) return { ok: false, message: "Provide at least one Hebrew hint string" };
      // Replace any existing rows for this stage so the ladder stays clean.
      await supa.from("hints").delete().eq("project_id", projectId).eq("stage", stage);
      const rows = cleaned.map((text, i) => ({
        project_id: projectId,
        stage,
        level: i + 1,
        text,
      }));
      const { error } = await supa.from("hints").insert(rows);
      if (error) throw error;
      const ctx = a.context ? ` — for: ${String(a.context).trim().slice(0, 80)}` : "";
      return {
        ok: true,
        message: `Hint stage ${stage} written (${cleaned.length} rungs)${ctx}`,
      };
    }
    if (name === "notify_user") {
      const a = args as { title?: string; body?: string; starter_prompt?: string; kind?: string };
      const title = String(a.title ?? "").trim();
      if (!title) return { ok: false, message: "title is required" };
      const { error } = await supa
        .from("project_notifications")
        .insert({
          project_id: projectId,
          kind: String(a.kind ?? "general").trim() || "general",
          title,
          body: a.body ? String(a.body).trim() : null,
          starter_prompt: a.starter_prompt ? String(a.starter_prompt).trim() : null,
          created_by: "assistant",
          status: "unread",
        });
      if (error) throw error;
      return { ok: true, message: `Notification dropped: ${title}` };
    }

    return { ok: false, message: `Unknown tool: ${name}` };
  } catch (e) {
    // Serialize errors carefully. Supabase/Postgrest errors are plain objects
    // (not Error instances) with { message, code, details, hint } — so a naive
    // String(e) would render as "[object Object]" in the chat receipt. Pull
    // the most useful fields and always include the tool name + args so the
    // model can correct its next call instead of looping the same mistake.
    const err = e as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    let msg: string;
    if (e instanceof Error) {
      msg = e.message;
    } else if (err && typeof err === "object") {
      const parts = [
        typeof err.message === "string" ? err.message : null,
        typeof err.details === "string" ? err.details : null,
        typeof err.hint === "string" ? err.hint : null,
        typeof err.code === "string" ? `(code: ${err.code})` : null,
      ].filter(Boolean);
      msg = parts.length > 0 ? parts.join(" — ") : JSON.stringify(err);
    } else {
      msg = String(e);
    }
    console.error(`tool '${name}' failed`, { args, error: e });
    return { ok: false, message: `${name} failed: ${msg}` };
  }
}

// Run the full assistant turn (load context, build prompt, run model+tool
// loop, persist the assistant message). Used by background mode. Throws on
// error so the caller can flip the assistant_runs row to status='error'.
async function processConversation(
  supa: ReturnType<typeof createClient>,
  projectId: string,
  messages: Array<Record<string, unknown>>,
  callerUserId: string | null,
): Promise<void> {
  const [
    { data: project },
    { data: suspectsRoster },
    { data: documentsRoster },
    { data: envelopesRoster },
    { data: hintsRoster },
    { data: nodesRoster },
  ] = await Promise.all([
    supa.from("projects").select("*").eq("id", projectId).single(),
    supa.from("suspects").select("id, name, role_in_case").eq("project_id", projectId).order("position", { ascending: true }).limit(50),
    supa.from("documents").select("id, doc_number, title, doc_type, status").eq("project_id", projectId).order("doc_number", { ascending: true, nullsFirst: false }).limit(100),
    supa.from("envelopes").select("id, number, label").eq("project_id", projectId).order("number", { ascending: true }).limit(50),
    supa.from("hints").select("id, stage, level").eq("project_id", projectId).order("stage", { ascending: true }).order("level", { ascending: true }).limit(50),
    supa.from("canvas_nodes").select("id, title, node_type, board").eq("project_id", projectId).order("created_at", { ascending: true }).limit(100),
  ]);
  if (!project) throw new Error("Project not found");

  let tweaks: Tweak[] = [];
  let playbook: Playbook = PLAYBOOK_DEFAULTS;
  if (project.owner_id) {
    const { data: ownerProfile } = await supa
      .from("profiles")
      .select("assistant_tweaks, assistant_playbook")
      .eq("id", project.owner_id)
      .maybeSingle();
    const raw = (ownerProfile as { assistant_tweaks?: unknown; assistant_playbook?: unknown } | null);
    if (raw && Array.isArray(raw.assistant_tweaks)) tweaks = raw.assistant_tweaks as Tweak[];
    if (raw) playbook = resolvePlaybook(raw.assistant_playbook);
  }

  const model = PROVIDER_MODEL[project.ai_provider_planning ?? "lovable"] ?? PROVIDER_MODEL.lovable;
  const rosters: Rosters = {
    suspects: (suspectsRoster ?? []) as RosterRow[],
    documents: (documentsRoster ?? []) as RosterRow[],
    envelopes: (envelopesRoster ?? []) as RosterRow[],
    hints: (hintsRoster ?? []) as RosterRow[],
    canvas_nodes: (nodesRoster ?? []) as RosterRow[],
  };
  const systemPrompt = buildSystemPrompt(project, rosters, tweaks, playbook);

  const lastUser = [...messages].reverse().find((m) => (m as { role: string }).role === "user") as { content: string } | undefined;
  if (lastUser) {
    await supa.from("chat_messages").insert({
      project_id: projectId, role: "user", content: lastUser.content,
    });
  }

  const assistantMessageId = crypto.randomUUID();
  const convo: Array<Record<string, unknown>> = [{ role: "system", content: systemPrompt }, ...messages];
  const executedTools: Array<{ name: string; args?: Record<string, unknown>; result: unknown }> = [];
  const TOOLS = buildTools(playbook);
  const MAX_ROUNDS = 8;
  let lastFb: { effectiveModel: string; fallback: string } = { effectiveModel: model, fallback: "none" };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const isFinalRound = round === MAX_ROUNDS - 1;
    const body: Record<string, unknown> = { model, messages: convo, stream: false };
    if (!isFinalRound) body.tools = TOOLS;

    const roundStartedAt = Date.now();
    const resp = await chatCompletions(body);
    const fb = extractFallback(resp, model);
    lastFb = fb;
    logAiRun({
      userId: callerUserId, projectId, surface: "assistant-chat",
      requestedModel: model, effectiveModel: fb.effectiveModel, fallback: fb.fallback,
      status: resp.ok ? "ok" : "error", latencyMs: Date.now() - roundStartedAt,
      errorMessage: resp.ok ? undefined : `status ${resp.status}`,
      targetId: assistantMessageId,
      promptExcerpt: lastUser?.content ? String(lastUser.content) : undefined,
    });

    if (!resp.ok) {
      const provider = model.startsWith("openai/") ? "OpenAI"
        : model.startsWith("anthropic/") ? "Anthropic"
        : model.startsWith("gemini-direct/") ? "Google Gemini"
        : "Lovable AI";
      const t = await resp.text();
      console.error(`${provider} error`, resp.status, t);
      let errMsg: string;
      if (resp.status === 429) errMsg = `${provider} rate limit — try again in a moment.`;
      else if (resp.status === 402) errMsg = `${provider} credits/key issue (status 402).`;
      else if (resp.status === 401) errMsg = `${provider} authentication failed — check the API key in Settings → API keys.`;
      else errMsg = `${provider} error (status ${resp.status})`;

      if (executedTools.length > 0) {
        const okCount = executedTools.filter((t) => (t.result as { ok?: boolean })?.ok).length;
        const totalCount = executedTools.length;
        const recoveryNote = `⚠️ ${errMsg}\n\nBefore this happened I successfully executed ${okCount} of ${totalCount} actions (see receipts below). They are already saved — you don't need to redo them. Reply "continue" once the issue is resolved and I'll pick up where I left off.`;
        await supa.from("chat_messages").insert({
          id: assistantMessageId, project_id: projectId, role: "assistant", content: recoveryNote,
          metadata: { model, effective_model: lastFb.effectiveModel, fallback: lastFb.fallback, tools: executedTools, partial: true, error: errMsg },
        });
        return;
      }
      throw new Error(errMsg);
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
        const argsForUi = call.function.name === "propose_options" ? undefined : args;
        executedTools.push({ name: call.function.name, args: argsForUi, result });
        convo.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
      continue;
    }

    const finalText = msg.content ?? "";
    const lastOptionsTool = [...executedTools].reverse().find(
      (t) => t.name === "propose_options" && (t.result as { ok?: boolean })?.ok,
    );
    const optionsResult = lastOptionsTool?.result as { options?: Array<{ label: string; send: string }>; question?: string } | undefined;
    let quickOptions = optionsResult?.options ?? null;
    let quickQuestion = optionsResult?.question ?? null;
    if (!quickOptions || quickOptions.length === 0) {
      const synth = synthesizeOptionsFromProse(finalText);
      if (synth) { quickOptions = synth.options; quickQuestion = synth.question; }
    }

    await supa.from("chat_messages").insert({
      id: assistantMessageId, project_id: projectId, role: "assistant", content: finalText,
      metadata: {
        model, effective_model: lastFb.effectiveModel, fallback: lastFb.fallback, tools: executedTools,
        ...(quickOptions ? { options: quickOptions, question: quickQuestion } : {}),
      },
    });
    return;
  }
  throw new Error("Too many tool-call rounds");
}

// ---------- Main handler ----------
// The conversation runs as either:
//   - "sync"        (legacy): client awaits the full reply over HTTP
//   - "background"  (default for new client): we write an `assistant_runs`
//     row, fire-and-forget the work via EdgeRuntime.waitUntil, and return
//     immediately. The model + tools loop continues even if the user closes
//     their browser tab — the assistant message lands via realtime when done.
declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { projectId, messages, mode } = await req.json();
    if (!projectId || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "projectId and messages required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // BACKGROUND MODE — record a run row, kick off the work, return runId.
    if (mode === "background") {
      const callerUserId = await getUserIdFromAuth(req);
      const { data: runRow, error: runErr } = await supa
        .from("assistant_runs")
        .insert({ project_id: projectId, user_id: callerUserId, status: "running" })
        .select("id")
        .single();
      if (runErr) {
        console.error("assistant_runs insert failed", runErr);
        return new Response(JSON.stringify({ error: "Failed to start run" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const runId = runRow.id as string;

      const work = (async () => {
        try {
          await processConversation(supa, projectId, messages, callerUserId);
          await supa.from("assistant_runs").update({
            status: "done", finished_at: new Date().toISOString(),
          }).eq("id", runId);
        } catch (err) {
          console.error("background assistant-chat failed", err);
          const msg = err instanceof Error ? err.message : "Unknown error";
          await supa.from("assistant_runs").update({
            status: "error", error: msg, finished_at: new Date().toISOString(),
          }).eq("id", runId);
        }
      })();

      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        EdgeRuntime.waitUntil(work);
      } else {
        // Local dev fallback — just don't await, but the request will end.
        void work;
      }

      return new Response(JSON.stringify({ runId, ok: true, background: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load project context + rosters of existing items so the model can target
    // the right id when the user says "edit suspect 2" / "rename document 5"
    // instead of duplicating rows. Caps keep the prompt budget bounded.
    const [
      { data: project },
      { data: suspectsRoster },
      { data: documentsRoster },
      { data: envelopesRoster },
      { data: hintsRoster },
      { data: nodesRoster },
    ] = await Promise.all([
      supa.from("projects").select("*").eq("id", projectId).single(),
      supa.from("suspects")
        .select("id, name, role_in_case")
        .eq("project_id", projectId)
        .order("position", { ascending: true })
        .limit(50),
      supa.from("documents")
        .select("id, doc_number, title, doc_type, status")
        .eq("project_id", projectId)
        .order("doc_number", { ascending: true, nullsFirst: false })
        .limit(100),
      supa.from("envelopes")
        .select("id, number, label")
        .eq("project_id", projectId)
        .order("number", { ascending: true })
        .limit(50),
      supa.from("hints")
        .select("id, stage, level")
        .eq("project_id", projectId)
        .order("stage", { ascending: true })
        .order("level", { ascending: true })
        .limit(50),
      supa.from("canvas_nodes")
        .select("id, title, node_type, board")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true })
        .limit(100),
    ]);
    if (!project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load owner's assistant tweaks (free-form rules) AND assistant playbook (default overrides)
    let tweaks: Tweak[] = [];
    let playbook: Playbook = PLAYBOOK_DEFAULTS;
    if (project.owner_id) {
      const { data: ownerProfile } = await supa
        .from("profiles")
        .select("assistant_tweaks, assistant_playbook")
        .eq("id", project.owner_id)
        .maybeSingle();
      const raw = (ownerProfile as { assistant_tweaks?: unknown; assistant_playbook?: unknown } | null);
      if (raw && Array.isArray(raw.assistant_tweaks)) tweaks = raw.assistant_tweaks as Tweak[];
      if (raw) playbook = resolvePlaybook(raw.assistant_playbook);
    }

    const model = PROVIDER_MODEL[project.ai_provider_planning ?? "lovable"] ?? PROVIDER_MODEL.lovable;
    const rosters: Rosters = {
      suspects: (suspectsRoster ?? []) as RosterRow[],
      documents: (documentsRoster ?? []) as RosterRow[],
      envelopes: (envelopesRoster ?? []) as RosterRow[],
      hints: (hintsRoster ?? []) as RosterRow[],
      canvas_nodes: (nodesRoster ?? []) as RosterRow[],
    };
    const systemPrompt = buildSystemPrompt(project, rosters, tweaks, playbook);

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
    const executedTools: Array<{ name: string; args?: Record<string, unknown>; result: unknown }> = [];
    const TOOLS = buildTools(playbook);

    const MAX_ROUNDS = 8;
    const callerUserId = await getUserIdFromAuth(req);
    let lastFb: { effectiveModel: string; fallback: string } = { effectiveModel: model, fallback: "none" };
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const isFinalRound = round === MAX_ROUNDS - 1;
      const body: Record<string, unknown> = { model, messages: convo, stream: false };
      if (!isFinalRound) body.tools = TOOLS;

      const roundStartedAt = Date.now();
      const resp = await chatCompletions(body);
      const fb = extractFallback(resp, model);
      lastFb = fb;
      // Log every round (best-effort, non-blocking semantics)
      logAiRun({
        userId: callerUserId, projectId, surface: "assistant-chat",
        requestedModel: model, effectiveModel: fb.effectiveModel, fallback: fb.fallback,
        status: resp.ok ? "ok" : "error", latencyMs: Date.now() - roundStartedAt,
        errorMessage: resp.ok ? undefined : `status ${resp.status}`,
        targetId: assistantMessageId,
        promptExcerpt: lastUser?.content ? String(lastUser.content) : undefined,
      });

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

        // Build a user-facing error string.
        let errMsg: string;
        let errStatus = 500;
        if (resp.status === 429) {
          errMsg = `${provider} rate limit — try again in a moment.`;
          errStatus = 429;
        } else if (resp.status === 402) {
          const hint = provider === "Lovable AI"
            ? "Add credits in Settings → Workspace → Usage, or switch this project's planning provider."
            : `Check your ${provider} account billing or switch this project's planning provider.`;
          errMsg = `${provider} credits/key issue (status 402). ${hint}`;
          errStatus = 402;
        } else if (resp.status === 401) {
          errMsg = `${provider} authentication failed — check the API key in Settings → API keys.`;
          errStatus = 401;
        } else {
          errMsg = `${provider} error (status ${resp.status})`;
          errStatus = 500;
        }

        // CRITICAL: if we already executed tools this turn (e.g. saved 3 of 6
        // documents before the LLM aborted), persist them as an assistant
        // message so the user sees what made it to the DB and can resume
        // cleanly instead of thinking the whole batch was lost.
        if (executedTools.length > 0) {
          const okCount = executedTools.filter((t) => (t.result as { ok?: boolean })?.ok).length;
          const totalCount = executedTools.length;
          const recoveryNote =
            `⚠️ ${errMsg}\n\n` +
            `Before this happened I successfully executed ${okCount} of ${totalCount} actions ` +
            `(see receipts below). They are already saved — you don't need to redo them. ` +
            `Reply "continue" once the issue is resolved and I'll pick up where I left off.`;
          await supa.from("chat_messages").insert({
            id: assistantMessageId,
            project_id: projectId,
            role: "assistant",
            content: recoveryNote,
            metadata: { model, effective_model: lastFb.effectiveModel, fallback: lastFb.fallback, tools: executedTools, partial: true, error: errMsg },
          });
          return new Response(
            JSON.stringify({
              content: recoveryNote,
              tools: executedTools,
              model,
              messageId: assistantMessageId,
              partial: true,
              error: errMsg,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        return new Response(JSON.stringify({ error: errMsg }), {
          status: errStatus,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
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
          effective_model: lastFb.effectiveModel,
          fallback: lastFb.fallback,
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
