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
  renderLanguagesBlock,
  renderUniversalDocumentsBlock,
  renderPhaseEnumComment,
  renderPlanningDepthBlock,
  normalizePlanningDepth,
  getPhaseEnum,
  type Playbook,
  type PlanningDepth,
} from "../_shared/assistant-playbook.ts";
import { claudeSkillRequestShape, loadClaudeSkillsForSurface, renderClaudeSkillCatalog, type ClaudeSkillRow } from "../_shared/claude-skills.ts";

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
  canvas_edges_count?: number;
  logic_dirty_since_approval?: boolean;
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
  claudeSkills: ClaudeSkillRow[] = [],
  isFirstTurn: boolean = false,
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
  const planningDepth: PlanningDepth = normalizePlanningDepth(
    (project as { planning_depth?: unknown }).planning_depth,
    playbook.planning_depth.default,
  );
  const firstTurnDepthPrompt = isFirstTurn
    ? `\n\nFIRST-TURN PLANNING DEPTH PICKER (this is the very first assistant message in this project)
Your VERY FIRST reply MUST do exactly two things, in order:
  1. Greet the user warmly in one short sentence and explain there are three planning styles for this case.
  2. Call \`propose_options\` with EXACTLY these three buttons (label / send identical):
       • "⚡ Express — you plan it all, just ask me the title"
       • "🎯 Guided — ask me the basics only (default)"
       • "🔬 Deep Dive — walk me through every detail"
     Also include the same three lines as a numbered list in your prose.
Do NOT ask any other question in this turn. After the user picks, you must immediately call \`update_project\` with planning_depth set to "express", "guided", or "deep" respectively, then continue per the matching PLANNING DEPTH block below. The current depth is "${planningDepth}".`
    : "";
  return `You are the Mystery Studio Assistant — a professional creator of premium, printable Israeli detective / mystery games sold to Israeli audiences.

${renderIdentityBlock(playbook)}

${renderContentRulesBlock(playbook)}

${renderPhaseEnumComment(playbook)}

${renderLanguagesBlock(playbook)}

${renderPlanningDepthBlock(planningDepth, playbook)}${firstTurnDepthPrompt}

WORKFLOW — proceed ONE STEP AT A TIME, WAIT FOR APPROVAL before advancing phases. The PLANNING DEPTH block above OVERRIDES the default Phase 1 order — follow that block first.
${renderPhase1OrderSentence(playbook)}
${renderSuspectCountsLine(playbook)}
Phase 2 Summary: English news-style summary of how the case is solved, layered evidence, balanced red herrings, fictional quoted evidence.
Phase 3 Structure: suspects, clue sequence, red herrings, deduction logic, and the sealed task-envelope plan. Output fits the node canvas. IMPORTANT GAME-FLOW MODEL: Envelopes are SEALED TASK GATES — they do NOT distribute documents in batches. All evidence documents live loose in the box from the very start; the player has access to every document immediately, organized by Doc 0. Envelopes only hold a short task / reveal / instruction the player reads when they reach the matching beat in the case (e.g. "Open envelope 2 once you've narrowed it down to two suspects"). Envelope #0 is the mission briefing (opened first, points the player at Doc 0 and the case goal). The final envelope contains the accusation form / solution reveal. When you plan envelopes you must reason about each envelope's OPENING TRIGGER (the case beat that unlocks it) and its PAYLOAD (task, reveal, or instruction).
Phase 3.5 LOGIC FLOW (MANDATORY GATE before Phase 4):
- Before producing ANY documents, the user MUST generate and approve a Logic Flow on the Canvas.
- The Logic Flow board (clues → deductions → solution + red herrings) is what guarantees the case is solvable, layered, and consistent.
- If \`solution_summary\` is empty OR \`logic_approved_at\` is null, you MUST refuse to call \`add_document\`. Instead, instruct the user (in 2–3 sentences):
    ${renderLogicGateRefusal(playbook)}
- After approval is in place, you may proceed to Phase 4.

LOGIC APPROVAL — ALWAYS OFFER A ONE-CLICK APPROVE BUTTON:
Whenever you have just saved or revised a solution summary (via \`set_solution_summary\` without mark_approved), AND \`logic_approved_at\` is still null, you MUST in the SAME assistant turn:
  1. Show the user a ≤3-sentence recap of what's now locked into the summary.
  2. Call \`propose_options\` with EXACTLY these two buttons (label / send identical):
       • "✅ Approve logic & start producing documents"
       • "✏️ Let me edit the summary first"
When the user's NEXT message is "✅ Approve logic & start producing documents" (exact substring "Approve logic" is enough), you MUST:
  1. Immediately call \`set_solution_summary\` AGAIN with the SAME summary text and \`mark_approved: true\` — this stamps logic_approved_at.
  2. Then continue automatically into Phase 4: call \`propose_document_set\` (the Phase 4 PLANNING GATE) so the user moves forward without a second click.
  3. Confirm in one short sentence ("Logic approved — drafting the document set now.") and present the proposed list with the standard 3 propose_options buttons (Approve and build the Final Flow / Just build it / Revise the plan).
Never tell the user "click Approve logic on the Canvas" if you can offer this button — the in-chat approval IS the canonical path. Mention the Canvas button only as a fallback if the user prefers to review the board first.

Phase 4 Documents: Doc 0 = master inventory of every document in the box; then randomized doc numbers, varied types & print sizes, bodies in the selected Game language. Interrogations must be long, realistic, with pauses & body language. Doc 0 lists EVERY document the player has from the start (organized by topic / type / investigative area, NOT by envelope) plus the sealed task envelopes as separate items with their trigger conditions. Documents are NOT distributed by envelope — leave \`envelope_number\` null on documents unless the user explicitly wants a document physically tucked inside a task envelope (rare).

${renderUniversalDocumentsBlock(playbook)}

${(() => {
  // Heavy Phase-4 doc-workflow lecture is only relevant once the user is at
  // (or close to) Phase 4. In phases 1–2 it just bloats the system prompt.
  const phase = String((project as { phase?: string }).phase ?? "").toLowerCase();
  const docPhases = ["", "structure", "documents", "envelopes", "hints", "packaging", "done"];
  if (!docPhases.includes(phase)) return "";
  return `DOCUMENT GENERATION WORKFLOW (Phase 4 — read carefully)
PHASE 4 PLANNING GATE (mandatory): After the Logic Flow is approved and BEFORE you call \`create_final_documents_map\` or \`add_document\`, you MUST first call \`propose_document_set\`. You reason through every approved Logic Flow node + suspect to propose the EXACT list of documents this case needs — each entry is one document with a player-facing title, a format-style hint (doc_type), the SPECIFIC clue/purpose it delivers, and the logic-flow node ids it supports. Do NOT assign documents to envelopes; documents are not gated by envelopes. Doc 0 is added automatically — do not include it. Templates are forbidden: two cases must yield two completely different document lists driven by their actual logic chains, not by a fixed boilerplate.
After \`propose_document_set\` succeeds, present the proposed list as numbered bullets in your prose AND call \`propose_options\` with three buttons (in this exact order):
  1) "Approve and build the Final Flow" → on click, call \`create_final_documents_map\`.
  2) "Just build it" → on click, also call \`create_final_documents_map\` immediately (this is the user's "skip review" path; it bypasses the pause).
  3) "Revise the plan" → wait for the user's edit instructions, then call \`propose_document_set\` again with the revised list.
The DEFAULT behaviour is PAUSE: do not call \`create_final_documents_map\` until the user clicks Approve or Just-build-it. The "Just build it" button exists explicitly so the user can opt out of the pause when they're confident.
Once the Final Flow is built, the map contains one \`document\` node per planned game document (including Doc 0), each marked \`ungenerated\` until generated. Then proceed to per-document generation.
Doc 0 hard rule: before creating or generating Doc 0, use the Final Flow as the source of truth. When calling \`add_document\` for Doc 0, set doc_number=0, doc_type="contents checklist", and write hebrew_content as a non-spoiler MASTER INVENTORY: list every document in the box (grouped by topic / document type / investigative area — NOT by envelope) and then list each sealed task envelope as a separate item with its trigger condition (when the player should open it). The player has access to all documents from the start; envelopes are opened only at the matching case beat.
If the user asks to see/show/build the final flow, final board, production map, document map, or mapped final documents, and Logic Flow is already approved but no proposal exists yet, call \`propose_document_set\` first (do NOT skip the planning gate). For older existing cases that already have a Final board but no proposal, you may call \`create_final_documents_map\` directly to refresh from existing data.
The Final Flow is a major production artifact: it must include the approved logic nodes, suspects, sealed task envelopes (drawn as gates pinned to the beat that unlocks each one), planned document nodes, and connecting lines between them. When the Final Flow already exists, acknowledge it before document generation: "I see the Final Flow is created; I'll generate documents from those mapped nodes."
If the user asks you to generate the Logic Flow from chat, call \`generate_logic_flow\`. The tool returns immediately because regeneration runs in the background (~2-3 minutes). Tell the user the regeneration has STARTED and to refresh Canvas → Logic Flow shortly to review and approve the new board — never claim the flow is already regenerated in the same turn.

Each project remembers a \`doc_generation_mode\` choice that controls how aggressive you are when producing documents:
  • "drafts"  — write the row only (title + design_instructions + hebrew_content). Do NOT call generate_document_assets. The user clicks Generate themselves.
  • "auto"    — write the row, THEN ask which output to generate with propose_options (three buttons: "Image", "PDF", "Both"). Only after the user chooses, call generate_document_assets with mode "image", "document", or "both". Show one finished doc at a time so the user can react.
  • "ask"     — after each add_document, ask the user whether to generate Image, PDF, Both, or save as draft with propose_options. Only call generate_document_assets after the user chooses an output.
RULES:
1. The FIRST time you enter Phase 4 in a project where \`doc_generation_mode\` is empty, BEFORE calling add_document, ask the user (with propose_options, 3 buttons) which mode they want — using these labels exactly:
${renderDocModeButtonsBlock(playbook)}
   Then call set_doc_generation_mode with the chosen mode ("drafts" / "auto" / "ask"). After that, follow the rules above without re-asking.
2. If the user already told you in their brief which mode they want (e.g. "just write the prompts, I'll click generate", "go full auto", "do everything yourself"), SKIP the question and call set_doc_generation_mode directly with the inferred mode + a one-line confirmation.
3. The user can switch modes any time. If they say "switch to drafts only" / "go full auto" / "ask me each time", call set_doc_generation_mode and acknowledge.
4. generate_document_assets supports mode "image", "document", or "both". Before generating docs from chat, ask the output question unless the user's current message explicitly says image, PDF/file, or both.
5. Document/file generation is strict direct-provider-only: the selected document model (or assistant planning model if no document model is set) gets the honest first chance to create the actual file directly. Never use or imply hidden Lovable fallback. If the selected model cannot make real files, say to switch Documents to Claude with document skills for PDF/DOCX, or choose Image-only with ChatGPT Image.
6. generate_document_assets is gated server-side: it will refuse if the Logic Flow is not approved, or if the document_id doesn't belong to this project. Trust the receipt.
7. The Hebrew body produced by generate_document_assets MAY differ slightly from the hebrew_content you wrote in add_document — that's expected. The receipt shows the final stored version.
8. If the user asks to install/add a Claude Skill from chat and there is no attached installable package, call explain_claude_skill_install. Claude can automatically choose among enabled installed skills passed to it, but the app must manage installation.`;
})()}

${claudeSkills.length > 0 ? `AVAILABLE CLAUDE SKILLS FOR THIS SURFACE
${renderClaudeSkillCatalog(claudeSkills)}
Claude Skills are SKILL.md-based packages. Their descriptions tell Claude when to use them; full instructions/supporting files are only available when the Skill is invoked by Claude's runtime.` : ""}
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
You may still mention upcoming questions in passing ("After this we'll pick the genre."), but you must not present them as numbered options or call \`propose_options\` for them in the same turn. Treat this as inviolable for setup fields (title, subtitle, mystery_type, genre, year, difficulty, game_language, player_role, case_goal, setting, selling_point, target_doc_count) and for any other situation where you would otherwise stack two button-style questions.

${renderCanonicalVocabBlock(playbook)}

TOOL-CALL-BEFORE-PROSE RULE (HARD ENFORCEMENT — these are not soft suggestions)
1. After the user picks or confirms title, subtitle, mystery_type, genre, year, difficulty, game_language, player_role, case_goal, setting, selling_point, or target_doc_count, your VERY NEXT assistant turn MUST begin with the corresponding update_project tool call BEFORE any prose, narration, or follow-up question. If you produce prose first and the tool call later (or not at all), the Overview panel stays empty and the user sees a broken app — that is a failure. Batch multiple confirmed fields into a single update_project call when the user confirmed several at once.
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
- update_project: change project metadata/phase after approvals. **CALL THIS EVERY TIME** the user approves or commits ANY of these Case Identity / Case Brief fields, individually or in batches: title, subtitle, mystery_type, genre, year, difficulty, game_language, player_role, case_goal, setting, selling_point, target_doc_count, phase. Example triggers — all REQUIRE an update_project call: user picks a mystery_type ("Espionage"), user picks a genre, user picks a title from your numbered options, user picks a difficulty or game language, user provides/confirms a player role, user provides/confirms a case goal, user provides/confirms a setting/year, user agrees to a selling point. Do NOT wait for the end of Phase 1 — persist each field the moment it's locked in. The Case Identity and Case Brief panels on the Overview tab pull DIRECTLY from these fields, so skipping update_project means the user sees an empty Overview even after they answered all your setup questions. Always pass ONLY the fields the user just confirmed (do not re-send unchanged fields). **ALSO** call update_project whenever the user approves or revises any of these case-level briefs: packaging_notes (Phase 7 packaging brief), image_prompt_instructions (per-project image style guide), video_prompt_instructions (per-project video style guide), hint_settings (stage/level hint config — pass the full object), envelope_settings (envelope numbering & defaults — pass the full object). Same rules as for title/genre: persist the moment it's locked in.
- set_solution_summary: AS SOON as the user approves the Phase 2 case summary (or whenever they approve a revised end-to-end solution narrative), call this tool with the full summary text. This single source of truth feeds the Case Board's "Solution summary" button, the Logic Flow generator, and every future document. NEVER skip this step after an approval — without it, the Canvas summary button will be empty and document generation will refuse to run.
- add_suspect / update_suspect: manage cast.
- add_document / update_document: create or edit a document record.
- generate_logic_flow: KICKS OFF Canvas Logic Flow regeneration in the background (returns immediately, real job takes ~2-3 minutes). Always describe the result as STARTED, never as already done; tell the user to refresh Canvas → Logic Flow in a couple of minutes and approve it once it appears. Do not call this tool more than once per turn.
- add_canvas_node / update_canvas_node: add or edit a logic/clue/deduction/envelope/solution node. CRITICAL: when you add a clue/deduction/contradiction/red_herring/document/solution node and the project already has other nodes, you MUST in the SAME turn call add_canvas_edge at least once to wire it into the graph — a floating, unconnected node breaks the Logic Flow.
- add_canvas_edge: connect two existing nodes (source → target) with an optional descriptive label ("reveals", "contradicts", "supports"). Use right after add_canvas_node, or any time the user asks you to link/connect/draw a line between existing nodes.
- add_envelope / update_envelope: manage the 5 fixed envelopes (only update_envelope exists for editing labels/tasks/notes).
- add_hint / generate_hint_stage / update_hint: manage hints (see HINT SYSTEM block below). Prefer generate_hint_stage to scaffold a whole stage; use add_hint for single rows; use update_hint to edit existing rows.
- notify_user: drop a "callback" notification into the case's bell panel — use ONLY when the user defers a decision ("I'll write the title later"), skips a planning step, or asks something that needs revisiting later. Never use it for in-the-moment choices (use propose_options for those).

EDIT-VS-CREATE RULE (CRITICAL — prevents duplicate rows)
When the user references an EXISTING item — by name ("change Yossi's motive"), by number ("rename document 5", "envelope 3"), by pronoun ("make it shorter", "rename it"), by role ("the murder weapon node", "the red herring suspect"), or any other reference to something already in the rosters below — you MUST call the matching \`update_*\` tool, passing the \`id\` from the roster. NEVER call the \`add_*\` variant for an item that already exists — that creates a duplicate row and confuses the user. Use \`add_*\` ONLY for items that are not present in the rosters below.
Pass ONLY the fields the user wants to change in the update tool — undefined keys are ignored, so partial edits won't wipe other columns. The receipt will say "Updated X: <name> (<changed-fields>)" so the user can immediately see what was touched.

POST-APPROVAL EDIT RULE (CRITICAL — keeps downstream artifacts in sync)
After the user has approved the Logic Flow (logic_approved_at is set), every add_canvas_node, update_canvas_node, and add_canvas_edge call returns a tool result with a \`requires_followup\` payload. This means the saved \`solution_summary\` and any existing Final Flow / production map are now potentially STALE — they reflect the old graph, not the change you just made. You MUST in the SAME assistant turn:
  1. Briefly tell the user (1–2 sentences) which downstream artifacts are now stale (e.g. "Heads-up: the case summary and the Final Flow still reflect the old graph.").
  2. Call \`propose_options\` with the EXACT options listed in \`requires_followup.offer\` (use each \`label\` as the button text and each \`send\` as the click payload). Do not invent your own labels — pass them through verbatim so the buttons trigger the right follow-up tools.
  3. Wait for the user's choice before doing anything else. If they pick "Update the case summary", call \`set_solution_summary\` with a freshly rewritten summary that incorporates the change. If they pick "Rebuild the Final Flow", call \`create_final_documents_map\`. If they pick "Leave as-is for now", drop a \`notify_user\` reminder so the resync is not forgotten.
NEVER skip this step after a post-approval graph edit — that is the #1 way the project drifts out of sync (Canvas shows the new clue, but the summary, the Final Flow, and the documents that get generated all still ignore it).

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
Game language: ${project.game_language ?? "Hebrew"}
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
${suspectCount > 0 ? `Existing suspects (${suspectCount}):\n${suspectsList}` : ""}
${docCount > 0 ? `Existing documents (${docCount}):\n${documentsList}` : ""}
${rosters.envelopes.length > 0 ? `Existing envelopes (${rosters.envelopes.length}):\n${envelopesList}` : ""}
${rosters.hints.length > 0 ? `Existing hints (${rosters.hints.length}):\n${hintsList}` : ""}
${rosters.canvas_nodes.length > 0 ? `Existing canvas nodes (${rosters.canvas_nodes.length}):\n${nodesList}` : ""}
Logic flow approved: ${project.logic_approved_at ? "YES (" + project.logic_approved_at + ")" : "NO — must be approved on the Canvas before generating documents"}
Canvas edges: ${rosters.canvas_edges_count ?? 0}${rosters.logic_dirty_since_approval ? " — ⚠️ LOGIC GRAPH HAS BEEN EDITED SINCE APPROVAL: solution_summary and any existing Final Flow may be stale. Offer the user the post-approval follow-up buttons (see POST-APPROVAL EDIT RULE)." : ""}
Final Flow mapped: ${rosters.canvas_nodes.some((n) => n.board === "final" && n.node_type === "document") ? `YES (${rosters.canvas_nodes.filter((n) => n.board === "final").length} final-board nodes)` : "NO — ask to create the Final Flow before final documents"}
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
    ["game_language", project.game_language],
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

Respond in English for planning. Write final in-game text in the selected Game language (${project.game_language ?? "Hebrew"}). Keep outputs concise unless the user requests depth.${overrides}

REMINDER (read this before every reply):
• Any numbered 2–6 mutually-exclusive choice list in your prose → ALSO call \`propose_options\` in the same turn.
• Any confirmed Case Identity field (title, subtitle, mystery_type, genre, year, difficulty, game_language, player_role, case_goal, setting, selling_point, target_doc_count, phase) → ALSO call \`update_project\` in the same turn, BEFORE the prose.
• USER-ENTERED FIELDS RULE: For every field listed under USER-EDITED FIELDS above, your first action is to acknowledge it out loud (e.g. "I see you already wrote the subtitle as '<value>' — keeping it.") and then either ask if the user wants you to refine it or skip past it to the next unfilled field. Do NOT silently overwrite a user-entered field with \`update_project\`, and do NOT propose options/numbered alternatives for a field the user already filled. The only exception is if the user explicitly asks you to rewrite or replace it.
• ONE-QUESTION-PER-TURN: ask AT MOST one pick-from-buttons question per turn. If you find yourself writing two questions ("now pick mystery_type… then pick genre…"), STOP, delete the second one, ask only the first, and ask the next one in your following turn after the user answers.
Skipping either tool means the UI silently breaks for the user.`;
}

// ---------- Server-side fallback: synthesize quick-reply options from a numbered list ----------
// Some models (notably newer GPT variants under long conversations) write "1) … 2) … 3) …"
// in prose but forget to call `propose_options`. When that happens, parse the prose
// and synthesize options so the UI still renders buttons. Conservative on purpose:
// only fires when the message looks like a question with 2–6 short numbered choices.

// Used to validate that the model's `propose_options` arguments match THIS turn's
// prose (and aren't a stale copy of a previous turn's options).
function optionsMatchProse(
  options: Array<{ label: string }> | null | undefined,
  prose: string,
): boolean {
  if (!options || options.length === 0 || !prose) return true; // nothing to check
  const itemRe = /^\s*\d+[\.\)]\s+(.+?)\s*$/;
  const items: string[] = [];
  for (const line of prose.split("\n")) {
    const m = itemRe.exec(line);
    if (m) items.push(m[1].trim().toLowerCase());
  }
  if (items.length === 0) return true; // no numbered list in prose → can't check
  const haystack = items.join(" \n ");
  return options.some((o) => o?.label && haystack.includes(o.label.trim().toLowerCase()));
}

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
      description: "Update project metadata. Covers Case Identity (title, subtitle, phase, mystery_type, genre, year, difficulty, game_language, player_role, case_goal, setting, selling_point, target_doc_count) AND case-level briefs (packaging_notes, image_prompt_instructions, video_prompt_instructions, hint_settings, envelope_settings). Pass ONLY the fields that changed — undefined keys are ignored. For hint_settings/envelope_settings, pass the FULL object you want stored (it overwrites, no shallow merge).",
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
          game_language: { type: "string", description: "Per-case language for final in-game content. Use one of the playbook language options when possible." },
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
          planning_depth: { type: "string", enum: ["express", "guided", "deep"], description: "How thoroughly the assistant should plan this case: 'express' = ask only the title and auto-fill the rest; 'guided' = basics only; 'deep' = walk through every detail. Set this when the user picks a depth on the first turn or asks to switch later." },
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
          envelope_number: { type: "number", description: "DEPRECATED for distribution. Leave null in nearly all cases. All documents are in the box from the start. Set this ONLY if the user explicitly wants this document physically tucked inside a sealed task envelope (rare)." },
          final_node_id: { type: "string", description: "Optional Final board document-node id this row is being created from." },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_document_set",
      description:
        "Phase 4 PLANNING GATE — call this AFTER Logic Flow approval and BEFORE create_final_documents_map. You reason through the entire approved Logic Flow and propose the exact list of game documents needed (no templates, no padding). Each entry: a player-facing title, a format-style hint (doc_type — interrogation transcript, autopsy report, letter, photograph, receipt, etc.), the SPECIFIC clue/purpose this document delivers, and which Logic Flow node ids it supports. Documents are NOT distributed by envelope — every document is in the box from the start; do not assign envelope_number unless the user explicitly wants a doc physically inside a task envelope (rare). Doc 0 is added automatically by the playbook — DO NOT include it. After calling this tool, present the list in prose and ask the user to Approve, Just-build-it, or Revise (use propose_options).",
      parameters: {
        type: "object",
        properties: {
          documents: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                doc_number: { type: "number", description: "Optional. Leave blank to auto-number from 1 upward." },
                title: { type: "string" },
                doc_type: { type: "string", description: "Format / visual style hint only (NOT a content template)." },
                print_size: { type: "string", description: "e.g. A4, A5, photo, ticket-stub, etc." },
                envelope_number: { type: "number", description: "DEPRECATED for distribution. Leave blank/null. Documents are not gated by envelopes." },
                purpose: { type: "string", description: "The specific clue / role this document delivers in THIS case. Reason from the Logic Flow — not generic." },
                linked_logic_node_ids: { type: "array", items: { type: "string" }, description: "Canvas Logic Flow node ids this document supports." },
              },
              required: ["title", "purpose"],
              additionalProperties: false,
            },
          },
        },
        required: ["documents"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_final_documents_map",
      description: "Build the Final board production map from the approved proposed_document_set (preferred) — falls back to logic-flow padding only when no proposal exists. Call this AFTER propose_document_set has been approved by the user (or after the user clicked 'Just build it' to bypass review).",
      parameters: {
        type: "object",
        properties: {
          replace: { type: "boolean", description: "Default true. Replace existing unlinked Final-board document nodes." },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_logic_flow",
      description: "Generate or replace the Canvas Logic Flow board from the case brief/approved summary. The user must still review and approve it before final document generation.",
      parameters: {
        type: "object",
        properties: {
          use_existing_summary: { type: "boolean", description: "Use the saved solution_summary when present. Default true." },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_canvas_node",
      description: "Add a node to the logic canvas. CRITICAL: when the node is a clue, deduction, contradiction, red_herring, document, or solution and the project already has other nodes, you MUST in the SAME turn also call add_canvas_edge at least once to wire this node into the existing graph (otherwise it floats disconnected and breaks the Logic Flow). If logic_approved_at is set, you must also follow the POST-APPROVAL EDIT RULE.",
      parameters: {
        type: "object",
        properties: {
          node_type: { type: "string", enum: ["clue", "suspect", "deduction", "contradiction", "red_herring", "envelope", "solution", "document", "hint", "note"] },
          title: { type: "string" },
          description: { type: "string" },
          color: { type: "string" },
          board: { type: "string", enum: ["logic", "final"], description: "Defaults to 'logic'. Use 'final' only when explicitly editing the production map." },
        },
        required: ["node_type", "title"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_canvas_edge",
      description: "Connect two existing canvas nodes with a directional edge (source → target). Use immediately after add_canvas_node to wire the new node into the graph, or any time the user asks you to link / connect / draw a line between nodes. The label is optional but strongly recommended for logic clarity (e.g. 'leads to', 'contradicts', 'supports', 'reveals').",
      parameters: {
        type: "object",
        properties: {
          source_id: { type: "string", description: "Canvas node id the edge starts from (from the Existing canvas nodes roster)." },
          target_id: { type: "string", description: "Canvas node id the edge points to." },
          label: { type: "string", description: "Optional short label shown on the edge (e.g. 'reveals', 'contradicts', 'supports')." },
          board: { type: "string", enum: ["logic", "final"], description: "Defaults to 'logic'." },
        },
        required: ["source_id", "target_id"],
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
        "Actually trigger generation for an existing document row (the same pipeline as the Documents tab's Generate buttons). Use ONLY in 'auto' mode after add_document, or in 'ask' mode after the user confirms 'Generate now'. Mode 'image' creates the visual prop, 'document' asks the selected model to create an actual PDF/DOCX/PPTX/XLSX file directly, and 'both' creates both. The receipt returns previews, file URL, model, skill, and saved prompt metadata.",
      parameters: {
        type: "object",
        properties: {
          document_id: { type: "string", description: "ID returned by the most recent add_document call." },
          mode: { type: "string", enum: ["text", "image", "document", "both"], description: "Which assets to generate. Default 'both'." },
          document_format: { type: "string", enum: ["pdf", "docx", "pptx", "xlsx"], description: "Document file format when mode is document/both. Default pdf." },
        },
        required: ["document_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "explain_claude_skill_install",
      description:
        "Use when the user asks to install/add/use a new Claude Skill from chat but no installable skill package/file is available in the current message. This records a clear assistant receipt explaining that a Claude Skill package must be uploaded/installed from Settings or attached for installation.",
      parameters: {
        type: "object",
        properties: {
          requested_skill: { type: "string", description: "Short name/description of the skill the user asked for." },
          intended_use: { type: "string", description: "Where the skill should be used, e.g. documents, marketing, logic analysis." },
        },
        required: ["requested_skill"],
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
          envelope_number: { type: "number", description: "DEPRECATED for distribution. Almost always leave null. Documents are in the box from the start; only set if the user explicitly wants this doc physically inside a sealed task envelope." },
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
        "Edit an EXISTING envelope row by id (from the Existing envelopes roster). Pass ONLY the fields you want to change. Envelopes are SEALED TASK GATES (not document containers): the player only opens an envelope when they reach the matching beat. The 'notes' field MUST start with the OPENING TRIGGER — a 1-sentence description of when the player should open this envelope (e.g. 'Open after the player has narrowed it to two suspects.' or 'Open once the cipher in Doc 7 is solved.') — followed by any internal design notes. The 'task' field is the short, bold, in-language instruction the player reads when they open the envelope.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Envelope id from the roster." },
          label: { type: "string" },
          task: { type: "string", description: "Short, bold, in-language instruction the player reads when they open this envelope at the right moment. Never the next batch of evidence." },
          notes: { type: "string", description: "Start with 'Opening trigger: <when to open>'. Then any internal design notes." },
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
    const props = (cloned.function.parameters as unknown as { properties?: Record<string, { enum?: string[] }> }).properties;
    if (props?.phase) props.phase.enum = phaseEnum;
    return cloned;
  });
}

// ---------- Tool executor ----------
// `messageId` is the chat_messages row this tool call is being attributed to.
// Every write stamps it so the UI can later jump back to the chat turn that
// created or last edited the row.
async function executeTool(
  supa: any,
  projectId: string,
  name: string,
  args: Record<string, unknown>,
  messageId: string | null,
  playbook: Playbook = PLAYBOOK_DEFAULTS,
) {
  try {
    const withMessage = (payload: Record<string, unknown>) => (
      messageId ? { ...payload, created_by_message_id: messageId } : payload
    );
    if (!messageId && ["add_document", "update_document", "add_suspect", "update_suspect", "add_canvas_node", "update_canvas_node", "add_canvas_edge"].includes(name)) {
      return { ok: false, message: "Assistant message could not be saved, so I did not create linked project rows. Please retry this step." };
    }
    // Helper: when the project has already been logic-approved, any edit to the
    // logic graph (add/update node, add edge) means the saved solution_summary
    // and any existing Final Flow are now potentially stale. We attach a
    // `requires_followup` payload to the receipt so the assistant must surface
    // it as quick-reply buttons in the same turn (see POST-APPROVAL EDIT RULE).
    const buildPostApprovalFollowup = async (changeKind: string): Promise<{ requires_followup: { reason: string; stale: string[]; offer: Array<{ key: string; label: string; send: string }> } } | Record<string, never>> => {
      const { data: proj } = await supa
        .from("projects")
        .select("logic_approved_at, solution_summary, proposed_document_set_status")
        .eq("id", projectId)
        .single();
      if (!proj?.logic_approved_at) return {};
      const { count: finalNodeCount } = await supa
        .from("canvas_nodes")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("board", "final");
      const stale: string[] = [];
      if (proj.solution_summary) stale.push("solution_summary");
      if ((finalNodeCount ?? 0) > 0) stale.push("final_flow");
      if (proj.proposed_document_set_status === "approved") stale.push("proposed_document_set");
      const offer: Array<{ key: string; label: string; send: string }> = [];
      offer.push({
        key: "rewrite_summary",
        label: "Update the case summary",
        send: "Rewrite the case summary now to reflect the change I just made, then call set_solution_summary with the new text.",
      });
      if ((finalNodeCount ?? 0) > 0) {
        offer.push({
          key: "rebuild_final_flow",
          label: "Rebuild the Final Flow",
          send: "Rebuild the Final Flow / production map now using create_final_documents_map so it reflects the change.",
        });
      }
      offer.push({
        key: "leave_as_is",
        label: "Leave as-is for now",
        send: "Leave the summary and Final Flow as-is for now. I'll resync later.",
      });
      return {
        requires_followup: {
          reason: `${changeKind} after Logic Flow was approved`,
          stale,
          offer,
        },
      };
    };
    if (name === "update_project") {
      // Merge per-field origins so each updated field points to this message.
      const { data: current } = await supa
        .from("projects")
        .select("assistant_origins")
        .eq("id", projectId)
        .single();
      const origins = { ...(current?.assistant_origins as Record<string, string> ?? {}) };
      if (messageId) for (const k of Object.keys(args)) origins[k] = messageId;
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
      if (messageId) origins.solution_summary = messageId;
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
        .insert(withMessage({ ...args, project_id: projectId }))
        .select("id, name, thumbnail_url, alt_thumbnail_url")
        .single();
      if (error) throw error;
      const extras: Record<string, unknown> = {};
      if (data.thumbnail_url) extras.thumbnail_url = data.thumbnail_url;
      if (data.alt_thumbnail_url) extras.alt_thumbnail_url = data.alt_thumbnail_url;
      return { ok: true, message: `Suspect created: ${data.name}`, id: data.id, ...extras };
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
      const { count: finalDocCount } = await supa
        .from("canvas_nodes")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("board", "final")
        .eq("node_type", "document");
      if (!finalDocCount) {
        return {
          ok: false,
          message: "Cannot create final documents yet — the Final Flow is not mapped. Ask the user whether to generate the Final Flow now; if they say yes, call create_final_documents_map first, then create documents from those nodes.",
        };
      }
      const finalNodeId = typeof args.final_node_id === "string" ? args.final_node_id : null;
      const insertArgs = { ...args };
      delete insertArgs.final_node_id;
      const docNumber = insertArgs.doc_number ?? Math.floor(100 + Math.random() * 900);
      const linkedNodeIds = finalNodeId ? [finalNodeId] : undefined;
      const isDoc0 = Number(docNumber) === 0 || /\bdoc\s*0\b|document\s*0|contents|inventory|תוכן עניינים|רשימת תכולה/i.test(String(insertArgs.title ?? "")) || String(insertArgs.doc_type ?? "").toLowerCase() === "contents checklist";
      if (isDoc0) {
        const doc0Def = playbook.universal_documents.docs.find((doc) => doc.key === "doc0_contents") ?? PLAYBOOK_DEFAULTS.universal_documents.docs[0];
        insertArgs.title = insertArgs.title || doc0Def.title_template;
        insertArgs.doc_type = doc0Def.doc_type || "contents checklist";
        insertArgs.print_size = insertArgs.print_size || doc0Def.print_size || "A4";
        const { data: finalDocNodes } = await supa
          .from("canvas_nodes")
          .select("id, title, description, data")
          .eq("project_id", projectId)
          .eq("board", "final")
          .eq("node_type", "document")
          .order("position_y", { ascending: true });
        const inventoryLines = (finalDocNodes ?? [])
          .filter((node: any) => Number(node.data?.docNumber) !== 0)
          .map((node: any) => `- #${node.data?.docNumber ?? "?"} ${node.title} (${node.data?.docType ?? "document"}, ${node.data?.printSize ?? "A4"})${node.data?.envelopeNumber ? ` — envelope ${node.data.envelopeNumber}` : ""}`);
        if (inventoryLines.length > 0) {
          insertArgs.hebrew_content = [
            String(insertArgs.hebrew_content ?? "").trim(),
            `\n\nAuthoritative Final Flow inventory source for Doc 0:\n- Doc 0 — ${insertArgs.title}\n${inventoryLines.join("\n")}`,
          ].filter(Boolean).join("\n");
        }
        const { data: existingDoc0 } = await supa
          .from("documents")
          .select("id, title")
          .eq("project_id", projectId)
          .eq("doc_number", 0)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existingDoc0) {
          await supa
            .from("documents")
            .update(withMessage({ ...insertArgs, doc_number: 0, doc_type: insertArgs.doc_type ?? "contents checklist", ...(linkedNodeIds ? { linked_node_ids: linkedNodeIds } : {}) }))
            .eq("id", existingDoc0.id);
          if (finalNodeId) await supa.from("canvas_nodes").update({ data: { documentId: existingDoc0.id, generationStatus: "draft row created" } }).eq("id", finalNodeId).eq("project_id", projectId);
          return { ok: true, message: `Doc 0 updated: ${insertArgs.title ?? existingDoc0.title} (#0)`, id: existingDoc0.id };
        }
      }
      const { data, error } = await supa
        .from("documents")
        .insert(withMessage({ ...insertArgs, doc_number: isDoc0 ? 0 : docNumber, project_id: projectId, doc_type: isDoc0 ? (insertArgs.doc_type ?? "contents checklist") : insertArgs.doc_type, ...(linkedNodeIds ? { linked_node_ids: linkedNodeIds } : {}) }))
        .select("id, title")
        .single();
      if (error) throw error;
      if (finalNodeId) {
        await supa.from("canvas_nodes").update({ data: { documentId: data.id, generationStatus: "draft row created" } }).eq("id", finalNodeId).eq("project_id", projectId);
      }
      return { ok: true, message: `Document created: ${data.title} (#${docNumber})`, id: data.id };
    }
    if (name === "propose_document_set") {
      const proposalDocs = Array.isArray((args as { documents?: unknown[] }).documents) ? (args as { documents: unknown[] }).documents : [];
      if (proposalDocs.length === 0) return { ok: false, message: "propose_document_set needs at least one document" };
      // Sanitize entries — keep only the planning fields, drop unknowns.
      const cleaned = proposalDocs.map((raw, i) => {
        const d = (raw ?? {}) as Record<string, unknown>;
        return {
          doc_number: typeof d.doc_number === "number" ? d.doc_number : null,
          title: String(d.title ?? `Planned document ${i + 1}`).slice(0, 200),
          doc_type: typeof d.doc_type === "string" && d.doc_type.trim().length > 0 ? d.doc_type.trim() : "case evidence",
          print_size: typeof d.print_size === "string" && d.print_size.trim().length > 0 ? d.print_size.trim() : "A4",
          envelope_number: typeof d.envelope_number === "number" ? d.envelope_number : null,
          purpose: String(d.purpose ?? "Planned by the assistant from the Logic Flow.").slice(0, 1200),
          linked_logic_node_ids: Array.isArray(d.linked_logic_node_ids) ? (d.linked_logic_node_ids as unknown[]).filter((x): x is string => typeof x === "string") : [],
        };
      });
      const { error } = await supa
        .from("projects")
        .update({ proposed_document_set: cleaned, proposed_document_set_status: "proposed", proposed_document_set_approved_at: null })
        .eq("id", projectId);
      if (error) return { ok: false, message: `Failed to save proposal: ${error.message}` };
      return {
        ok: true,
        message: `Document plan proposed with ${cleaned.length} documents. Doc 0 will be added automatically. Ask the user to Approve, Just build it (skip review), or Revise.`,
        proposal: cleaned,
      };
    }
    if (name === "create_final_documents_map") {
      // Mark proposal as approved (or bypassed if there is none) before building.
      const { data: proj } = await supa.from("projects").select("proposed_document_set, proposed_document_set_status").eq("id", projectId).single();
      const hasProposal = Array.isArray(proj?.proposed_document_set) && (proj?.proposed_document_set as unknown[]).length > 0;
      const nextStatus = hasProposal ? (proj?.proposed_document_set_status === "approved" ? "approved" : "approved") : "bypassed";
      await supa.from("projects").update({ proposed_document_set_status: nextStatus, proposed_document_set_approved_at: new Date().toISOString() }).eq("id", projectId);
      const base = `${SUPABASE_URL}/functions/v1/create-final-documents-map`;
      const resp = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ projectId, replace: (args as { replace?: boolean }).replace !== false, createdByMessageId: messageId }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) return { ok: false, message: payload.error ?? "Final Flow creation failed" };
      return { ok: true, message: `Final Flow created with ${payload.nodeCount ?? 0} nodes, including ${payload.documentNodeCount ?? 0} planned documents and ${payload.edgeCount ?? 0} connecting lines${hasProposal ? " (built from your approved proposal)" : ""}. Review the Final board before creating document rows.` };
    }
    if (name === "generate_logic_flow") {
      // generate-logic-flow can take 2-3 minutes (heavy planning model call),
      // which exceeds the subrequest timeout when awaited synchronously from
      // here. Kick it off as a background task and tell the assistant to
      // report it as STARTED, not COMPLETE, so the LLM doesn't claim it
      // failed when the underlying job is still working.
      const body = JSON.stringify({
        projectId,
        replace: true,
        useExistingSummary: (args as { use_existing_summary?: boolean }).use_existing_summary !== false,
      });
      const fireAndForget = fetch(`${SUPABASE_URL}/functions/v1/generate-logic-flow`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body,
      }).catch((err) => {
        console.error("[assistant-chat] generate-logic-flow background fetch failed", err);
      });
      // Keep the worker alive long enough to send the request without blocking
      // the assistant turn on the full 2-3 min response.
      const runtime = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
      if (runtime?.waitUntil) runtime.waitUntil(fireAndForget);
      return {
        ok: true,
        message:
          "Logic Flow regeneration STARTED in the background (uses your planning model — typically 2-3 minutes). It is NOT done yet. " +
          "Tell the user: the new board will appear automatically on Canvas → Logic Flow when it finishes; refresh that view in a couple of minutes. " +
          "Do NOT claim the flow is already regenerated, and do NOT call this tool again in the same turn.",
      };
    }
    if (name === "add_canvas_node") {
      const { data, error } = await supa
        .from("canvas_nodes")
        .insert({
          ...args,
          project_id: projectId,
          position_x: Math.random() * 600,
          position_y: Math.random() * 400,
          ...(messageId ? { created_by_message_id: messageId } : {}),
        })
        .select("id, title")
        .single();
      if (error) throw error;
      const followup = await buildPostApprovalFollowup(`add_canvas_node (${data.title})`);
      return { ok: true, message: `Canvas node added: ${data.title}. ${('requires_followup' in followup) ? "REMEMBER: also call add_canvas_edge to wire it into the graph, then surface the post-approval follow-up buttons." : "REMEMBER: if there are existing nodes this should connect to, call add_canvas_edge in the same turn."}`, id: data.id, ...followup };
    }
    if (name === "add_canvas_edge") {
      const sourceId = String((args as { source_id?: string }).source_id ?? "").trim();
      const targetId = String((args as { target_id?: string }).target_id ?? "").trim();
      const label = (args as { label?: string }).label;
      const board = String((args as { board?: string }).board ?? "logic").trim();
      if (!sourceId || !targetId) return { ok: false, message: "source_id and target_id are required" };
      if (sourceId === targetId) return { ok: false, message: "source_id and target_id must be different nodes" };
      // Verify both nodes exist on the same board within this project.
      const { data: nodes, error: lookupErr } = await supa
        .from("canvas_nodes")
        .select("id, board, title")
        .in("id", [sourceId, targetId])
        .eq("project_id", projectId);
      if (lookupErr) throw lookupErr;
      if (!nodes || nodes.length !== 2) {
        return { ok: false, message: "One or both node ids were not found in this project. Pass valid ids from the Existing canvas nodes roster." };
      }
      const { data, error } = await supa
        .from("canvas_edges")
        .insert({
          source_id: sourceId,
          target_id: targetId,
          label: label ?? null,
          board,
          project_id: projectId,
        })
        .select("id")
        .single();
      if (error) throw error;
      const src = (nodes as Array<{ id: string; title: string }>).find((n) => n.id === sourceId)?.title ?? sourceId;
      const tgt = (nodes as Array<{ id: string; title: string }>).find((n) => n.id === targetId)?.title ?? targetId;
      const followup = await buildPostApprovalFollowup(`add_canvas_edge (${src} → ${tgt})`);
      return { ok: true, message: `Edge created: ${src} → ${tgt}${label ? ` ("${label}")` : ""}`, id: data.id, ...followup };
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
      if (messageId) origins.doc_generation_mode = messageId;
      const { error } = await supa
        .from("projects")
        .update({ doc_generation_mode: mode, assistant_origins: origins })
        .eq("id", projectId);
      if (error) throw error;
      const friendly = mode === "drafts"
        ? "Drafts only — I'll write the rows, you press Generate"
        : mode === "auto"
          ? "Full auto — after each doc I'll ask Image, PDF, or Both before generating"
          : "Ask each time — I'll check Image, PDF, Both, or draft before generating";
      return { ok: true, message: `Document workflow set: ${friendly}` };
    }
    if (name === "generate_document_assets") {
      const documentId = String((args as { document_id?: string }).document_id ?? "").trim();
      const requestedMode = String((args as { mode?: string }).mode ?? "both").trim();
      const documentFormat = String((args as { document_format?: string }).document_format ?? "pdf").trim();
      if (!documentId) return { ok: false, message: "document_id is required" };
      if (!["text", "image", "document", "both"].includes(requestedMode)) {
        return { ok: false, message: "mode must be 'text', 'image', 'document', or 'both'" };
      }
      if (!["pdf", "docx", "pptx", "xlsx"].includes(documentFormat)) {
        return { ok: false, message: "document_format must be 'pdf', 'docx', 'pptx', or 'xlsx'" };
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

      const imageOrigins: Array<{ requested?: string | null; effective?: string | null; provider?: string | null; fallback?: string | null }> = [];
      const callGenerate = async (m: "text" | "image" | "document") => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 120_000);
        try {
          const r = await fetch(`${SUPABASE_URL}/functions/v1/generate-document`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ documentId, mode: m, documentFormat }),
            signal: ctrl.signal,
          });
          const body = await r.json().catch(() => ({}));
          if (m === "image" && r.ok) {
            imageOrigins.push({
              requested: body?.requestedModel ?? null,
              effective: body?.effectiveModel ?? body?.requestedModel ?? null,
              provider: body?.provider ?? null,
              fallback: body?.fallback ?? "none",
            });
          }
          return { ok: r.ok, status: r.status, body };
        } catch (e) {
          const aborted = (e as Error)?.name === "AbortError";
          return { ok: false, status: aborted ? 504 : 500, body: { error: aborted ? "timeout after 120s — generation continues server-side, check Documents tab" : (e as Error)?.message ?? "fetch failed" } };
        } finally {
          clearTimeout(timer);
        }
      };

      const errors: string[] = [];
      const completed: string[] = [];
      if (requestedMode === "text" || requestedMode === "both") {
        const r = await callGenerate("text");
        if (!r.ok) errors.push(`body text failed: ${r.body?.error ?? r.status}`);
        else completed.push("body text");
      }
      if (requestedMode === "document" || requestedMode === "both") {
        const r = await callGenerate("document");
        if (!r.ok) errors.push(`direct ${documentFormat.toUpperCase()} file failed: ${r.body?.error ?? r.status}`);
        else completed.push(`${documentFormat.toUpperCase()} file`);
      }
      if (requestedMode === "image" || requestedMode === "both") {
        const r = await callGenerate("image");
        if (!r.ok) errors.push(`image preview failed: ${r.body?.error ?? r.status}`);
        else completed.push("image preview");
      }

      // Re-read row to grab whatever made it through.
      const { data: finalDoc } = await supa
        .from("documents")
        .select("hebrew_content, generated_asset_url, generated_document_url, generated_pdf_url, document_format, document_model, document_provider, document_skill_id, title")
        .eq("id", documentId)
        .single();
      const hebrew = (finalDoc?.hebrew_content ?? "").toString();
      const preview = hebrew.length > 240 ? `${hebrew.slice(0, 240)}…` : hebrew;
      const imageUrl = finalDoc?.generated_asset_url ?? null;
      const documentUrl = finalDoc?.generated_document_url ?? finalDoc?.generated_pdf_url ?? null;

      if (errors.length > 0 && !imageUrl && !hebrew && !documentUrl) {
        return { ok: false, message: `Generation failed for "${finalDoc?.title ?? "document"}" — ${errors.join("; ")}. You can retry this same document safely.`, id: documentId };
      }
      const done = completed.length > 0 ? ` Completed: ${completed.join(", ")}.` : "";
      const partial = errors.length > 0 ? ` Partial issues: ${errors.join("; ")}. You can retry failed parts from this same document.` : "";
      return {
        ok: true,
        message: `Generated assets for "${finalDoc?.title ?? "document"}".${done}${partial}`,
        id: documentId,
        hebrew_preview: preview || undefined,
        image_url: imageUrl || undefined,
        document_url: documentUrl || undefined,
        document_format: finalDoc?.document_format || documentFormat,
        document_model: finalDoc?.document_model || finalDoc?.document_provider || undefined,
        document_skill_id: finalDoc?.document_skill_id || undefined,
        image_requested_model: imageOrigins[0]?.requested || finalDoc?.document_model || undefined,
        image_effective_model: imageOrigins[0]?.effective || finalDoc?.document_model || undefined,
        image_provider: imageOrigins[0]?.provider || finalDoc?.document_provider || undefined,
        image_fallback: imageOrigins[0]?.fallback || "none",
      };
    }
    if (name === "explain_claude_skill_install") {
      const requested = String((args as { requested_skill?: string }).requested_skill ?? "Claude Skill").trim() || "Claude Skill";
      const intendedUse = String((args as { intended_use?: string }).intended_use ?? "relevant Claude tasks").trim() || "relevant Claude tasks";
      return {
        ok: true,
        message: `Claude Skill install request noted: ${requested}. To install it, upload a Claude Skill package/file in Settings → Assistant Rules → Claude Skills, then enable it for ${intendedUse}. Once installed, Claude requests will receive the enabled skill list automatically.`,
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
      if (stampMessage && messageId) patch.created_by_message_id = messageId;
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
      const niceName = formatName((updated ?? {}) as unknown as Record<string, unknown>);
      const u = (updated ?? {}) as unknown as Record<string, unknown>;
      const extras: Record<string, unknown> = {};
      if (typeof u.thumbnail_url === "string" && u.thumbnail_url) extras.thumbnail_url = u.thumbnail_url;
      if (typeof u.alt_thumbnail_url === "string" && u.alt_thumbnail_url) extras.alt_thumbnail_url = u.alt_thumbnail_url;
      if (typeof u.cover_image_url === "string" && u.cover_image_url) extras.cover_image_url = u.cover_image_url;
      if (typeof u.generated_asset_url === "string" && u.generated_asset_url) extras.image_url = u.generated_asset_url;
      return {
        ok: true,
        message: `Updated ${label}: ${niceName} (${changed.join(", ")})`,
        id,
        ...extras,
      };
    };

    if (name === "update_suspect") {
      return await runUpdate(
        "suspects",
        "suspect",
        true,
        "id, name, thumbnail_url, alt_thumbnail_url, thumbnail_prompt, alt_thumbnail_prompt",
        (r) => String(r.name ?? "—"),
      );
    }
    if (name === "update_document") {
      return await runUpdate(
        "documents",
        "document",
        true,
        "id, title, doc_number, generated_asset_url",
        (r) => `#${r.doc_number ?? "?"} ${r.title ?? "—"}`,
      );
    }
    if (name === "update_envelope") {
      return await runUpdate(
        "envelopes",
        "envelope",
        false,
        "id, number, label, cover_image_url, cover_prompt",
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
      const result = await runUpdate(
        "canvas_nodes",
        "node",
        true,
        "id, title, data",
        (r) => String(r.title ?? "—"),
      );
      if ((result as { ok?: boolean })?.ok) {
        const followup = await buildPostApprovalFollowup("update_canvas_node");
        return { ...(result as Record<string, unknown>), ...followup };
      }
      return result;
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
  supa: any,
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
    { count: edgesCount },
    { data: latestNode },
  ] = await Promise.all([
    supa.from("projects").select("*").eq("id", projectId).single(),
    supa.from("suspects").select("id, name, role_in_case").eq("project_id", projectId).order("position", { ascending: true }).limit(25),
    supa.from("documents").select("id, doc_number, title, doc_type, status").eq("project_id", projectId).order("doc_number", { ascending: true, nullsFirst: false }).limit(25),
    supa.from("envelopes").select("id, number, label").eq("project_id", projectId).order("number", { ascending: true }).limit(25),
    supa.from("hints").select("id, stage, level").eq("project_id", projectId).order("stage", { ascending: true }).order("level", { ascending: true }).limit(25),
    supa.from("canvas_nodes").select("id, title, node_type, board").eq("project_id", projectId).order("created_at", { ascending: true }).limit(25),
    supa.from("canvas_edges").select("id", { count: "exact", head: true }).eq("project_id", projectId),
    supa.from("canvas_nodes").select("updated_at").eq("project_id", projectId).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
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

  const modelKey = String(project.ai_provider_planning ?? "openai-5.2");
  const model = PROVIDER_MODEL[modelKey] ?? PROVIDER_MODEL["openai-5.2"] ?? PROVIDER_MODEL.lovable;
  const claudeChatSkills = model.startsWith("anthropic/") ? await loadClaudeSkillsForSurface(supa, "chat") : [];
  const rosters: Rosters = {
    suspects: (suspectsRoster ?? []) as RosterRow[],
    documents: (documentsRoster ?? []) as RosterRow[],
    envelopes: (envelopesRoster ?? []) as RosterRow[],
    hints: (hintsRoster ?? []) as RosterRow[],
    canvas_nodes: (nodesRoster ?? []) as RosterRow[],
    canvas_edges_count: edgesCount ?? 0,
    logic_dirty_since_approval: Boolean(
      project.logic_approved_at && (latestNode as { updated_at?: string } | null)?.updated_at
        && new Date((latestNode as { updated_at: string }).updated_at).getTime() > new Date(project.logic_approved_at).getTime(),
    ),
  };
  const isFirstTurn = (messages?.length ?? 0) <= 1;
  const systemPrompt = buildSystemPrompt(project, rosters, tweaks, playbook, claudeChatSkills, isFirstTurn);

  const lastUser = [...messages].reverse().find((m) => (m as { role: string }).role === "user") as { content: string } | undefined;
  if (lastUser) {
    await supa.from("chat_messages").insert({
      project_id: projectId, role: "user", content: lastUser.content,
    });
  }

  const assistantMessageId = crypto.randomUUID();
  // Placeholder INSERT so any tool call that stamps `created_by_message_id`
  // (documents, suspects, canvas_nodes) satisfies its FK to chat_messages
  // BEFORE the row exists in its final form. We update content+metadata at
  // the end. Client hides bubbles where in_progress=true && content===""
  // until the realtime UPDATE arrives.
  const { error: assistantPlaceholderError } = await supa.from("chat_messages").insert({
    id: assistantMessageId,
    project_id: projectId,
    role: "assistant",
    content: "",
    metadata: { in_progress: true, model, stage: "thinking" },
  });
  if (assistantPlaceholderError) {
    console.error("assistant placeholder insert failed", assistantPlaceholderError);
    throw new Error("I couldn't start a safe assistant message for this run. Please retry; no document rows were created with broken assistant links.");
  }
  const toolMessageId = assistantMessageId;

  const convo: Array<Record<string, unknown>> = [{ role: "system", content: systemPrompt }, ...messages];
  const executedTools: Array<{ name: string; args?: Record<string, unknown>; result: unknown }> = [];
  // Per-round reasoning traces collected from supporting models. Empty unless
  // the project has ai_reasoning_effort != 'none' AND the model supports it.
  type ReasoningSegment = { type: "thinking" | "summary"; text: string };
  const reasoningRounds: Array<{ round: number; segments: ReasoningSegment[] }> = [];
  // Default to "low" — chat is short turn-by-turn and tool calls don't need
  // heavy reasoning. Users who want deeper thinking can crank ai_reasoning_effort.
  const baseEffort = String((project as { ai_reasoning_effort?: string }).ai_reasoning_effort ?? "low");
  const TOOLS = buildTools(playbook);
  const MAX_ROUNDS = 4;
  let lastFb: { effectiveModel: string; fallback: string } = { effectiveModel: model, fallback: "none" };
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const isFinalRound = round === MAX_ROUNDS - 1;
    // Tool-only rounds (everything but the last) get the cheapest reasoning
    // tier — picking the next tool call doesn't need deep thought. Save the
    // user's chosen `baseEffort` for the final prose round.
    const roundEffort = isFinalRound ? baseEffort : "low";
    const body: Record<string, unknown> = { model, messages: convo, stream: false, reasoningEffort: roundEffort, ...claudeSkillRequestShape(claudeChatSkills) };
    if (!isFinalRound) body.tools = TOOLS;

    // Surface progress to the UI between rounds via the placeholder row's
    // metadata.stage. The chat_messages realtime subscription picks this up.
    if (round > 0) {
      const lastTool = executedTools[executedTools.length - 1]?.name;
      const stage = isFinalRound ? "writing reply" : lastTool ? `after ${lastTool}…` : "thinking…";
      void supa.from("chat_messages")
        .update({ metadata: { in_progress: true, model, stage, partial_tools: executedTools.length } })
        .eq("id", assistantMessageId);
    }

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
        await supa.from("chat_messages").update({
          content: recoveryNote,
          metadata: { model, effective_model: lastFb.effectiveModel, fallback: lastFb.fallback, tools: executedTools, ...(reasoningRounds.length ? { reasoning: reasoningRounds } : {}), partial: true, error: errMsg, in_progress: false },
        }).eq("id", assistantMessageId);
        return;
      }
      throw new Error(errMsg);
    }

    const data = await resp.json();
    const choice = data.choices?.[0];
    const msg = choice?.message ?? {};
    const msgReasoning = msg.reasoning as ReasoningSegment[] | undefined;
    if (Array.isArray(msgReasoning) && msgReasoning.length > 0) {
      reasoningRounds.push({ round, segments: msgReasoning });
    }
    const toolCalls = msg.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }> | undefined;
    const thinkingBlocks = (msg as { thinking_blocks?: Array<{ type: "thinking"; text: string; signature?: string }> }).thinking_blocks;

    if (toolCalls && toolCalls.length > 0) {
      convo.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls, ...(thinkingBlocks?.length ? { thinking: thinkingBlocks } : {}) });
      for (const call of toolCalls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* ignore */ }
        const result = await executeTool(supa, projectId, call.function.name, args, toolMessageId, playbook);
        const argsForUi = call.function.name === "propose_options" ? undefined : args;
        executedTools.push({ name: call.function.name, args: argsForUi, result });
        convo.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
      // After this round, warn the model that it's running out of tool rounds
      // — encourages batching the rest and writing the prose reply instead of
      // looping on micro-edits. (round index 1 → next call is index 2 → only
      // index 3, the final prose round, remains.)
      if (round === MAX_ROUNDS - 3) {
        convo.push({ role: "system", content: "You have one tool round left. Make any remaining tool calls in a single batch this turn, then write your reply." });
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
    // Stale-args guard: model sometimes copies the previous turn's
    // propose_options arguments verbatim. Reject if labels don't appear in
    // this turn's prose, then fall through to the prose synthesizer.
    if (quickOptions && quickOptions.length > 0 && !optionsMatchProse(quickOptions, finalText)) {
      console.warn("[assistant-chat] propose_options stale — labels don't match prose, falling back to synth", { labels: quickOptions.map((o) => o.label) });
      quickOptions = null;
      quickQuestion = null;
    }
    if (!quickOptions || quickOptions.length === 0) {
      const synth = synthesizeOptionsFromProse(finalText);
      if (synth) { quickOptions = synth.options; quickQuestion = synth.question; }
    }

    await supa.from("chat_messages").update({
      content: finalText,
      metadata: {
        model, effective_model: lastFb.effectiveModel, fallback: lastFb.fallback, tools: executedTools, in_progress: false,
        ...(reasoningRounds.length ? { reasoning: reasoningRounds } : {}),
        ...(quickOptions ? { options: quickOptions, question: quickQuestion } : {}),
      },
    }).eq("id", assistantMessageId);
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
      { count: edgesCount },
      { data: latestNode },
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
      supa.from("canvas_edges").select("id", { count: "exact", head: true }).eq("project_id", projectId),
      supa.from("canvas_nodes").select("updated_at").eq("project_id", projectId).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
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

    const model = PROVIDER_MODEL[project.ai_provider_planning ?? "openai-5.2"] ?? PROVIDER_MODEL["openai-5.2"] ?? PROVIDER_MODEL.lovable;
    const rosters: Rosters = {
      suspects: (suspectsRoster ?? []) as RosterRow[],
      documents: (documentsRoster ?? []) as RosterRow[],
      envelopes: (envelopesRoster ?? []) as RosterRow[],
      hints: (hintsRoster ?? []) as RosterRow[],
      canvas_nodes: (nodesRoster ?? []) as RosterRow[],
      canvas_edges_count: edgesCount ?? 0,
      logic_dirty_since_approval: Boolean(
        project.logic_approved_at && (latestNode as { updated_at?: string } | null)?.updated_at
          && new Date((latestNode as { updated_at: string }).updated_at).getTime() > new Date(project.logic_approved_at).getTime(),
      ),
    };
    const claudeChatSkills = model.startsWith("anthropic/") ? await loadClaudeSkillsForSurface(supa, "chat") : [];
    const isFirstTurn = (messages?.length ?? 0) <= 1;
    const systemPrompt = buildSystemPrompt(project, rosters, tweaks, playbook, claudeChatSkills, isFirstTurn);

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
    // Placeholder INSERT: satisfies FK constraints from documents/suspects/
    // canvas_nodes that stamp `created_by_message_id` mid-loop. Updated to
    // final content+metadata at the end. Client hides empty in_progress bubbles.
    const { error: assistantPlaceholderError } = await supa.from("chat_messages").insert({
      id: assistantMessageId,
      project_id: projectId,
      role: "assistant",
      content: "",
      metadata: { in_progress: true, model },
    });
    if (assistantPlaceholderError) {
      console.error("assistant placeholder insert failed", assistantPlaceholderError);
      return new Response(JSON.stringify({ error: "I couldn't start a safe assistant message for this run. Please retry; no document rows were created with broken assistant links." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const toolMessageId = assistantMessageId;

    // Tool-calling loop: up to 4 rounds
    const convo: Array<Record<string, unknown>> = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];
    const executedTools: Array<{ name: string; args?: Record<string, unknown>; result: unknown }> = [];
    type ReasoningSegment = { type: "thinking" | "summary"; text: string };
    const reasoningRounds: Array<{ round: number; segments: ReasoningSegment[] }> = [];
    const baseEffort = String((project as { ai_reasoning_effort?: string }).ai_reasoning_effort ?? "low");
    const TOOLS = buildTools(playbook);

    const MAX_ROUNDS = 4;
    const callerUserId = await getUserIdFromAuth(req);
    let lastFb: { effectiveModel: string; fallback: string } = { effectiveModel: model, fallback: "none" };
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const isFinalRound = round === MAX_ROUNDS - 1;
      const roundEffort = isFinalRound ? baseEffort : "low";
      const body: Record<string, unknown> = { model, messages: convo, stream: false, reasoningEffort: roundEffort, ...claudeSkillRequestShape(claudeChatSkills) };
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
          await supa.from("chat_messages").update({
            content: recoveryNote,
            metadata: { model, effective_model: lastFb.effectiveModel, fallback: lastFb.fallback, tools: executedTools, ...(reasoningRounds.length ? { reasoning: reasoningRounds } : {}), partial: true, error: errMsg, in_progress: false },
          }).eq("id", assistantMessageId);
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
      const msgReasoning = msg.reasoning as ReasoningSegment[] | undefined;
      if (Array.isArray(msgReasoning) && msgReasoning.length > 0) {
        reasoningRounds.push({ round, segments: msgReasoning });
      }
      const toolCalls = msg.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }> | undefined;
      const thinkingBlocks = (msg as { thinking_blocks?: Array<{ type: "thinking"; text: string; signature?: string }> }).thinking_blocks;

      if (toolCalls && toolCalls.length > 0) {
        convo.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls, ...(thinkingBlocks?.length ? { thinking: thinkingBlocks } : {}) });
        for (const call of toolCalls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* ignore */ }
          const result = await executeTool(supa, projectId, call.function.name, args, toolMessageId, playbook);
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

      // Stale-args guard (mirror of background branch): if the model copied
      // a previous turn's propose_options arguments, none of the labels will
      // appear in this turn's numbered list. Reject and fall through to synth.
      if (quickOptions && quickOptions.length > 0 && !optionsMatchProse(quickOptions, finalText)) {
        console.warn("[assistant-chat] propose_options stale — labels don't match prose, falling back to synth", { labels: quickOptions.map((o) => o.label) });
        quickOptions = null;
        quickQuestion = null;
      }

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

      await supa.from("chat_messages").update({
        content: finalText,
        metadata: {
          model,
          effective_model: lastFb.effectiveModel,
          fallback: lastFb.fallback,
          tools: executedTools,
          in_progress: false,
          ...(reasoningRounds.length ? { reasoning: reasoningRounds } : {}),
          ...(quickOptions ? { options: quickOptions, question: quickQuestion } : {}),
        },
      }).eq("id", assistantMessageId);

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
