// Mystery Studio Assistant — streaming chat with structured tool calls
// Uses Lovable AI Gateway (Gemini + GPT-5). Tools mutate project state server-side.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  chatCompletions,
  extractFallback,
  logAiRun,
  getUserIdFromAuth,
} from "../_shared/ai-router.ts";
import {
  modelSupportsStreamingReasoning,
  streamReasoningChat,
  type ChatMessageOut,
  type ReasoningSegment as StreamReasoningSegment,
} from "../_shared/stream-reasoning.ts";
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
import {
  claudeSkillRequestShape,
  loadClaudeSkillsForSurface,
  renderClaudeSkillCatalog,
  type ClaudeSkillRow,
} from "../_shared/claude-skills.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ---------- Live-streaming round helper ----------
//
// Runs ONE model round with provider streaming when supported. Reasoning and
// final-text deltas are pushed into chat_messages.metadata.reasoning /
// chat_messages.content with a ~120ms debounce so the UI's ThinkingDisclosure
// types the words live via Realtime instead of waiting for the full round.
// Falls back to the non-streaming chatCompletions path on error / unsupported
// models so the round loop never gets stuck.
type LiveSupa = ReturnType<typeof createClient>;
async function runRoundWithLiveReasoning(args: {
  supa: LiveSupa;
  messageId: string;
  model: string;
  body: Record<string, unknown>;
  // Snapshot of completed prior rounds — the live round we render is appended
  // on top of this so prior rounds remain visible while this one types in.
  priorReasoningRounds: Array<{ round: number; segments: StreamReasoningSegment[] }>;
  roundIndex: number;
  baseMetadata: Record<string, unknown>;
}): Promise<
  | {
      ok: true;
      message: ChatMessageOut;
      effectiveModel: string;
      fallback: "none" | "openai-direct" | "lovable-ai";
    }
  | { ok: false; status: number; errorText: string }
> {
  const { supa, messageId, model, body, priorReasoningRounds, roundIndex, baseMetadata } = args;

  // Helper: write current state to chat_messages with debounce.
  let liveReasoning = "";
  let liveText = "";
  let lastFlushAt = 0;
  let pendingFlush: number | null = null;
  const FLUSH_INTERVAL_MS = 120;

  const writeNow = async () => {
    const liveSegments: StreamReasoningSegment[] = liveReasoning
      ? [{ type: "summary", text: liveReasoning }]
      : [];
    const allRounds = liveSegments.length
      ? [...priorReasoningRounds, { round: roundIndex, segments: liveSegments }]
      : priorReasoningRounds;
    const metadata = {
      ...baseMetadata,
      ...(allRounds.length ? { reasoning: allRounds } : {}),
    };
    const update: Record<string, unknown> = { metadata };
    // Only update content while text is actively streaming so we don't clobber
    // the final content the round-loop writes after tools complete.
    if (liveText) update.content = liveText;
    try {
      await supa.from("chat_messages").update(update).eq("id", messageId);
    } catch (e) {
      console.warn("[stream-flush] update failed", e);
    }
  };
  const scheduleFlush = () => {
    const now = Date.now();
    if (now - lastFlushAt >= FLUSH_INTERVAL_MS) {
      lastFlushAt = now;
      void writeNow();
      return;
    }
    if (pendingFlush != null) return;
    pendingFlush = setTimeout(
      () => {
        pendingFlush = null;
        lastFlushAt = Date.now();
        void writeNow();
      },
      FLUSH_INTERVAL_MS - (now - lastFlushAt),
    ) as unknown as number;
  };

  const supportsStreaming = modelSupportsStreamingReasoning(model);
  const wantsThinking = (body.reasoningEffort as string | undefined) !== "none";

  if (supportsStreaming) {
    const effort =
      (body.reasoningEffort as "none" | "low" | "medium" | "high" | "xhigh" | undefined) ??
      "medium";
    const result = await streamReasoningChat(
      {
        model,
        messages: body.messages as Array<{
          role: string;
          content?: unknown;
          tool_calls?: unknown;
          tool_call_id?: string;
          thinking?: unknown;
        }>,
        tools: body.tools as
          | Array<{
              type: string;
              function: { name: string; description?: string; parameters: unknown };
            }>
          | undefined,
        effort,
        max_tokens: body.max_tokens as number | undefined,
        anthropicTools: body.anthropicTools as Array<Record<string, unknown>> | undefined,
        anthropicContainer: body.anthropicContainer,
        anthropicBeta: body.anthropicBeta as string | undefined,
      },
      {
        onReasoningDelta: (delta) => {
          liveReasoning += delta;
          scheduleFlush();
        },
        onTextDelta: (delta) => {
          liveText += delta;
          scheduleFlush();
        },
      },
    );
    if (pendingFlush != null) {
      clearTimeout(pendingFlush);
      pendingFlush = null;
    }
    // Final flush so the last chunk lands in the DB before the round returns.
    await writeNow();
    if (result.ok) {
      const fallback = "none" as const;
      return { ok: true, message: result.message, effectiveModel: model, fallback };
    }
    // Streaming failed — log and fall through to non-streaming path.
    console.warn(
      `[stream-fallback] streaming failed for ${model} (status ${result.status}); falling back to non-streaming chatCompletions`,
    );
  }

  // Non-streaming path (used for models that don't stream OR after a stream error).
  const nonStreamBody = { ...body, stream: false };
  const resp = await chatCompletions(nonStreamBody);
  const fb = extractFallback(resp, model);
  if (!resp.ok) {
    const text = await resp.text();
    return { ok: false, status: resp.status, errorText: text };
  }
  const data = await resp.json();
  const choice = data.choices?.[0];
  const message: ChatMessageOut = (choice?.message ?? {
    role: "assistant",
    content: "",
  }) as ChatMessageOut;
  // Push the final reasoning/text into metadata one last time so the live UI
  // catches up to the full result.
  if (Array.isArray(message.reasoning) && message.reasoning.length > 0) {
    const allRounds = [...priorReasoningRounds, { round: roundIndex, segments: message.reasoning }];
    await supa
      .from("chat_messages")
      .update({
        metadata: { ...baseMetadata, reasoning: allRounds },
      })
      .eq("id", messageId);
  }
  return {
    ok: true,
    message,
    effectiveModel: fb.effectiveModel,
    fallback: fb.fallback,
  };
}

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
  const str = String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!str) return "—";
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}
function detectPlanningDepthChoice(text: unknown): PlanningDepth | null {
  const s = String(text ?? "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (/^(⚡\s*)?express\b/.test(s) || /\bchoose\s+express\b/.test(s) || /you plan it all/.test(s))
    return "express";
  if (/^(🎯\s*)?guided\b/.test(s) || /\bchoose\s+guided\b/.test(s) || /ask me the basics/.test(s))
    return "guided";
  if (
    /^(🔬\s*)?(deep\s*dive|deep)\b/.test(s) ||
    /\bchoose\s+deep\b/.test(s) ||
    /walk me through every detail/.test(s)
  )
    return "deep";
  return null;
}
function formatRoster(
  rows: RosterRow[],
  render: (r: RosterRow, i: number) => string,
  empty: string,
): string {
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
    (r) =>
      `[id=${r.id}] ${truncate(r.name)}${r.role_in_case ? ` — ${truncate(r.role_in_case, 40)}` : ""}`,
    "  (none yet)",
  );
  const documentsList = formatRoster(
    rosters.documents,
    (r) =>
      `[id=${r.id}] #${r.doc_number ?? "?"} ${truncate(r.title)}${r.doc_type ? ` (${truncate(r.doc_type, 30)})` : ""} · ${r.status ?? "draft"}`,
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
  const overrides =
    tweaks.length > 0
      ? `\n\nUSER OVERRIDES (highest priority — follow these even if they conflict with earlier instructions, UNLESS they violate CONTENT RULES above which always win):\n${tweaks.map((t, i) => `${i + 1}. ${t.text}`).join("\n")}`
      : "";
  const planningDepth: PlanningDepth = normalizePlanningDepth(
    (project as { planning_depth?: unknown }).planning_depth,
    playbook.planning_depth.default,
  );
  const prevDepthRaw = (project as { last_seen_planning_depth?: unknown }).last_seen_planning_depth;
  const prevDepth: PlanningDepth | null =
    prevDepthRaw === "express" || prevDepthRaw === "guided" || prevDepthRaw === "deep"
      ? prevDepthRaw
      : null;
  const firstTurnDepthPrompt = isFirstTurn
    ? `\n\nFIRST-TURN NOTE
The planning depth has already been chosen by the user via the **Depth selector** in the Assistant header (current value: "${planningDepth}"). DO NOT ask the user to pick a depth — the selector IS the answer. Do NOT call propose_options for depth. Just open the case per the PLANNING DEPTH block above for "${planningDepth}".`
    : "";
  return `You are the Mystery Studio Assistant — a professional creator of premium, printable Israeli detective / mystery games sold to Israeli audiences.

${renderIdentityBlock(playbook)}

${renderContentRulesBlock(playbook)}

${renderPhaseEnumComment(playbook)}

${renderLanguagesBlock(playbook)}

${renderPlanningDepthBlock(planningDepth, playbook, isFirstTurn ? null : prevDepth)}${firstTurnDepthPrompt}

WORKFLOW — proceed ONE STEP AT A TIME, WAIT FOR APPROVAL before advancing phases. The PLANNING DEPTH block above OVERRIDES the default Phase 1 order — follow that block first.
${renderPhase1OrderSentence(playbook)}
${renderSuspectCountsLine(playbook)}
Phase 2 Summary: English news-style summary of how the case is solved, layered evidence, balanced red herrings, fictional quoted evidence.
SOLUTION SUMMARY REGENERATION RULE — DIFFERENT STORY, SAME APPROVED SETUP:
The solution_summary is the whole mystery story: culprit / central event / motive / method / timeline / clue chain / red herrings / final deduction. When the user says "regenerate", "redo", "try again", "make a different summary/story", or similar for the solution summary, they are NOT asking for a paraphrase. You MUST keep the already-approved Phase 1 details from CURRENT PROJECT STATE (title, subtitle, genre, year, difficulty, player role, case goal, setting, mystery type, selling point, language, and existing suspects unless the user explicitly changes them), but invent a materially different solution story within those constraints. Change at least 5 major story beats from the previous solution_summary: culprit or responsibility structure, motive, method, timeline, primary clue chain, red herrings, and final reveal. Do NOT reuse the same route of events with different wording. Before calling \`set_solution_summary\`, mentally compare against the existing solution_summary in runtime context; if it would feel like "the exact same thing", discard it and generate a bolder alternate story. Then CALL \`set_solution_summary\` with the new text first, and only after the tool succeeds paste the full new summary in chat.
Phase 3 Structure: suspects, clue sequence, red herrings, deduction logic, and the sealed task-envelope plan. Output fits the node canvas. IMPORTANT GAME-FLOW MODEL: Envelopes are SEALED TASK GATES — they do NOT distribute documents in batches. All evidence documents live loose in the box from the very start; the player has access to every document immediately, organized by Doc 0. Envelopes only hold a short task / reveal / instruction the player reads when they reach the matching beat in the case (e.g. "Open envelope 2 once you've narrowed it down to two suspects"). Envelope #0 is the mission briefing (opened first, points the player at Doc 0 and the case goal). The final envelope contains the accusation form / solution reveal. When you plan envelopes you must reason about each envelope's OPENING TRIGGER (the case beat that unlocks it) and its PAYLOAD (task, reveal, or instruction). NARRATION RULE: When you describe an envelope to the user — in chat, in summaries, or in node descriptions — NEVER say it "contains" or "holds" clues / documents / evidence. Only the final envelope physically contains the accusation form. For every other envelope, describe (a) the task the player reads when they open it, and (b) which loose-pile clues the player should ALREADY be holding when they reach that beat (phrase as "relevant clues" or "the player should already have figured out…", never "inside the envelope"). SINGLE-ENVELOPE HELP RULE: When the user asks for help drafting a SPECIFIC envelope ("help me with envelope #N", "draft envelope 0", "fill in the briefing envelope", or any per-slot request originating from the Envelopes panel) — and especially for envelope #0 (the mission briefing) — you MUST in the SAME turn call \`update_envelope\` with the proposed \`label\`, \`task\`, and \`design_instructions\` for that specific slot. Never just chat about it without writing — silent no-ops are a critical failure. If the envelope row does not yet exist for that slot, propose the content and immediately call \`update_envelope\` (the backend creates the row) before asking the user to refine.
Phase 3.5 LOGIC FLOW (MANDATORY GATE before Phase 4):
- Before producing ANY documents, the user MUST generate and approve a Logic Flow on the Canvas.
- The Logic Flow board (clues → deductions → solution + red herrings) is what guarantees the case is solvable, layered, and consistent.
- If \`solution_summary\` is empty OR \`logic_approved_at\` is null, you MUST refuse to call \`add_document\`. Instead, instruct the user (in 2–3 sentences):
    ${renderLogicGateRefusal(playbook)}
- After approval is in place, you may proceed to Phase 4.

SUMMARY APPROVAL — TWO-STEP GATE (summary → flow → approval):
Approving the solution summary and approving the LOGIC FLOW are TWO DISTINCT STEPS. Never collapse them. The user must (1) approve the summary → assistant draws the flow → (2) user reviews the flow on Canvas → user approves the flow → assistant proposes the document set.

STEP 1 — After \`set_solution_summary\` (without mark_approved) succeeds AND \`logic_approved_at\` is still null, you MUST in the SAME assistant turn:
  1. Show the user a ≤3-sentence recap of what's now locked into the summary.
  2. Call \`propose_options\` with EXACTLY these two buttons (label / send identical):
       • "✅ Approve summary & draw the logic flow"
       • "✏️ Let me edit the summary first"
When the user's NEXT message contains "Approve summary" (substring is enough), you MUST:
  1. Immediately call \`generate_logic_flow\` with \`use_existing_summary: true\` (do NOT call \`set_solution_summary\` with mark_approved here — the flow does not exist yet, and mark_approved would be refused by the empty-board guard anyway).
  2. In one short sentence tell the user to open Canvas → Logic Flow to watch the board paint itself live (it usually settles within 2–3 minutes), and that you'll ping them in the bell when it's done so they can review and approve it.
  3. Do NOT call \`propose_document_set\` yet — the flow has not been approved.

STEP 2 — When the Logic Flow has finished drawing (the bell drops a "Logic Flow finished — ready for your approval" notification, OR the user opens that notification, OR the user types something signalling the flow is ready: "the flow is done", "ready to approve", "looks good", "approve the flow", "approve logic", "ok approve", etc.), you MUST in the SAME assistant turn:
  1. Give a 2–3 sentence recap of the flow (number of clue/deduction nodes, red herrings, envelopes wired in).
  2. Call \`propose_options\` with EXACTLY these two buttons (label / send identical):
       • "✅ Approve logic flow & start producing documents"
       • "✏️ Tweak the flow first"
When the user's NEXT message contains "Approve logic flow" (substring is enough), you MUST:
  1. Immediately call \`set_solution_summary\` AGAIN with the SAME summary text and \`mark_approved: true\` — this stamps logic_approved_at on a non-empty board.
  2. Then continue automatically into Phase 4: call \`propose_document_set\` (the Phase 4 PLANNING GATE) so the user moves forward without a second click.
  3. Confirm in one short sentence ("Logic approved — drafting the document set now.") and present the proposed list with the standard 3 propose_options buttons (Approve and build the Final Flow / Just build it / Revise the plan).

Never collapse the two steps into one button. Never tell the user "click Approve logic on the Canvas" if you can offer the in-chat button — the in-chat approval IS the canonical path. The Canvas board is the place to LOOK at the flow before approving it.

SUMMARY-REWRITE RULE — REBUILDING THE LOGIC FLOW IS MANDATORY AFTER ANY SUMMARY REWRITE:
A new solution_summary invalidates the existing Logic Flow because the chain of clues, deductions, red herrings and connecting edges depends directly on the summary. The backend now AUTOMATICALLY does the following the instant \`set_solution_summary\` is called with new text and \`mark_approved\` is not true: (a) clears \`logic_approved_at\`, (b) snaps the project \`phase\` back to \`summary\` so the top progress bar moves back to the Summary step, and (c) DELETES every node + edge on the logic board AND on the final/production map (they were all built from the prior summary). The green "Logic approved" badge disappears, the Case Board Logic Flow becomes empty, and document generation refuses to run again until the flow is rebuilt and re-approved. This is intentional. Whenever you call \`set_solution_summary\` (without \`mark_approved\`) AND the project already had any logic-board canvas nodes (see "Logic flow exists" in the rosters block above), you MUST in the SAME assistant turn:
  1. Tell the user in 1–2 sentences that the summary changed, that the prior Logic Flow board AND the prior approval have been wiped automatically, and that we now need to redraw the flow from the new summary and re-approve it before document generation will run again.
  2. Call \`propose_options\` with EXACTLY these two buttons (label / send identical):
       • "🔁 Rebuild logic flow from new summary (and re-approve)"
       • "Hold off — I'll rebuild later"
  3. Wait for the user's choice.
When the user's NEXT message contains "Rebuild logic flow" (substring match is enough), you MUST immediately call \`generate_logic_flow\` with \`use_existing_summary: true\`, then in one short sentence tell them to open Canvas → Logic Flow to watch it draw itself live (it usually settles within 2-3 minutes), and that you'll ping them when it's done so they can re-approve. Do NOT call \`generate_logic_flow\` more than once per turn.
Never quietly leave the user without rebuild buttons after a summary rewrite — the user's #1 expectation is that summary edits flow through to the board.

TRANSPARENCY RULE — THE CHAT IS THE WORKSHOP (always show the work):
The user works the case in this conversation. Whenever you create, rewrite, or update an artifact via a tool call, you MUST in the SAME assistant turn paste its FULL human-readable text back into the chat as markdown, then explicitly invite the user to discuss or edit it before moving on. Saying "done" / "saved" / "summary updated" without showing the text is a failure — the user shouldn't have to click another tab or button to read what you wrote.

🔴 ABSOLUTE HARD RULE — TOOL CALL FIRST, PROSE SECOND:
The transparency rule does NOT replace the tool call — it COMPLEMENTS it. Writing prose like "## Updated solution summary", "Here is the rewritten summary", or "I've revised the summary to..." WITHOUT first emitting the corresponding tool call (\`set_solution_summary\`, \`propose_document_set\`, \`add_document\`, etc.) IS A HALLUCINATION. The artifact does NOT exist in the database, the Case Board does NOT update, the badges do NOT clear, and the user is being LIED TO. Every time the user asks you to "redo", "regenerate", "rewrite", "update", "fix", or "change" an artifact (the summary, the document list, a document body, a node, etc.), the FIRST thing you emit in that turn MUST be the appropriate tool call with the new content. Only AFTER the tool call succeeds may you paste the full text back as markdown for review. If you find yourself about to type "## Updated solution summary" or "Here is the new summary" and you have NOT yet called \`set_solution_summary\` in this turn, STOP and call the tool first. There are zero exceptions.

Required behaviour by tool:
- \`set_solution_summary\` → CALL THE TOOL FIRST with the full new summary text. Then in the same turn, write a markdown section "## Updated solution summary" containing the FULL summary text (do not truncate or paraphrase), then ask: "Does this match what you had in mind? Any beats you want to adjust?" Pasting the markdown WITHOUT calling \`set_solution_summary\` first means the summary was never saved — that is a critical failure.
- \`propose_document_set\` → write the FULL list as numbered bullets in your prose: "**N. Title** (doc_type, print_size) — purpose. Supports nodes: …" for EVERY entry. Do not summarize as "and 30 more like this". Then call \`propose_options\` with the standard 3 buttons.
- \`add_document\` → for each document created, show a 2–4 sentence content sketch in chat (what the player will read on the page), AND a separate 2–3 sentence "Visual feel:" paragraph describing what the finished prop will LOOK like (paper stock, era, color palette, typography, layout vibe, any photos/stamps/handwriting/inline images). Derive the visual-feel paragraph from \`design_instructions\` and the doc type so it stays consistent with what will actually be produced. Do this BEFORE generation so the user can picture the prop and react.
- \`propose_document_set\` → when listing the proposal, append a single short "Visual feel:" line under each item (paper/era/typography/photo cues) so the user can picture the whole physical box of props before approving. AFTER the numbered document list, you MUST also include a separate section titled "Sealed task envelopes (not counted in document total)" listing every planned envelope (#0 mission briefing, the middle gates, and the final accusation envelope), each with its label, opening trigger, and 1-line task/payload. Pull from the existing envelope roster + \`envelope_settings\` in runtime context; if envelopes have not been planned yet, propose them in this same turn (envelope #0 = mission briefing pointing at Doc 0 + the case goal; the final envelope = accusation form / solution reveal; middle envelopes = trigger-based gates anchored to specific Logic Flow beats). Envelopes are NEVER counted toward \`target_doc_count\` — only loose-pile documents (Doc 0 + every numbered evidence doc) count.
- \`generate_document_assets\` → after the body is written, (1) paste the full final body text in chat inside a markdown block, (2) include the same kind of short "Visual feel:" paragraph describing the produced document's look, (3) ask the user if they want edits OR if it's good to move on.
- AUTO-APPROVAL: When the user reacts to a just-shown document or its image with a positive / move-on signal — examples: "this is good", "looks good", "looks great", "perfect", "approved", "approve", "next", "next one", "move on", "continue", "ok next", "👍", "love it", "yes go on", "ship it", "סבבה", "מאושר", "הבא", "תמשיך" — you MUST call \`approve_document\` for the most recently shown document BEFORE moving on. Then briefly confirm ("Approved — moving to the next document.") and proceed. If the user asked for changes/edits instead, do NOT approve — make the edits first.
- \`update_project\` for \`packaging_notes\` / \`image_prompt_instructions\` / \`video_prompt_instructions\` / \`hint_settings\` / \`envelope_settings\` → echo the new text/values and ask for confirmation.
- \`add_canvas_node\` (clue / deduction / red_herring / solution / document) → state the title and the description/purpose in chat alongside the receipt so the user can see what was actually wired in.
- If the user asks "show me the summary" / "what's the current summary?" / "read me the summary" / "what documents are proposed?" / "show me the list", reply by pasting the FULL stored text from the runtime context (solution_summary or proposed_document_set) — do NOT just say "open the Case Board to see it".

This rule overrides any other instinct to be terse — long pasted artifacts are correct and expected here. The user is your editor, not your audience.

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
TARGET DOCUMENT COUNT (HARD RULE): The number of documents you propose MUST land within ±5 of the project's \`target_doc_count\` (visible in the runtime context block as "Target documents"). Envelopes are NEVER counted toward \`target_doc_count\` — only loose-pile documents count (Doc 0 + every numbered evidence doc). Sealed task envelopes are listed separately under the doc proposal but never inflate or deflate the document count. If \`target_doc_count\` is missing, 0, or below 10, you MUST NOT call \`propose_document_set\` yet. Instead: in this same turn, ask the user how many documents the case should ship with — suggest 30–40 as the standard for an Unsolved-Case-Files-style box (the typical published case has ~35) — and offer \`propose_options\` with three buttons: "30 documents", "35 documents", "40 documents". When the user picks (or types a number), call \`update_project({target_doc_count: N})\` BEFORE calling \`propose_document_set\`. Only then plan the document set, aiming for that count. A 10-document proposal for a case asking for 35 is a failure — do not under-propose.
SUSPECT INTAKE DOCUMENTS (DEFAULT, OVERRIDABLE): For most cases — police procedurals, detective mysteries, missing-person files, espionage briefs, etc. — the document set SHOULD include one "Suspect Intake" / suspect-file document per non-red-herring suspect. Title each one in-language (e.g. "Intake Report — <Suspect Name>" / "תיק חשוד — <שם>") and set \`doc_type\` to "Suspect profile". Each intake doc MUST list the matching suspect's id in \`linked_suspect_ids\` so the UI can pin the suspect's portrait into the document's first inline-image slot as the LOCKED ANCHOR (see ANCHOR PORTRAIT RULE below). Skip suspect intake docs only when the case genre clearly does NOT use suspect line-ups (e.g. an escape-the-room puzzle box, a treasure hunt, a code-breaking-only case) — in those cases mention in your proposal why you're skipping them.
ANCHOR PORTRAIT RULE: Suspect intake docs reuse the suspect's saved \`thumbnail_url\` as the document's first inline-image slot, with \`is_anchor=true\`. The portrait is the visual identity for that suspect across the whole case — every other appearance of that suspect (mugshot board, surveillance still, ID card) MUST use that same anchor portrait so lighting, age, lens and wardrobe palette stay consistent. When the user updates a suspect's portrait, the linked intake doc's anchor slot is auto-synced — do NOT propose regenerating those intake docs unless the user explicitly asks.
HIGH-QUALITY REGEN RULE: When the user says any of "high quality", "in high res", "redo at high quality", "regenerate hi-res", "make it high quality", "regenerate this in high quality", or the Hebrew variants "באיכות גבוהה" / "ברזולוציה גבוהה" / "באיכות הכי גבוהה" — for any image artifact (cover, back cover, suspect portrait, envelope mock-up, hint sheet, inline document image, marketing visual) — you MUST treat that as an explicit instruction to re-run that image's generator with the HIGH quality tier. If a tool you call accepts a \`quality\` argument, ALWAYS pass \`quality: "high"\` for these requests (never "medium" or "low"). If the regeneration is performed in the UI rather than via a tool call, tell the user in 1 short sentence which panel to use AND that they should keep the model picker on its default "High" quality (do NOT downgrade to medium for speed). Always warn briefly that High can take up to ~2 minutes per image.
After \`propose_document_set\` succeeds, present the proposed list as numbered bullets in your prose AND call \`propose_options\` with three buttons (in this exact order):
  1) "Approve and build the Final Flow" → on click, call \`create_final_documents_map\`.
  2) "Just build it" → on click, also call \`create_final_documents_map\` immediately (this is the user's "skip review" path; it bypasses the pause).
  3) "Revise the plan" → wait for the user's edit instructions, then call \`propose_document_set\` again with the revised list.
The DEFAULT behaviour is PAUSE: do not call \`create_final_documents_map\` until the user clicks Approve or Just-build-it. The "Just build it" button exists explicitly so the user can opt out of the pause when they're confident.
Once the Final Flow is built, the map contains one \`document\` node per planned game document (including Doc 0), each marked \`ungenerated\` until generated. Then proceed to per-document generation.
Doc 0 hard rule: before creating or generating Doc 0, use the Final Flow as the source of truth. When calling \`add_document\` for Doc 0, set doc_number=0, doc_type="contents checklist", and write hebrew_content as a non-spoiler MASTER INVENTORY: list every document in the box (grouped by topic / document type / investigative area — NOT by envelope) and then list each sealed task envelope as a separate item with its trigger condition (when the player should open it). The player has access to all documents from the start; envelopes are opened only at the matching case beat.
If the user asks to see/show/build the final flow, final board, production map, document map, or mapped final documents, and Logic Flow is already approved but no proposal exists yet, call \`propose_document_set\` first (do NOT skip the planning gate). For older existing cases that already have a Final board but no proposal, you may call \`create_final_documents_map\` directly to refresh from existing data.
The Final Flow is a major production artifact: it must include the approved logic nodes, suspects, sealed task envelopes (drawn as gates pinned to the beat that unlocks each one), planned document nodes, and connecting lines between them. When the Final Flow already exists, acknowledge it before document generation: "I see the Final Flow is created; I'll generate documents from those mapped nodes."
If the user asks you to generate the Logic Flow from chat, call \`generate_logic_flow\`. The tool returns immediately and the regeneration runs in the background. With the latest streaming pipeline the canvas paints itself LIVE — clues, deductions, envelopes, hints and the connecting lines appear one-by-one as the AI writes them. Tell the user to open Canvas → Logic Flow now and watch it draw itself in real time (it usually finishes within 2-3 minutes); once it's settled, ask them to approve the new board. Never claim the flow is already regenerated in the same turn — describe it as STARTED / DRAWING. The system will drop a "Logic Flow finished — ready for your approval" notification in the bell when the build completes; if the user opens that notification or otherwise tells you the flow is done, immediately give them a 2–3 sentence recap and call \`propose_options\` with the standard "✅ Approve logic & start producing documents" / "✏️ Let me edit the summary first" buttons.

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
8. If the user asks to install/add a Claude Skill from chat and there is no attached installable package, call explain_claude_skill_install. Claude can automatically choose among enabled installed skills passed to it, but the app must manage installation.

BATCH RULES (CRITICAL — applies to drafting AND generating documents):
A. **Drafting many docs in one turn** — when the user asks to draft a numbered range ("docs 7-20", "the next 10"), "all of them", "the rest", or more than ~3 documents at once, you MUST call \`add_documents\` (plural) ONCE with every document spec in the array. NEVER loop \`add_document\` for batch requests — the per-turn round budget will silently truncate it and most rows will never be written. After \`add_documents\` returns, list every entry from \`created\` as a numbered roster in your prose so the user sees what was written. Single-doc / "auto" / "ask" workflows still use \`add_document\` per-doc so the per-doc preview rules apply.
B. **Generating more than one doc** — when the user asks to generate more than one doc, "all docs", "the rest", a numbered range, or "everything", you MUST call \`bulk_generate_documents\` ONCE. NEVER loop \`generate_document_assets\` for batch requests. The bulk tool returns immediately with a queued count; tell the user to watch the Documents tab for live progress, and explicitly say "QUEUED" / "STARTED", never "DONE" / "FINISHED" in the same turn. Single-doc generation still uses \`generate_document_assets\`.
C. **Doc 0 stays per-doc** — Doc 0 (contents inventory) requires special handling and MUST go through \`add_document\`, never \`add_documents\`.`;
})()}

${
  claudeSkills.length > 0
    ? `AVAILABLE CLAUDE SKILLS FOR THIS SURFACE
${renderClaudeSkillCatalog(claudeSkills)}
Claude Skills are SKILL.md-based packages. Their descriptions tell Claude when to use them; full instructions/supporting files are only available when the Skill is invoked by Claude's runtime.`
    : ""
}
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
- generate_logic_flow: KICKS OFF Canvas Logic Flow regeneration in the background. The board paints itself LIVE on Canvas → Logic Flow as the AI streams nodes/edges in (typically settles within 2-3 minutes). Always describe the result as STARTED / DRAWING, never as already done; tell the user to open Canvas → Logic Flow to watch it being built and approve once it's settled. Do not call this tool more than once per turn.
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
Target documents: ${(() => {
    const n = Number((project as { target_doc_count?: unknown }).target_doc_count ?? 0);
    return n >= 10
      ? n
      : `NOT SET (currently ${n || "—"}) — you MUST ask the user before calling propose_document_set; suggest 30/35/40 with propose_options, then call update_project({target_doc_count: N}) before proposing`;
  })()}
Packaging notes: ${truncate(project.packaging_notes, 120)}
Image prompt style: ${truncate(project.image_prompt_instructions, 120)}
Video prompt style: ${truncate(project.video_prompt_instructions, 120)}
Hint settings: ${(() => {
    const v = project.hint_settings as Record<string, unknown> | null;
    if (!v || typeof v !== "object") return "—";
    const keys = Object.keys(v);
    return keys.length === 0
      ? "(empty)"
      : `(${keys.length} keys: ${truncate(keys.join(", "), 80)})`;
  })()}
Envelope settings: ${(() => {
    const v = project.envelope_settings as Record<string, unknown> | null;
    if (!v || typeof v !== "object") return "—";
    const keys = Object.keys(v);
    return keys.length === 0
      ? "(empty)"
      : `(${keys.length} keys: ${truncate(keys.join(", "), 80)})`;
  })()}
${suspectCount > 0 ? `Existing suspects (${suspectCount}):\n${suspectsList}` : ""}
${docCount > 0 ? `Existing documents (${docCount}):\n${documentsList}` : ""}
${rosters.envelopes.length > 0 ? `Existing envelopes (${rosters.envelopes.length}):\n${envelopesList}` : ""}
${rosters.hints.length > 0 ? `Existing hints (${rosters.hints.length}):\n${hintsList}` : ""}
${rosters.canvas_nodes.length > 0 ? `Existing canvas nodes (${rosters.canvas_nodes.length}):\n${nodesList}` : ""}
Logic flow approved: ${project.logic_approved_at ? "YES (" + project.logic_approved_at + ")" : "NO — must be approved on the Canvas before generating documents"}
Canvas edges: ${rosters.canvas_edges_count ?? 0}${rosters.logic_dirty_since_approval ? " — ⚠️ LOGIC GRAPH HAS BEEN EDITED SINCE APPROVAL: solution_summary and any existing Final Flow may be stale. Offer the user the post-approval follow-up buttons (see POST-APPROVAL EDIT RULE)." : ""}
Logic flow exists: ${rosters.canvas_nodes.some((n) => n.board === "logic") ? `YES (${rosters.canvas_nodes.filter((n) => n.board === "logic").length} logic-board nodes — IF YOU REWRITE solution_summary YOU MUST OFFER TO REBUILD THE FLOW, see SUMMARY-REWRITE RULE)` : "NO"}
Final Flow mapped: ${rosters.canvas_nodes.some((n) => n.board === "final" && n.node_type === "document") ? `YES (${rosters.canvas_nodes.filter((n) => n.board === "final").length} final-board nodes)` : "NO — ask to create the Final Flow before final documents"}
Solution summary set: ${project.solution_summary ? "YES" : "NO"}
${project.solution_summary ? `\n--- BEGIN solution_summary (paste this back verbatim if the user asks "what's the summary") ---\n${project.solution_summary}\n--- END solution_summary ---\n` : ""}
${(() => {
  const set = (project as { proposed_document_set?: unknown }).proposed_document_set;
  if (!Array.isArray(set) || set.length === 0) return "";
  const status =
    (project as { proposed_document_set_status?: string }).proposed_document_set_status ??
    "proposed";
  const lines = (set as Array<Record<string, unknown>>)
    .map((d, i) => {
      const num = (d.doc_number as number | undefined) ?? i + 1;
      const title = String(d.title ?? "(untitled)");
      const dt = String(d.doc_type ?? "");
      const ps = String(d.print_size ?? "");
      const purpose = String(d.purpose ?? "");
      const meta = [dt, ps].filter(Boolean).join(", ");
      return `  ${num}. ${title}${meta ? ` (${meta})` : ""} — ${purpose}`;
    })
    .join("\n");
  return `Proposed document set (status: ${status}, count: ${set.length} — paste this back if the user asks "show me the documents" or "what was proposed"):\n${lines}\n`;
})()}
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
  if (userEdited.length === 0)
    return "USER-EDITED FIELDS: (none — every populated field was set by the assistant)";
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
  const itemRe = /^\s*(?:[-*•]\s*)?\d+[\.\)]\s+(?:\*\*)?(.+?)(?:\*\*)?\s*$/;
  const items: string[] = [];
  for (const line of prose.split("\n")) {
    const m = itemRe.exec(line);
    if (m) items.push(m[1].replace(/\*\*/g, "").trim().toLowerCase());
  }
  if (items.length === 0) return true; // no numbered list in prose → can't check
  const haystack = items.join(" \n ");
  return options.some((o) => o?.label && haystack.includes(o.label.trim().toLowerCase()));
}

function synthesizeOptionsFromProse(
  text: string,
): { options: Array<{ label: string; send: string }>; question: string | null } | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  // Heuristic gate 1: the message must "feel" like a question or pick-one prompt.
  // English keywords + Hebrew equivalents (בחר/בחרי/בחרו = pick, איזה/איזו = which).
  const looksLikeQuestion =
    /\?\s*$/.test(trimmed) ||
    /\b(pick|choose|select|which|prefer|approve|confirm|reply|click|option)\b/i.test(trimmed) ||
    /(בחר|בחרי|בחרו|איזה|איזו|תבחר|מעדיף|מעדיפה|לאשר)/.test(trimmed);
  if (!looksLikeQuestion) return null;

  // Heuristic gate 2: scan the WHOLE message line-by-line for a contiguous
  // run of numbered items (1, 2, 3, …). The list may sit anywhere — top,
  // middle (followed by a "Pick one." closer), or bottom.
  const lines = trimmed.split("\n");
  const itemLineRegex = /^\s*(?:[-*•]\s*)?(\d+)[\.\)]\s+(?:\*\*)?(.+?)(?:\*\*)?\s*$/;
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
    const cleaned = s
      .replace(/\*\*/g, "")
      .replace(/\s+—\s+.*$/, "")
      .replace(/\s*\(.*\)\s*$/, "")
      .trim();
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
      description:
        "Update project metadata. Covers Case Identity (title, subtitle, phase, mystery_type, genre, year, difficulty, game_language, player_role, case_goal, setting, selling_point, target_doc_count) AND case-level briefs (packaging_notes, image_prompt_instructions, video_prompt_instructions, hint_settings, envelope_settings). Pass ONLY the fields that changed — undefined keys are ignored. For hint_settings/envelope_settings, pass the FULL object you want stored (it overwrites, no shallow merge).",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          subtitle: { type: "string" },
          phase: {
            type: "string",
            enum: [
              "setup",
              "summary",
              "structure",
              "documents",
              "envelopes",
              "hints",
              "packaging",
              "done",
            ],
          },
          mystery_type: { type: "string" },
          genre: { type: "string" },
          year: { type: "number" },
          difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
          game_language: {
            type: "string",
            description:
              "Per-case language for final in-game content. Use one of the playbook language options when possible.",
          },
          player_role: { type: "string" },
          case_goal: { type: "string" },
          setting: { type: "string" },
          selling_point: { type: "string" },
          target_doc_count: { type: "number" },
          packaging_notes: {
            type: "string",
            description: "Phase 7 packaging brief — physical box / print / fulfilment notes.",
          },
          image_prompt_instructions: {
            type: "string",
            description: "Per-project visual style guide injected into every image-prompt call.",
          },
          video_prompt_instructions: {
            type: "string",
            description: "Per-project style guide for video prompts.",
          },
          hint_settings: {
            type: "object",
            description:
              "Stage/level hint configuration object. Replaces the existing value (no shallow merge).",
          },
          envelope_settings: {
            type: "object",
            description:
              "Envelope numbering & defaults object. Replaces the existing value (no shallow merge).",
          },
          planning_depth: {
            type: "string",
            enum: ["express", "guided", "deep"],
            description:
              "How thoroughly the assistant should plan this case: 'express' = ask only the title and auto-fill the rest; 'guided' = basics only; 'deep' = walk through every detail. Set this when the user picks a depth on the first turn or asks to switch later.",
          },
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
        "Save the full end-to-end case solution summary to the project. Call this AS SOON as the user approves the Phase 2 summary so it appears on the Case Board's Solution-summary button. If the user asks to regenerate/redo the summary, keep the approved Phase 1 setup details but create a materially different mystery story — not a paraphrase — then call this tool with that new story. Pass mark_approved=true ONLY if the user has explicitly approved the logic flow itself (not just the narrative).",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description:
              "Full multi-paragraph solution summary (English or Hebrew). 3–8 paragraphs covering setup → clue chain → red herrings → deduction → reveal. For regeneration, it must be materially different from the prior saved summary while preserving approved Phase 1 constraints.",
          },
          mark_approved: {
            type: "boolean",
            description:
              "Set to true to also stamp logic_approved_at = now (unlocks document generation). Default false.",
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
          envelope_number: {
            type: "number",
            description:
              "DEPRECATED for distribution. Leave null in nearly all cases. All documents are in the box from the start. Set this ONLY if the user explicitly wants this document physically tucked inside a sealed task envelope (rare).",
          },
          final_node_id: {
            type: "string",
            description: "Optional Final board document-node id this row is being created from.",
          },
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
        "Phase 4 PLANNING GATE — call this AFTER Logic Flow approval and BEFORE create_final_documents_map. You reason through the entire approved Logic Flow and propose the exact list of game documents needed (no templates, no padding). Each entry: a player-facing title, a format-style hint (doc_type — interrogation transcript, autopsy report, letter, photograph, receipt, etc.), the SPECIFIC clue/purpose this document delivers, and which Logic Flow node ids it supports. Documents are NOT distributed by envelope — every document is in the box from the start; do not assign envelope_number unless the user explicitly wants a doc physically inside a task envelope (rare). Doc 0 is added automatically by the playbook — DO NOT include it. **HARD RULE: the count of `documents` entries MUST be within ±5 of the project's `target_doc_count`. If `target_doc_count` is missing, 0, or below 10, DO NOT call this tool — first ask the user what count they want (suggest 30/35/40), call `update_project({target_doc_count: N})`, then call this tool with the right count.** **DIVERSITY HARD RULE (see DOCUMENT-SET DIVERSITY block in the catalogs section): no doc_type family may exceed ~20% of the set (especially: do NOT spam REPORTs), hit ≥12 distinct doc_types, ≥4 distinct print_sizes, ≥25% unusual/creative-prop items, ≥15% handwritten/hand-made items, and pick visibly different paper stocks/colors per document from the paper_palette. Append the paper/color choice in parentheses on every proposal line (e.g. `(yellow legal pad)`, `(pink carbon copy)`, `(blueprint cyan)`). Self-audit family/size/unusual/handwritten/paper counts before calling — rebalance and retry rather than ship a monoculture set.** After calling this tool, follow the TRANSPARENCY RULE: present every entry as a numbered list in your prose (`**N. Title** (doc_type, print_size, paper) — purpose. Supports nodes: …`) and ask the user to approve, just-build-it, or revise (use propose_options).",
      parameters: {
        type: "object",
        properties: {
          documents: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                doc_number: {
                  type: "number",
                  description: "Optional. Leave blank to auto-number from 1 upward.",
                },
                title: { type: "string" },
                doc_type: {
                  type: "string",
                  description: "Format / visual style hint only (NOT a content template).",
                },
                print_size: {
                  type: "string",
                  description: "e.g. A4, A5, photo, ticket-stub, etc.",
                },
                envelope_number: {
                  type: "number",
                  description:
                    "DEPRECATED for distribution. Leave blank/null. Documents are not gated by envelopes.",
                },
                purpose: {
                  type: "string",
                  description:
                    "The specific clue / role this document delivers in THIS case. Reason from the Logic Flow — not generic.",
                },
                linked_logic_node_ids: {
                  type: "array",
                  items: { type: "string" },
                  description: "Canvas Logic Flow node ids this document supports.",
                },
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
      description:
        "Build the Final board production map from the approved proposed_document_set (preferred) — falls back to logic-flow padding only when no proposal exists. Call this AFTER propose_document_set has been approved by the user (or after the user clicked 'Just build it' to bypass review).",
      parameters: {
        type: "object",
        properties: {
          replace: {
            type: "boolean",
            description: "Default true. Replace existing unlinked Final-board document nodes.",
          },
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
      description:
        "Generate or replace the Canvas Logic Flow board from the case brief/approved summary. The user must still review and approve it before final document generation.",
      parameters: {
        type: "object",
        properties: {
          use_existing_summary: {
            type: "boolean",
            description: "Use the saved solution_summary when present. Default true.",
          },
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
      description:
        "Add a node to the logic canvas. CRITICAL: when the node is a clue, deduction, contradiction, red_herring, document, or solution and the project already has other nodes, you MUST in the SAME turn also call add_canvas_edge at least once to wire this node into the existing graph (otherwise it floats disconnected and breaks the Logic Flow). If logic_approved_at is set, you must also follow the POST-APPROVAL EDIT RULE.",
      parameters: {
        type: "object",
        properties: {
          node_type: {
            type: "string",
            enum: [
              "clue",
              "suspect",
              "deduction",
              "contradiction",
              "red_herring",
              "envelope",
              "solution",
              "document",
              "hint",
              "note",
            ],
          },
          title: { type: "string" },
          description: { type: "string" },
          color: { type: "string" },
          board: {
            type: "string",
            enum: ["logic", "final"],
            description:
              "Defaults to 'logic'. Use 'final' only when explicitly editing the production map.",
          },
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
      description:
        "Connect two existing canvas nodes with a directional edge (source → target). Use immediately after add_canvas_node to wire the new node into the graph, or any time the user asks you to link / connect / draw a line between nodes. The label is optional but strongly recommended for logic clarity (e.g. 'leads to', 'contradicts', 'supports', 'reveals').",
      parameters: {
        type: "object",
        properties: {
          source_id: {
            type: "string",
            description:
              "Canvas node id the edge starts from (from the Existing canvas nodes roster).",
          },
          target_id: { type: "string", description: "Canvas node id the edge points to." },
          label: {
            type: "string",
            description:
              "Optional short label shown on the edge (e.g. 'reveals', 'contradicts', 'supports').",
          },
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
            description:
              "Optional one-line restatement of the question being asked (shown above the buttons).",
          },
          options: {
            type: "array",
            minItems: 2,
            maxItems: 6,
            items: {
              type: "object",
              properties: {
                label: {
                  type: "string",
                  description: "Short button text the user sees (under ~60 chars).",
                },
                send: {
                  type: "string",
                  description: "The message text sent when clicked. Defaults to label if omitted.",
                },
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
          document_id: {
            type: "string",
            description: "ID returned by the most recent add_document call.",
          },
          mode: {
            type: "string",
            enum: ["text", "image", "document", "both"],
            description: "Which assets to generate. Default 'both'.",
          },
          document_format: {
            type: "string",
            enum: ["pdf", "docx", "pptx", "xlsx"],
            description: "Document file format when mode is document/both. Default pdf.",
          },
        },
        required: ["document_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_documents",
      description:
        "BATCH version of add_document — create MANY document rows in a single tool call. USE THIS (not a loop of add_document) whenever the user asks to draft a range ('docs 7-20'), 'all of them', 'the rest', or more than ~3 documents at once. Same per-item shape as add_document. Server-side gated identically: refuses unless the Logic Flow is approved AND the Final Flow exists. Returns { ok, created: [{id,title,doc_number}], failed: [{title,reason}] }. After it returns, list every created doc as a numbered roster in your prose.",
      parameters: {
        type: "object",
        properties: {
          documents: {
            type: "array",
            minItems: 1,
            maxItems: 60,
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                doc_type: { type: "string" },
                doc_number: { type: "number" },
                print_size: { type: "string" },
                design_instructions: { type: "string" },
                hebrew_content: { type: "string" },
                envelope_number: {
                  type: "number",
                  description:
                    "DEPRECATED for distribution. Leave null in nearly all cases. Set ONLY if the user explicitly wants this doc physically inside a sealed task envelope.",
                },
                final_node_id: {
                  type: "string",
                  description: "Optional Final board document-node id this row is created from.",
                },
              },
              required: ["title"],
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
      name: "bulk_generate_documents",
      description:
        "BATCH version of generate_document_assets — kick off generation for MANY existing document rows as a single background job. USE THIS (not a loop of generate_document_assets) whenever the user asks to generate more than 1 doc, 'all docs', 'the rest', a numbered range, or 'everything'. Returns immediately with a job receipt; the Documents tab shows live progress. Tell the user to watch the Documents tab — do NOT claim docs are finished, only that generation is QUEUED/STARTED.",
      parameters: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: ["all_remaining", "from_doc_number", "ids"],
            description:
              "'all_remaining' = every non-final doc (skips Doc 0). 'from_doc_number' = doc_number >= from_doc_number, optionally <= until_doc_number. 'ids' = exact list in document_ids.",
          },
          mode: {
            type: "string",
            enum: ["draft", "image", "document", "both", "image_to_pdf"],
            description:
              "'draft' = body text only. 'image' = visual prop only. 'document' = PDF/DOCX/etc only. 'both' = image + document. 'image_to_pdf' = wrap each existing image into a 1-page PDF.",
          },
          document_format: {
            type: "string",
            enum: ["pdf", "docx", "pptx", "xlsx"],
            description: "File format when mode is document/both. Default pdf.",
          },
          from_doc_number: {
            type: "number",
            description: "Required when scope='from_doc_number'. Inclusive lower bound.",
          },
          until_doc_number: {
            type: "number",
            description: "Optional upper bound when scope='from_doc_number'.",
          },
          document_ids: {
            type: "array",
            items: { type: "string" },
            description: "Required when scope='ids'. Document ids to generate.",
          },
        },
        required: ["scope", "mode"],
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
          requested_skill: {
            type: "string",
            description: "Short name/description of the skill the user asked for.",
          },
          intended_use: {
            type: "string",
            description:
              "Where the skill should be used, e.g. documents, marketing, logic analysis.",
          },
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
          envelope_number: {
            type: "number",
            description:
              "DEPRECATED for distribution. Almost always leave null. Documents are in the box from the start; only set if the user explicitly wants this doc physically inside a sealed task envelope.",
          },
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
      name: "approve_document",
      description:
        "Mark a document as APPROVED / final. Call this whenever the user gives a positive sign-off on a document or its image (examples: 'this is good', 'looks great', 'perfect', 'approved', 'next one', 'move on', 'continue', 'ok next', '👍', 'love it', or explicit 'approve doc N'). Sets documents.status = 'final' AND turns the matching Final Flow node GREEN. After calling this, briefly confirm in chat ('Approved — moving to the next document.') and proceed to the next planned doc. Do NOT call this if the user asked for changes/edits — only on explicit positive sign-off. The receipt returns the document id and title.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description:
              "Document id from the Existing documents roster (the doc the user just approved).",
          },
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
          task: {
            type: "string",
            description:
              "Short, bold, in-language instruction the player reads when they open this envelope at the right moment. Never the next batch of evidence.",
          },
          notes: {
            type: "string",
            description:
              "Start with 'Opening trigger: <when to open>'. Then any internal design notes.",
          },
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
          stage: {
            type: "number",
            description:
              "Stage number (1-based). Each stage represents one moment the player gets stuck.",
          },
          level: {
            type: "number",
            description: "Hint level within the stage (1=vague, 2=helpful, 3=reveals the task).",
          },
          text: {
            type: "string",
            description: "Hebrew hint text, RTL, grammatical, one or two short sentences.",
          },
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
            description:
              "Hint rungs for this stage, ordered from vague (level 1) to reveal (last level). Each item is the Hebrew hint text for that rung.",
            items: { type: "string" },
          },
          context: {
            type: "string",
            description:
              "Optional one-line description of which clue/deduction/task this stage hints toward. Helps the user audit later.",
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
          node_type: {
            type: "string",
            enum: [
              "clue",
              "suspect",
              "deduction",
              "contradiction",
              "red_herring",
              "envelope",
              "solution",
              "document",
              "hint",
              "note",
            ],
          },
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
          title: {
            type: "string",
            description: "Short headline shown in the bell panel (under ~80 chars).",
          },
          body: { type: "string", description: "Optional 1–2 sentence detail." },
          starter_prompt: {
            type: "string",
            description:
              "Optional message text sent to you when the user clicks 'Open in Assistant'.",
          },
          kind: {
            type: "string",
            description:
              "Short slug for grouping (e.g. 'reminder', 'follow_up', 'planning'). Defaults to 'general'.",
          },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_document_inline_images",
      description:
        "Plan a set of EMBEDDED images that live INSIDE a document (e.g. 4 drone aerials at the bottom of a surveillance report, 3 evidence photos in a forensic file, 1 mugshot in a dossier). Use this whenever the document's realism requires actual visual evidence as part of the prop itself — NOT for cover art or decorative imagery. Each entry creates one slot the user can later generate independently. Mark exactly ONE slot as is_anchor=true per group_key — that anchor becomes the visual reference image; the other slots in the same group are generated as VARIATIONS of the anchor (same camera, same lighting, same drone, just different angle/framing). Default to the smallest believable count — 4 drone shots, 3 evidence photos, 1 mugshot. Never inflate counts to pad the doc. Set group_key when multiple images must look visually consistent (drone-feed, evidence-set, scene-photos). Set layout to control how the renderer arranges them at the bottom of the document.",
      parameters: {
        type: "object",
        properties: {
          document_id: {
            type: "string",
            description:
              "Existing document id (from the Existing documents roster, or returned by add_document).",
          },
          layout: {
            type: "string",
            enum: ["bottom-grid-2col", "bottom-grid-3col", "inline-after-text", "gallery"],
            description:
              "How the renderer arranges the images at the bottom of the document. Defaults to 'bottom-grid-2col'.",
          },
          caption: {
            type: "string",
            description:
              "Optional shared caption rendered above the image grid (e.g. 'Aerial reconnaissance — 14:23, June 9.').",
          },
          group_key: {
            type: "string",
            description:
              "Optional shared key linking siblings for visual consistency (e.g. 'drone-feed', 'evidence-set'). All images in the same group inherit the anchor's look.",
          },
          images: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: {
              type: "object",
              properties: {
                slot_label: {
                  type: "string",
                  description:
                    "Short editable label shown above the slot in the editor (e.g. 'Drone shot 1 — wide').",
                },
                prompt: {
                  type: "string",
                  description:
                    "Per-image prompt brief. For the anchor: a strong opinionated reference shot. For children: a SHORT description of how this slot's framing/angle differs from the anchor (the consistency lock is added automatically).",
                },
                is_anchor: {
                  type: "boolean",
                  description:
                    "True for exactly ONE image per group_key — the visual reference all siblings inherit from. The first image in the array is auto-anchored if none is marked.",
                },
              },
              required: ["slot_label"],
              additionalProperties: false,
            },
          },
        },
        required: ["document_id", "images"],
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
    const props = (
      cloned.function.parameters as unknown as { properties?: Record<string, { enum?: string[] }> }
    ).properties;
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
    const withMessage = (payload: Record<string, unknown>) =>
      messageId ? { ...payload, created_by_message_id: messageId } : payload;
    if (
      !messageId &&
      [
        "add_document",
        "update_document",
        "add_suspect",
        "update_suspect",
        "add_canvas_node",
        "update_canvas_node",
        "add_canvas_edge",
      ].includes(name)
    ) {
      return {
        ok: false,
        message:
          "Assistant message could not be saved, so I did not create linked project rows. Please retry this step.",
      };
    }
    // Helper: when the project has already been logic-approved, any edit to the
    // logic graph (add/update node, add edge) means the saved solution_summary
    // and any existing Final Flow are now potentially stale. We attach a
    // `requires_followup` payload to the receipt so the assistant must surface
    // it as quick-reply buttons in the same turn (see POST-APPROVAL EDIT RULE).
    const buildPostApprovalFollowup = async (
      changeKind: string,
    ): Promise<
      | {
          requires_followup: {
            reason: string;
            stale: string[];
            offer: Array<{ key: string; label: string; send: string }>;
          };
        }
      | Record<string, never>
    > => {
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
      const origins = { ...((current?.assistant_origins as Record<string, string>) ?? {}) };
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
        .select("assistant_origins, solution_summary, logic_approved_at")
        .eq("id", projectId)
        .single();
      const origins = { ...((current?.assistant_origins as Record<string, string>) ?? {}) };
      if (messageId) origins.solution_summary = messageId;
      const patch: Record<string, unknown> = {
        solution_summary: summary,
        assistant_origins: origins,
      };
      // Approval is bound to the EXACT summary text it approved. Any rewrite
      // (without an explicit re-approval in the same call) invalidates the
      // prior approval so the Case Board no longer shows a stale green badge.
      const previousSummary = String(current?.solution_summary ?? "").trim();
      const wasApproved = !!current?.logic_approved_at;
      const summaryChanged = previousSummary !== summary;
      let approvalCleared = false;
      let logicWiped = false;
      if (markApproved) {
        // Refuse to stamp approval against an empty logic board — there's
        // literally nothing to approve. The assistant must generate the flow
        // first, then re-issue mark_approved on a non-empty board.
        const { count: existingLogicNodes } = await supa
          .from("canvas_nodes")
          .select("id", { count: "exact", head: true })
          .eq("project_id", projectId)
          .eq("board", "logic");
        if ((existingLogicNodes ?? 0) === 0) {
          return {
            ok: false,
            message:
              "Cannot approve: the Logic Flow board is empty. Call generate_logic_flow first to draw the flow, wait for it to settle, then re-issue set_solution_summary with mark_approved=true.",
          };
        }
        patch.logic_approved_at = new Date().toISOString();
        // Re-approval moves the user back into the production phase.
        patch.phase = "production";
      } else if (summaryChanged) {
        // Any new/edited summary text invalidates the existing flow & approval.
        // Snap the project state back to "summary" so the top progress bar
        // reflects that we're effectively redoing this step.
        if (wasApproved) {
          patch.logic_approved_at = null;
          approvalCleared = true;
        }
        patch.phase = "summary";

        // Wipe the stale Logic Flow board (and the Final/production map, which
        // is downstream of it). The user can rebuild from the new summary.
        const { count: logicNodeCount } = await supa
          .from("canvas_nodes")
          .select("id", { count: "exact", head: true })
          .eq("project_id", projectId)
          .eq("board", "logic");
        if ((logicNodeCount ?? 0) > 0) {
          await supa.from("canvas_edges").delete().eq("project_id", projectId).eq("board", "logic");
          await supa.from("canvas_nodes").delete().eq("project_id", projectId).eq("board", "logic");
          await supa.from("canvas_edges").delete().eq("project_id", projectId).eq("board", "final");
          await supa.from("canvas_nodes").delete().eq("project_id", projectId).eq("board", "final");
          logicWiped = true;
        }
      }
      const { error } = await supa.from("projects").update(patch).eq("id", projectId);
      if (error) throw error;
      const wordCount = summary.split(/\s+/).filter(Boolean).length;
      const noteParts: string[] = [];
      if (approvalCleared) noteParts.push("the previous logic approval was cleared");
      if (logicWiped)
        noteParts.push(
          "the old Logic Flow board was wiped (it was built from the previous summary)",
        );
      const changeNote = noteParts.length
        ? ` ⚠️ Because the summary changed, ${noteParts.join(" and ")}. Offer the user the rebuild buttons (SUMMARY-REWRITE RULE) so they can regenerate and re-approve.`
        : "";

      // 🛡️ SAFETY NET: when a fresh summary is saved (without mark_approved)
      // and the logic board is empty + not approved, AUTO-START the logic
      // flow generation in the background. The Express playbook tells the
      // model to call `generate_logic_flow` next, but in practice it often
      // forgets and just writes prose like "I've started drawing the flow…"
      // — leaving the user staring at an empty Canvas. This server-side
      // auto-trigger guarantees the flow build actually starts.
      let autoStartedLogicFlow = false;
      if (!markApproved) {
        const { count: postLogicNodes } = await supa
          .from("canvas_nodes")
          .select("id", { count: "exact", head: true })
          .eq("project_id", projectId)
          .eq("board", "logic");
        const stillUnapproved = !patch.logic_approved_at;
        if ((postLogicNodes ?? 0) === 0 && stillUnapproved) {
          const fireAndForget = fetch(`${SUPABASE_URL}/functions/v1/generate-logic-flow`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({ projectId, replace: true, useExistingSummary: true }),
          }).catch((err) => {
            console.error("[assistant-chat] safety-net generate-logic-flow failed", err);
          });
          const runtime = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } })
            .EdgeRuntime;
          if (runtime?.waitUntil) runtime.waitUntil(fireAndForget);
          // Stamp the project as "building" immediately so the UI indicator
          // lights up before the first node streams in.
          await supa
            .from("projects")
            .update({ logic_flow_building_at: new Date().toISOString() })
            .eq("id", projectId);
          autoStartedLogicFlow = true;
        }
      }
      const autoNote = autoStartedLogicFlow
        ? " 🛠️ Logic Flow generation has been STARTED automatically in the background — tell the user to open Canvas → Logic Flow to watch it paint itself live (settles in 2–3 min). Do NOT call generate_logic_flow again this turn."
        : "";

      return {
        ok: true,
        message: markApproved
          ? `Solution summary saved & logic approved (${wordCount} words). Visible on Case Board.`
          : `Solution summary saved (${wordCount} words). Visible on Case Board's Solution-summary button.${changeNote}${autoNote}`,
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
          message:
            "Cannot create final documents yet — the Final Flow is not mapped. Ask the user whether to generate the Final Flow now; if they say yes, call create_final_documents_map first, then create documents from those nodes.",
        };
      }
      const finalNodeId = typeof args.final_node_id === "string" ? args.final_node_id : null;
      const insertArgs = { ...args };
      delete insertArgs.final_node_id;
      const docNumber = insertArgs.doc_number ?? Math.floor(100 + Math.random() * 900);
      const linkedNodeIds = finalNodeId ? [finalNodeId] : undefined;
      const isDoc0 =
        Number(docNumber) === 0 ||
        /\bdoc\s*0\b|document\s*0|contents|inventory|תוכן עניינים|רשימת תכולה/i.test(
          String(insertArgs.title ?? ""),
        ) ||
        String(insertArgs.doc_type ?? "").toLowerCase() === "contents checklist";
      if (isDoc0) {
        const doc0Def =
          playbook.universal_documents.docs.find((doc) => doc.key === "doc0_contents") ??
          PLAYBOOK_DEFAULTS.universal_documents.docs[0];
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
          .map(
            (node: any) =>
              `- #${node.data?.docNumber ?? "?"} ${node.title} (${node.data?.docType ?? "document"}, ${node.data?.printSize ?? "A4"})${node.data?.envelopeNumber ? ` — envelope ${node.data.envelopeNumber}` : ""}`,
          );
        if (inventoryLines.length > 0) {
          insertArgs.hebrew_content = [
            String(insertArgs.hebrew_content ?? "").trim(),
            `\n\nAuthoritative Final Flow inventory source for Doc 0:\n- Doc 0 — ${insertArgs.title}\n${inventoryLines.join("\n")}`,
          ]
            .filter(Boolean)
            .join("\n");
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
            .update(
              withMessage({
                ...insertArgs,
                doc_number: 0,
                doc_type: insertArgs.doc_type ?? "contents checklist",
                ...(linkedNodeIds ? { linked_node_ids: linkedNodeIds } : {}),
              }),
            )
            .eq("id", existingDoc0.id);
          if (finalNodeId)
            await supa
              .from("canvas_nodes")
              .update({
                data: { documentId: existingDoc0.id, generationStatus: "draft row created" },
              })
              .eq("id", finalNodeId)
              .eq("project_id", projectId);
          return {
            ok: true,
            message: `Doc 0 updated: ${insertArgs.title ?? existingDoc0.title} (#0)`,
            id: existingDoc0.id,
          };
        }
      }
      const { data, error } = await supa
        .from("documents")
        .insert(
          withMessage({
            ...insertArgs,
            doc_number: isDoc0 ? 0 : docNumber,
            project_id: projectId,
            doc_type: isDoc0 ? (insertArgs.doc_type ?? "contents checklist") : insertArgs.doc_type,
            ...(linkedNodeIds ? { linked_node_ids: linkedNodeIds } : {}),
          }),
        )
        .select("id, title")
        .single();
      if (error) throw error;
      if (finalNodeId) {
        await supa
          .from("canvas_nodes")
          .update({ data: { documentId: data.id, generationStatus: "draft row created" } })
          .eq("id", finalNodeId)
          .eq("project_id", projectId);
      }
      return { ok: true, message: `Document created: ${data.title} (#${docNumber})`, id: data.id };
    }
    if (name === "add_documents") {
      // Batch insert. Reuses the same gates as add_document, then loops the
      // insert path server-side so the assistant only spends ONE round
      // regardless of how many documents are being drafted.
      const rawDocs = Array.isArray((args as { documents?: unknown[] }).documents)
        ? (args as { documents: unknown[] })
        .documents
        : [];
      if (rawDocs.length === 0) return { ok: false, message: "add_documents needs at least one document" };
      const { data: proj } = await supa
        .from("projects")
        .select("solution_summary, logic_approved_at")
        .eq("id", projectId)
        .single();
      if (!proj?.solution_summary || !proj?.logic_approved_at) {
        return {
          ok: false,
          message:
            "Cannot create documents yet — the Logic Flow has not been approved. Tell the user to open Canvas → Logic Flow, generate it, review, then click 'Approve logic'.",
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
          message:
            "Cannot create final documents yet — the Final Flow is not mapped. Call create_final_documents_map first, then retry add_documents.",
        };
      }
      // Pre-fetch existing doc_numbers to auto-assign without collision.
      const { data: existingDocs } = await supa
        .from("documents")
        .select("doc_number")
        .eq("project_id", projectId);
      const usedNumbers = new Set<number>(
        (existingDocs ?? []).map((d: any) => Number(d.doc_number)).filter((n: number) => Number.isFinite(n)),
      );
      let nextAuto = 1;
      const pickNumber = (requested: unknown): number => {
        const n = Number(requested);
        if (Number.isFinite(n) && n >= 0 && !usedNumbers.has(n)) {
          usedNumbers.add(n);
          return n;
        }
        while (usedNumbers.has(nextAuto)) nextAuto += 1;
        usedNumbers.add(nextAuto);
        return nextAuto;
      };
      const created: Array<{ id: string; title: string; doc_number: number }> = [];
      const failed: Array<{ title: string; reason: string }> = [];
      for (const raw of rawDocs) {
        const d = (raw ?? {}) as Record<string, unknown>;
        const title = String(d.title ?? "").trim();
        if (!title) {
          failed.push({ title: "(missing)", reason: "title is required" });
          continue;
        }
        const docNumber = pickNumber(d.doc_number);
        const finalNodeId = typeof d.final_node_id === "string" ? d.final_node_id : null;
        const linkedNodeIds = finalNodeId ? [finalNodeId] : undefined;
        const insertPayload: Record<string, unknown> = withMessage({
          project_id: projectId,
          title,
          doc_number: docNumber,
          doc_type: typeof d.doc_type === "string" ? d.doc_type : null,
          print_size: typeof d.print_size === "string" ? d.print_size : null,
          design_instructions: typeof d.design_instructions === "string" ? d.design_instructions : null,
          hebrew_content: typeof d.hebrew_content === "string" ? d.hebrew_content : null,
          envelope_number: typeof d.envelope_number === "number" ? d.envelope_number : null,
          ...(linkedNodeIds ? { linked_node_ids: linkedNodeIds } : {}),
        });
        const { data: row, error } = await supa
          .from("documents")
          .insert(insertPayload)
          .select("id, title, doc_number")
          .single();
        if (error || !row) {
          failed.push({ title, reason: error?.message ?? "insert failed" });
          continue;
        }
        created.push({ id: row.id, title: row.title, doc_number: row.doc_number ?? docNumber });
        if (finalNodeId) {
          await supa
            .from("canvas_nodes")
            .update({ data: { documentId: row.id, generationStatus: "draft row created" } })
            .eq("id", finalNodeId)
            .eq("project_id", projectId);
        }
      }
      return {
        ok: created.length > 0,
        message: `Created ${created.length} document${created.length === 1 ? "" : "s"}${failed.length ? `; ${failed.length} failed` : ""}.`,
        created,
        failed,
      };
    }
      const proposalDocs = Array.isArray((args as { documents?: unknown[] }).documents)
        ? (args as { documents: unknown[] }).documents
        : [];
      if (proposalDocs.length === 0)
        return { ok: false, message: "propose_document_set needs at least one document" };
      // Sanitize entries — keep only the planning fields, drop unknowns.
      const cleaned = proposalDocs.map((raw, i) => {
        const d = (raw ?? {}) as Record<string, unknown>;
        return {
          doc_number: typeof d.doc_number === "number" ? d.doc_number : null,
          title: String(d.title ?? `Planned document ${i + 1}`).slice(0, 200),
          doc_type:
            typeof d.doc_type === "string" && d.doc_type.trim().length > 0
              ? d.doc_type.trim()
              : "case evidence",
          print_size:
            typeof d.print_size === "string" && d.print_size.trim().length > 0
              ? d.print_size.trim()
              : "A4",
          envelope_number: typeof d.envelope_number === "number" ? d.envelope_number : null,
          purpose: String(d.purpose ?? "Planned by the assistant from the Logic Flow.").slice(
            0,
            1200,
          ),
          linked_logic_node_ids: Array.isArray(d.linked_logic_node_ids)
            ? (d.linked_logic_node_ids as unknown[]).filter(
                (x): x is string => typeof x === "string",
              )
            : [],
        };
      });
      const { error } = await supa
        .from("projects")
        .update({
          proposed_document_set: cleaned,
          proposed_document_set_status: "proposed",
          proposed_document_set_approved_at: null,
        })
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
      const { data: proj } = await supa
        .from("projects")
        .select("proposed_document_set, proposed_document_set_status")
        .eq("id", projectId)
        .single();
      const hasProposal =
        Array.isArray(proj?.proposed_document_set) &&
        (proj?.proposed_document_set as unknown[]).length > 0;
      const nextStatus = hasProposal
        ? proj?.proposed_document_set_status === "approved"
          ? "approved"
          : "approved"
        : "bypassed";
      await supa
        .from("projects")
        .update({
          proposed_document_set_status: nextStatus,
          proposed_document_set_approved_at: new Date().toISOString(),
        })
        .eq("id", projectId);
      const base = `${SUPABASE_URL}/functions/v1/create-final-documents-map`;
      const resp = await fetch(base, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          projectId,
          replace: (args as { replace?: boolean }).replace !== false,
          createdByMessageId: messageId,
        }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) return { ok: false, message: payload.error ?? "Final Flow creation failed" };
      return {
        ok: true,
        message: `Final Flow created with ${payload.nodeCount ?? 0} nodes, including ${payload.documentNodeCount ?? 0} planned documents and ${payload.edgeCount ?? 0} connecting lines${hasProposal ? " (built from your approved proposal)" : ""}. Review the Final board before creating document rows.`,
      };
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
        useExistingSummary:
          (args as { use_existing_summary?: boolean }).use_existing_summary !== false,
      });
      const fireAndForget = fetch(`${SUPABASE_URL}/functions/v1/generate-logic-flow`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body,
      }).catch((err) => {
        console.error("[assistant-chat] generate-logic-flow background fetch failed", err);
      });
      // Keep the worker alive long enough to send the request without blocking
      // the assistant turn on the full 2-3 min response.
      const runtime = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } })
        .EdgeRuntime;
      if (runtime?.waitUntil) runtime.waitUntil(fireAndForget);
      // Stamp the project as "building" immediately so the UI indicator
      // lights up before the first node streams in (the planner can take
      // 30-90s of upfront thinking before the first node lands).
      await supa
        .from("projects")
        .update({ logic_flow_building_at: new Date().toISOString() })
        .eq("id", projectId);
      return {
        ok: true,
        message:
          "Logic Flow regeneration STARTED. The board is being painted LIVE on Canvas → Logic Flow as the AI streams nodes and edges in (typically settles within 2-3 minutes). " +
          "Tell the user to open Canvas → Logic Flow now and watch it draw itself in real time, then approve the board once it's settled. " +
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
      return {
        ok: true,
        message: `Canvas node added: ${data.title}. ${"requires_followup" in followup ? "REMEMBER: also call add_canvas_edge to wire it into the graph, then surface the post-approval follow-up buttons." : "REMEMBER: if there are existing nodes this should connect to, call add_canvas_edge in the same turn."}`,
        id: data.id,
        ...followup,
      };
    }
    if (name === "add_canvas_edge") {
      const sourceId = String((args as { source_id?: string }).source_id ?? "").trim();
      const targetId = String((args as { target_id?: string }).target_id ?? "").trim();
      const label = (args as { label?: string }).label;
      const board = String((args as { board?: string }).board ?? "logic").trim();
      if (!sourceId || !targetId)
        return { ok: false, message: "source_id and target_id are required" };
      if (sourceId === targetId)
        return { ok: false, message: "source_id and target_id must be different nodes" };
      // Verify both nodes exist on the same board within this project.
      const { data: nodes, error: lookupErr } = await supa
        .from("canvas_nodes")
        .select("id, board, title")
        .in("id", [sourceId, targetId])
        .eq("project_id", projectId);
      if (lookupErr) throw lookupErr;
      if (!nodes || nodes.length !== 2) {
        return {
          ok: false,
          message:
            "One or both node ids were not found in this project. Pass valid ids from the Existing canvas nodes roster.",
        };
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
      const src =
        (nodes as Array<{ id: string; title: string }>).find((n) => n.id === sourceId)?.title ??
        sourceId;
      const tgt =
        (nodes as Array<{ id: string; title: string }>).find((n) => n.id === targetId)?.title ??
        targetId;
      const followup = await buildPostApprovalFollowup(`add_canvas_edge (${src} → ${tgt})`);
      return {
        ok: true,
        message: `Edge created: ${src} → ${tgt}${label ? ` ("${label}")` : ""}`,
        id: data.id,
        ...followup,
      };
    }
    if (name === "propose_options") {
      // No state mutation — this tool exists purely so the model can attach
      // quick-reply button data to its reply. The args are surfaced verbatim
      // to the client through the tool result.
      const opts = args as { options?: Array<{ label: string; send?: string }>; question?: string };
      const cleaned = (opts.options ?? [])
        .filter((o) => o && typeof o.label === "string" && o.label.trim().length > 0)
        .slice(0, 6)
        .map((o) => ({ label: o.label.trim(), send: (o.send ?? o.label).trim() }));
      if (cleaned.length < 2)
        return { ok: false, message: "propose_options needs at least 2 valid options" };
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
      const origins = { ...((current?.assistant_origins as Record<string, string>) ?? {}) };
      if (messageId) origins.doc_generation_mode = messageId;
      const { error } = await supa
        .from("projects")
        .update({ doc_generation_mode: mode, assistant_origins: origins })
        .eq("id", projectId);
      if (error) throw error;
      const friendly =
        mode === "drafts"
          ? "Drafts only — I'll write the rows, you press Generate"
          : mode === "auto"
            ? "Full auto — after each doc I'll ask Image, PDF, or Both before generating"
            : "Ask each time — I'll check Image, PDF, Both, or draft before generating";
      return { ok: true, message: `Document workflow set: ${friendly}` };
    }
    if (name === "generate_document_assets") {
      const documentId = String((args as { document_id?: string }).document_id ?? "").trim();
      const requestedMode = String((args as { mode?: string }).mode ?? "both").trim();
      const documentFormat = String(
        (args as { document_format?: string }).document_format ?? "pdf",
      ).trim();
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
          message:
            "Cannot generate — Logic Flow not approved yet. Tell the user to approve it on the Canvas first.",
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

      const imageOrigins: Array<{
        requested?: string | null;
        effective?: string | null;
        provider?: string | null;
        fallback?: string | null;
      }> = [];
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
          return {
            ok: false,
            status: aborted ? 504 : 500,
            body: {
              error: aborted
                ? "timeout after 120s — generation continues server-side, check Documents tab"
                : ((e as Error)?.message ?? "fetch failed"),
            },
          };
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
        if (!r.ok)
          errors.push(
            `direct ${documentFormat.toUpperCase()} file failed: ${r.body?.error ?? r.status}`,
          );
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
        .select(
          "hebrew_content, generated_asset_url, generated_document_url, generated_pdf_url, document_format, document_model, document_provider, document_skill_id, title",
        )
        .eq("id", documentId)
        .single();
      const hebrew = (finalDoc?.hebrew_content ?? "").toString();
      const preview = hebrew.length > 240 ? `${hebrew.slice(0, 240)}…` : hebrew;
      const imageUrl = finalDoc?.generated_asset_url ?? null;
      const documentUrl = finalDoc?.generated_document_url ?? finalDoc?.generated_pdf_url ?? null;

      if (errors.length > 0 && !imageUrl && !hebrew && !documentUrl) {
        return {
          ok: false,
          message: `Generation failed for "${finalDoc?.title ?? "document"}" — ${errors.join("; ")}. You can retry this same document safely.`,
          id: documentId,
        };
      }
      const done = completed.length > 0 ? ` Completed: ${completed.join(", ")}.` : "";
      const partial =
        errors.length > 0
          ? ` Partial issues: ${errors.join("; ")}. You can retry failed parts from this same document.`
          : "";
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
    if (name === "bulk_generate_documents") {
      // Kick off the bulk-generate-documents edge function as a background
      // job. Returns immediately so the assistant only spends ONE round
      // regardless of how many docs are queued. Progress is written to
      // bulk_generation_jobs and surfaced live in the Documents tab.
      const a = args as Record<string, unknown>;
      const scope = String(a.scope ?? "").trim();
      const mode = String(a.mode ?? "").trim();
      if (!["all_remaining", "from_doc_number", "ids"].includes(scope)) {
        return { ok: false, message: "scope must be 'all_remaining', 'from_doc_number', or 'ids'" };
      }
      if (!["draft", "image", "document", "both", "image_to_pdf"].includes(mode)) {
        return { ok: false, message: "mode must be 'draft', 'image', 'document', 'both', or 'image_to_pdf'" };
      }
      const documentFormat = String(a.document_format ?? "pdf").trim();
      // Logic-Flow gate (same as the per-doc tool).
      const { data: proj } = await supa
        .from("projects")
        .select("solution_summary, logic_approved_at")
        .eq("id", projectId)
        .single();
      if (!proj?.solution_summary || !proj?.logic_approved_at) {
        return { ok: false, message: "Cannot generate — Logic Flow not approved yet." };
      }
      // Resolve the target document set so we can pre-populate the job row
      // (total + document_ids) and the assistant can report a real count back.
      let targetIds: string[] = [];
      if (scope === "ids") {
        const ids = Array.isArray(a.document_ids)
          ? (a.document_ids as unknown[]).filter((x): x is string => typeof x === "string")
          : [];
        if (ids.length === 0) return { ok: false, message: "scope='ids' requires document_ids[]" };
        const { data: rows } = await supa
          .from("documents")
          .select("id")
          .eq("project_id", projectId)
          .in("id", ids);
        targetIds = (rows ?? []).map((r: any) => r.id);
      } else if (scope === "from_doc_number") {
        const fromN = Number(a.from_doc_number);
        if (!Number.isFinite(fromN)) {
          return { ok: false, message: "scope='from_doc_number' requires from_doc_number (number)" };
        }
        let q = supa
          .from("documents")
          .select("id, doc_number")
          .eq("project_id", projectId)
          .gte("doc_number", fromN);
        const untilN = Number(a.until_doc_number);
        if (Number.isFinite(untilN)) q = q.lte("doc_number", untilN);
        const { data: rows } = await q.order("doc_number", { ascending: true });
        targetIds = (rows ?? []).map((r: any) => r.id);
      } else {
        // all_remaining: every non-final doc, skip Doc 0.
        const { data: rows } = await supa
          .from("documents")
          .select("id, doc_number, status")
          .eq("project_id", projectId)
          .neq("status", "final")
          .order("doc_number", { ascending: true });
        targetIds = (rows ?? [])
          .filter((r: any) => Number(r.doc_number) !== 0)
          .map((r: any) => r.id);
      }
      if (targetIds.length === 0) {
        return { ok: false, message: "No documents matched the requested scope." };
      }
      // Fire-and-forget invoke. The edge function creates its own job row
      // (single source of truth) and returns the jobId — but we don't await
      // it here so the assistant turn finishes immediately.
      const fireAndForget = fetch(`${SUPABASE_URL}/functions/v1/bulk-generate-documents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          projectId,
          scope,
          mode,
          documentFormat,
          documentIds: scope === "ids" ? targetIds : undefined,
          fromDocNumber: scope === "from_doc_number" ? Number(a.from_doc_number) : undefined,
          untilDocNumber:
            scope === "from_doc_number" && Number.isFinite(Number(a.until_doc_number))
              ? Number(a.until_doc_number)
              : undefined,
        }),
      }).catch((err) => {
        console.error("[assistant-chat] bulk-generate-documents background fetch failed", err);
      });
      const runtime = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } })
        .EdgeRuntime;
      if (runtime?.waitUntil) runtime.waitUntil(fireAndForget);
      return {
        ok: true,
        message: `Queued ${targetIds.length} document${targetIds.length === 1 ? "" : "s"} for ${mode} generation. Tell the user to watch the Documents tab — progress updates live. Do NOT claim docs are finished, only that generation is QUEUED/STARTED.`,
        total: targetIds.length,
      };
    }
    if (name === "explain_claude_skill_install") {
      const requested =
        String((args as { requested_skill?: string }).requested_skill ?? "Claude Skill").trim() ||
        "Claude Skill";
      const intendedUse =
        String(
          (args as { intended_use?: string }).intended_use ?? "relevant Claude tasks",
        ).trim() || "relevant Claude tasks";
      return {
        ok: true,
        message: `Claude Skill install request noted: ${requested}. To install it, upload a Claude Skill package/file in Settings → Assistant Rules → Claude Skills, then enable it for ${intendedUse}. Once installed, Claude requests will receive the enabled skill list automatically.`,
      };
    }
    if (name === "add_document_inline_images") {
      const documentId = String((args as { document_id?: string }).document_id ?? "").trim();
      const layout = String((args as { layout?: string }).layout ?? "bottom-grid-2col").trim();
      const caption = (args as { caption?: string }).caption?.trim() || null;
      const groupKey = (args as { group_key?: string }).group_key?.trim() || null;
      const rawImages = Array.isArray((args as { images?: unknown[] }).images)
        ? (args as { images: unknown[] }).images
        : [];
      if (!documentId) return { ok: false, message: "document_id is required" };
      if (rawImages.length === 0) return { ok: false, message: "Pass at least one image slot." };

      // Verify the document belongs to this project.
      const { data: docRow } = await supa
        .from("documents")
        .select("id, project_id, title")
        .eq("id", documentId)
        .maybeSingle();
      if (!docRow || (docRow as { project_id?: string }).project_id !== projectId) {
        return { ok: false, message: "Document not found in this project." };
      }

      // Persist layout + caption on the document.
      await supa
        .from("documents")
        .update({
          inline_images_layout: [
            "bottom-grid-2col",
            "bottom-grid-3col",
            "inline-after-text",
            "gallery",
          ].includes(layout)
            ? layout
            : "bottom-grid-2col",
          ...(caption !== null ? { inline_images_caption: caption } : {}),
        } as never)
        .eq("id", documentId);

      // Find the next position offset (so we append, not overwrite).
      const { count: existing } = await supa
        .from("document_inline_images")
        .select("id", { count: "exact", head: true })
        .eq("document_id", documentId);
      const offset = existing ?? 0;

      // Determine which slot is the anchor — first one marked, else slot 0.
      let anchorIdx = rawImages.findIndex(
        (r) => (r as { is_anchor?: boolean })?.is_anchor === true,
      );
      if (anchorIdx < 0) anchorIdx = 0;

      // Insert anchor first so children can reference its id.
      const anchorRaw = rawImages[anchorIdx] as { slot_label?: string; prompt?: string };
      const { data: anchorRow, error: anchorErr } = await supa
        .from("document_inline_images")
        .insert({
          document_id: documentId,
          project_id: projectId,
          position: offset + anchorIdx,
          slot_label: String(anchorRaw?.slot_label ?? "Image 1").slice(0, 120),
          prompt: anchorRaw?.prompt ?? null,
          is_anchor: true,
          group_key: groupKey,
          status: "pending",
          ...(messageId ? { created_by_message_id: messageId } : {}),
        } as never)
        .select("id")
        .single();
      if (anchorErr)
        return { ok: false, message: `Could not create anchor slot: ${anchorErr.message}` };
      const anchorId = (anchorRow as { id: string }).id;

      // Insert children pointing at the anchor.
      const childRows = rawImages
        .map((r, i) => ({ raw: r as { slot_label?: string; prompt?: string }, i }))
        .filter(({ i }) => i !== anchorIdx)
        .map(({ raw, i }) => ({
          document_id: documentId,
          project_id: projectId,
          position: offset + i,
          slot_label: String(raw?.slot_label ?? `Image ${i + 1}`).slice(0, 120),
          prompt: raw?.prompt ?? null,
          is_anchor: false,
          anchor_image_id: anchorId,
          group_key: groupKey,
          status: "pending",
          ...(messageId ? { created_by_message_id: messageId } : {}),
        }));
      if (childRows.length > 0) {
        const { error: childErr } = await supa
          .from("document_inline_images")
          .insert(childRows as never);
        if (childErr)
          return { ok: false, message: `Anchor created, but children failed: ${childErr.message}` };
      }

      return {
        ok: true,
        message: `Planned ${rawImages.length} inline image slot${rawImages.length === 1 ? "" : "s"} for "${(docRow as { title?: string }).title ?? "document"}" — layout ${layout}${groupKey ? `, group "${groupKey}"` : ""}. The user can now generate them from the Documents tab.`,
        document_id: documentId,
        anchor_id: anchorId,
        slot_count: rawImages.length,
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
      if (typeof u.thumbnail_url === "string" && u.thumbnail_url)
        extras.thumbnail_url = u.thumbnail_url;
      if (typeof u.alt_thumbnail_url === "string" && u.alt_thumbnail_url)
        extras.alt_thumbnail_url = u.alt_thumbnail_url;
      if (typeof u.cover_image_url === "string" && u.cover_image_url)
        extras.cover_image_url = u.cover_image_url;
      if (typeof u.generated_asset_url === "string" && u.generated_asset_url)
        extras.image_url = u.generated_asset_url;
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
    if (name === "approve_document") {
      const id =
        typeof (args as { id?: unknown }).id === "string" ? (args as { id: string }).id : "";
      if (!id) return { ok: false, message: "approve_document needs id" };
      const { data: docRow, error: docErr } = await supa
        .from("documents")
        .select("id, title, doc_number, project_id, linked_node_ids")
        .eq("id", id)
        .eq("project_id", projectId)
        .single();
      if (docErr || !docRow) return { ok: false, message: "Document not found in this project" };
      await supa
        .from("documents")
        .update(withMessage({ status: "final" }))
        .eq("id", id);
      // Mirror "approved" onto every Final Flow document node tied to this doc.
      try {
        const linked: string[] = Array.isArray(docRow.linked_node_ids)
          ? docRow.linked_node_ids
          : [];
        const { data: nodes } = await supa
          .from("canvas_nodes")
          .select("id, data")
          .eq("project_id", projectId)
          .eq("board", "final")
          .eq("node_type", "document");
        const targets = (nodes ?? []).filter(
          (n: any) =>
            (n.data as { documentId?: string } | null)?.documentId === id || linked.includes(n.id),
        );
        for (const n of targets) {
          const merged = {
            ...((n.data as Record<string, unknown> | null) ?? {}),
            generationStatus: "approved",
          };
          await supa.from("canvas_nodes").update({ data: merged }).eq("id", n.id);
        }
      } catch (e) {
        console.warn("[approve_document] node mirror failed", (e as Error).message);
      }
      return {
        ok: true,
        message: `Approved: #${docRow.doc_number ?? "?"} ${docRow.title ?? "—"} (status → final, Final Flow node turned green)`,
        id,
      };
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
      const result = await runUpdate("canvas_nodes", "node", true, "id, title, data", (r) =>
        String(r.title ?? "—"),
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
      if (!Number.isFinite(stage) || stage < 1)
        return { ok: false, message: "stage must be a positive number" };
      if (!Number.isFinite(level) || level < 1)
        return { ok: false, message: "level must be a positive number" };
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
      return {
        ok: true,
        message: `Hint added: stage ${data.stage} · level ${data.level}`,
        id: data.id,
      };
    }
    if (name === "generate_hint_stage") {
      const a = args as { stage?: number; hints?: unknown[]; context?: string };
      const stage = Number(a.stage);
      if (!Number.isFinite(stage) || stage < 1)
        return { ok: false, message: "stage must be a positive number" };
      const rawHints = Array.isArray(a.hints) ? a.hints : [];
      const cleaned = rawHints
        .map((h) => (typeof h === "string" ? h.trim() : ""))
        .filter((h) => h.length > 0)
        .slice(0, 6);
      if (cleaned.length === 0)
        return { ok: false, message: "Provide at least one Hebrew hint string" };
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
      const { error } = await supa.from("project_notifications").insert({
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
    supa
      .from("suspects")
      .select("id, name, role_in_case")
      .eq("project_id", projectId)
      .order("position", { ascending: true })
      .limit(25),
    supa
      .from("documents")
      .select("id, doc_number, title, doc_type, status")
      .eq("project_id", projectId)
      .order("doc_number", { ascending: true, nullsFirst: false })
      .limit(25),
    supa
      .from("envelopes")
      .select("id, number, label")
      .eq("project_id", projectId)
      .order("number", { ascending: true })
      .limit(25),
    supa
      .from("hints")
      .select("id, stage, level")
      .eq("project_id", projectId)
      .order("stage", { ascending: true })
      .order("level", { ascending: true })
      .limit(25),
    supa
      .from("canvas_nodes")
      .select("id, title, node_type, board")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .limit(25),
    supa
      .from("canvas_edges")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
    supa
      .from("canvas_nodes")
      .select("updated_at")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
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
    const raw = ownerProfile as { assistant_tweaks?: unknown; assistant_playbook?: unknown } | null;
    if (raw && Array.isArray(raw.assistant_tweaks)) tweaks = raw.assistant_tweaks as Tweak[];
    if (raw) playbook = resolvePlaybook(raw.assistant_playbook);
  }

  const modelKey = String(project.ai_provider_planning ?? "openai-5.2");
  const model = PROVIDER_MODEL[modelKey] ?? PROVIDER_MODEL["openai-5.2"] ?? PROVIDER_MODEL.lovable;
  const claudeChatSkills = model.startsWith("anthropic/")
    ? await loadClaudeSkillsForSurface(supa, "chat")
    : [];
  const rosters: Rosters = {
    suspects: (suspectsRoster ?? []) as RosterRow[],
    documents: (documentsRoster ?? []) as RosterRow[],
    envelopes: (envelopesRoster ?? []) as RosterRow[],
    hints: (hintsRoster ?? []) as RosterRow[],
    canvas_nodes: (nodesRoster ?? []) as RosterRow[],
    canvas_edges_count: edgesCount ?? 0,
    logic_dirty_since_approval: Boolean(
      project.logic_approved_at &&
      (latestNode as { updated_at?: string } | null)?.updated_at &&
      new Date((latestNode as { updated_at: string }).updated_at).getTime() >
        new Date(project.logic_approved_at).getTime(),
    ),
  };
  const lastUser = [...messages].reverse().find((m) => (m as { role: string }).role === "user") as
    | { content: string }
    | undefined;
  const chatDepthChoice = detectPlanningDepthChoice(lastUser?.content);
  if (
    chatDepthChoice &&
    normalizePlanningDepth(
      (project as { planning_depth?: unknown }).planning_depth,
      playbook.planning_depth.default,
    ) !== chatDepthChoice
  ) {
    await supa.from("projects").update({ planning_depth: chatDepthChoice }).eq("id", projectId);
    (project as { planning_depth?: PlanningDepth }).planning_depth = chatDepthChoice;
  }
  const isFirstTurn = (messages?.length ?? 0) <= 1;
  const systemPrompt = buildSystemPrompt(
    project,
    rosters,
    tweaks,
    playbook,
    claudeChatSkills,
    isFirstTurn,
  );
  // Stamp the depth we just rendered so the NEXT turn can detect a flip.
  // Fire-and-forget; failure here must not block the chat reply.
  {
    const currentDepth = normalizePlanningDepth(
      (project as { planning_depth?: unknown }).planning_depth,
      playbook.planning_depth.default,
    );
    if (
      (project as { last_seen_planning_depth?: unknown }).last_seen_planning_depth !== currentDepth
    ) {
      void supa
        .from("projects")
        .update({ last_seen_planning_depth: currentDepth })
        .eq("id", projectId);
    }
  }

  if (lastUser) {
    await supa.from("chat_messages").insert({
      project_id: projectId,
      role: "user",
      content: lastUser.content,
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
    throw new Error(
      "I couldn't start a safe assistant message for this run. Please retry; no document rows were created with broken assistant links.",
    );
  }
  const toolMessageId = assistantMessageId;

  const convo: Array<Record<string, unknown>> = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];
  const executedTools: Array<{ name: string; args?: Record<string, unknown>; result: unknown }> =
    [];
  // Per-round reasoning traces collected from supporting models. Empty unless
  // the project has ai_reasoning_effort != 'none' AND the model supports it.
  type ReasoningSegment = { type: "thinking" | "summary"; text: string };
  const reasoningRounds: Array<{ round: number; segments: ReasoningSegment[] }> = [];
  const stageHistory: Array<{ at: string; label: string }> = [];
  const pushStage = (label: string) => {
    const last = stageHistory[stageHistory.length - 1];
    if (last?.label === label) return;
    stageHistory.push({ at: new Date().toISOString(), label });
  };
  // Push live progress (reasoning + tool receipts + stage history) to the
  // placeholder row so the UI can render the "Thinking…" disclosure live
  // instead of only after the run completes. Fire-and-forget — never block.
  const flushProgress = (stage: string) => {
    pushStage(stage);
    void supa
      .from("chat_messages")
      .update({
        metadata: {
          in_progress: true,
          model,
          stage,
          stage_history: stageHistory,
          partial_tools: executedTools.length,
          tools: executedTools,
          ...(reasoningRounds.length ? { reasoning: reasoningRounds } : {}),
        },
      })
      .eq("id", assistantMessageId);
  };
  // Default to "low" — chat is short turn-by-turn and tool calls don't need
  // heavy reasoning. Users who want deeper thinking can crank ai_reasoning_effort.
  const baseEffort = String(
    (project as { ai_reasoning_effort?: string }).ai_reasoning_effort ?? "high",
  );
  const TOOLS = buildTools(playbook);
  const MAX_ROUNDS = 6;
  let lastFb: { effectiveModel: string; fallback: string } = {
    effectiveModel: model,
    fallback: "none",
  };
  flushProgress("preparing prompt…");
  flushProgress("contacting model…");
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const isFinalRound = round === MAX_ROUNDS - 1;
    // Tool-only rounds get a cheaper reasoning tier than the final prose
    // round, but never go below the user's chosen baseEffort — otherwise
    // models silently return zero reasoning segments and the "Show thinking"
    // panel never has anything to display.
    const roundEffort = isFinalRound
      ? baseEffort
      : baseEffort === "high"
        ? "medium"
        : baseEffort === "medium"
          ? "low"
          : baseEffort;
    const body: Record<string, unknown> = {
      model,
      messages: convo,
      stream: false,
      reasoningEffort: roundEffort,
      ...claudeSkillRequestShape(claudeChatSkills),
    };
    if (!isFinalRound) body.tools = TOOLS;

    if (round > 0) {
      const lastTool = executedTools[executedTools.length - 1]?.name;
      const stage = isFinalRound ? "writing reply" : lastTool ? `after ${lastTool}…` : "thinking…";
      flushProgress(stage);
    }
    flushProgress(
      isFinalRound ? `writing reply (round ${round + 1})…` : `calling model (round ${round + 1})…`,
    );

    const roundStartedAt = Date.now();
    const liveBaseMetadata: Record<string, unknown> = {
      in_progress: true,
      model,
      stage: isFinalRound
        ? `writing reply (round ${round + 1})…`
        : `calling model (round ${round + 1})…`,
      stage_history: stageHistory,
      partial_tools: executedTools.length,
      tools: executedTools,
    };
    const live = await runRoundWithLiveReasoning({
      supa,
      messageId: assistantMessageId,
      model,
      body,
      priorReasoningRounds: reasoningRounds,
      roundIndex: round,
      baseMetadata: liveBaseMetadata,
    });
    logAiRun({
      userId: callerUserId,
      projectId,
      surface: "assistant-chat",
      requestedModel: model,
      effectiveModel: live.ok ? live.effectiveModel : model,
      fallback: live.ok ? live.fallback : "none",
      status: live.ok ? "ok" : "error",
      latencyMs: Date.now() - roundStartedAt,
      errorMessage: live.ok ? undefined : `status ${live.status}`,
      targetId: assistantMessageId,
      promptExcerpt: lastUser?.content ? String(lastUser.content) : undefined,
    });

    if (!live.ok) {
      const provider = model.startsWith("openai/")
        ? "OpenAI"
        : model.startsWith("anthropic/")
          ? "Anthropic"
          : model.startsWith("gemini-direct/")
            ? "Google Gemini"
            : "Lovable AI";
      console.error(`${provider} error`, live.status, live.errorText);
      let errMsg: string;
      if (live.status === 429) errMsg = `${provider} rate limit — try again in a moment.`;
      else if (live.status === 402) errMsg = `${provider} credits/key issue (status 402).`;
      else if (live.status === 401)
        errMsg = `${provider} authentication failed — check the API key in Settings → API keys.`;
      else errMsg = `${provider} error (status ${live.status})`;

      if (executedTools.length > 0) {
        const okCount = executedTools.filter((t) => (t.result as { ok?: boolean })?.ok).length;
        const totalCount = executedTools.length;
        const recoveryNote = `⚠️ ${errMsg}\n\nBefore this happened I successfully executed ${okCount} of ${totalCount} actions (see receipts below). They are already saved — you don't need to redo them. Reply "continue" once the issue is resolved and I'll pick up where I left off.`;
        await supa
          .from("chat_messages")
          .update({
            content: recoveryNote,
            metadata: {
              model,
              effective_model: lastFb.effectiveModel,
              fallback: lastFb.fallback,
              tools: executedTools,
              ...(reasoningRounds.length ? { reasoning: reasoningRounds } : {}),
              partial: true,
              error: errMsg,
              in_progress: false,
            },
          })
          .eq("id", assistantMessageId);
        return;
      }
      throw new Error(errMsg);
    }
    lastFb = { effectiveModel: live.effectiveModel, fallback: live.fallback };

    const msg = live.message as Record<string, unknown>;
    const msgReasoning = msg.reasoning as ReasoningSegment[] | undefined;
    if (Array.isArray(msgReasoning) && msgReasoning.length > 0) {
      reasoningRounds.push({ round, segments: msgReasoning });
      // Flush immediately so the live "Thinking…" disclosure finalises the
      // moment this round's reasoning lands — don't wait for the next loop.
      flushProgress(`thought through round ${round + 1}`);
    }
    const toolCalls = msg.tool_calls as
      | Array<{ id: string; function: { name: string; arguments: string } }>
      | undefined;
    const thinkingBlocks = (
      msg as { thinking_blocks?: Array<{ type: "thinking"; text: string; signature?: string }> }
    ).thinking_blocks;

    if (toolCalls && toolCalls.length > 0) {
      // If the model returned no reasoning segments this round, synthesize a
      // visible action trail from the tool calls so the "Show thinking" panel
      // is never empty mid-flight (most fast/low-effort models skip reasoning).
      if (!Array.isArray(msgReasoning) || msgReasoning.length === 0) {
        const segs: ReasoningSegment[] = toolCalls.map((c) => {
          let preview = "";
          try {
            const obj = JSON.parse(c.function.arguments || "{}") as Record<string, unknown>;
            const keys = Object.keys(obj).slice(0, 4);
            preview = keys
              .map((k) => {
                const v = obj[k];
                const s = typeof v === "string" ? v : JSON.stringify(v);
                return `${k}: ${s.length > 60 ? s.slice(0, 57) + "…" : s}`;
              })
              .join(", ");
          } catch {
            /* ignore */
          }
          return {
            type: "thinking",
            text: `Calling ${c.function.name}${preview ? ` — ${preview}` : ""}`,
          };
        });
        if (segs.length) reasoningRounds.push({ round, segments: segs });
      }
      convo.push({
        role: "assistant",
        content: msg.content ?? "",
        tool_calls: toolCalls,
        ...(thinkingBlocks?.length ? { thinking: thinkingBlocks } : {}),
      });
      for (const call of toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          /* ignore */
        }
        flushProgress(`running ${call.function.name}…`);
        const result = await executeTool(
          supa,
          projectId,
          call.function.name,
          args,
          toolMessageId,
          playbook,
        );
        const argsForUi = call.function.name === "propose_options" ? undefined : args;
        executedTools.push({ name: call.function.name, args: argsForUi, result });
        convo.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        flushProgress(`finished ${call.function.name}`);
      }
      if (round === MAX_ROUNDS - 2) {
        convo.push({
          role: "system",
          content:
            "You have one tool round left. Make any remaining tool calls in a single batch this turn, then write your reply. If you need to create or generate many documents, prefer the batch tools (add_documents, bulk_generate_documents) over looping the per-doc tools.",
        });
      }
      continue;
    }

    const finalText = msg.content ?? "";
    const lastOptionsTool = [...executedTools]
      .reverse()
      .find((t) => t.name === "propose_options" && (t.result as { ok?: boolean })?.ok);
    const optionsResult = lastOptionsTool?.result as
      | { options?: Array<{ label: string; send: string }>; question?: string }
      | undefined;
    let quickOptions = optionsResult?.options ?? null;
    let quickQuestion = optionsResult?.question ?? null;
    // Stale-args guard: model sometimes copies the previous turn's
    // propose_options arguments verbatim. Reject if labels don't appear in
    // this turn's prose, then fall through to the prose synthesizer.
    if (quickOptions && quickOptions.length > 0 && !optionsMatchProse(quickOptions, finalText)) {
      console.warn(
        "[assistant-chat] propose_options stale — labels don't match prose, falling back to synth",
        { labels: quickOptions.map((o) => o.label) },
      );
      quickOptions = null;
      quickQuestion = null;
    }
    if (!quickOptions || quickOptions.length === 0) {
      const synth = synthesizeOptionsFromProse(finalText);
      if (synth) {
        quickOptions = synth.options;
        quickQuestion = synth.question;
      }
    }

    await supa
      .from("chat_messages")
      .update({
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
      })
      .eq("id", assistantMessageId);
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
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const runId = runRow.id as string;

      // Hard ceiling so a hung upstream call can never leave the run row in
      // status='running' forever. 7 minutes is comfortably above any normal
      // assistant turn but well below the Worker's outer kill-switch.
      const HARD_TIMEOUT_MS = 7 * 60 * 1000;
      let finished = false;
      const markFinished = async (status: "done" | "error", error?: string) => {
        if (finished) return;
        finished = true;
        await supa
          .from("assistant_runs")
          .update({
            status,
            error: error ?? null,
            finished_at: new Date().toISOString(),
          })
          .eq("id", runId);
      };

      const work = (async () => {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error("assistant_run_timeout: exceeded 7 min hard limit")),
            HARD_TIMEOUT_MS,
          );
        });
        try {
          await Promise.race([
            processConversation(supa, projectId, messages, callerUserId),
            timeoutPromise,
          ]);
          await markFinished("done");
        } catch (err) {
          console.error("background assistant-chat failed", err);
          const msg = err instanceof Error ? err.message : "Unknown error";
          await markFinished("error", msg);
        } finally {
          // Last-ditch: if neither branch above ran (e.g. unhandled rejection in
          // a microtask before await resumed), still close out the row.
          if (!finished) {
            try {
              await markFinished("error", "Worker terminated mid-run");
            } catch {
              /* swallow — nothing else we can do */
            }
          }
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
      supa
        .from("suspects")
        .select("id, name, role_in_case")
        .eq("project_id", projectId)
        .order("position", { ascending: true })
        .limit(50),
      supa
        .from("documents")
        .select("id, doc_number, title, doc_type, status")
        .eq("project_id", projectId)
        .order("doc_number", { ascending: true, nullsFirst: false })
        .limit(100),
      supa
        .from("envelopes")
        .select("id, number, label")
        .eq("project_id", projectId)
        .order("number", { ascending: true })
        .limit(50),
      supa
        .from("hints")
        .select("id, stage, level")
        .eq("project_id", projectId)
        .order("stage", { ascending: true })
        .order("level", { ascending: true })
        .limit(50),
      supa
        .from("canvas_nodes")
        .select("id, title, node_type, board")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true })
        .limit(100),
      supa
        .from("canvas_edges")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId),
      supa
        .from("canvas_nodes")
        .select("updated_at")
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
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
      const raw = ownerProfile as {
        assistant_tweaks?: unknown;
        assistant_playbook?: unknown;
      } | null;
      if (raw && Array.isArray(raw.assistant_tweaks)) tweaks = raw.assistant_tweaks as Tweak[];
      if (raw) playbook = resolvePlaybook(raw.assistant_playbook);
    }

    const model =
      PROVIDER_MODEL[project.ai_provider_planning ?? "openai-5.2"] ??
      PROVIDER_MODEL["openai-5.2"] ??
      PROVIDER_MODEL.lovable;
    const rosters: Rosters = {
      suspects: (suspectsRoster ?? []) as RosterRow[],
      documents: (documentsRoster ?? []) as RosterRow[],
      envelopes: (envelopesRoster ?? []) as RosterRow[],
      hints: (hintsRoster ?? []) as RosterRow[],
      canvas_nodes: (nodesRoster ?? []) as RosterRow[],
      canvas_edges_count: edgesCount ?? 0,
      logic_dirty_since_approval: Boolean(
        project.logic_approved_at &&
        (latestNode as { updated_at?: string } | null)?.updated_at &&
        new Date((latestNode as { updated_at: string }).updated_at).getTime() >
          new Date(project.logic_approved_at).getTime(),
      ),
    };
    const claudeChatSkills = model.startsWith("anthropic/")
      ? await loadClaudeSkillsForSurface(supa, "chat")
      : [];
    const lastUser = [...messages].reverse().find((m: { role: string }) => m.role === "user") as
      | { content: string }
      | undefined;
    const chatDepthChoice = detectPlanningDepthChoice(lastUser?.content);
    if (
      chatDepthChoice &&
      normalizePlanningDepth(
        (project as { planning_depth?: unknown }).planning_depth,
        playbook.planning_depth.default,
      ) !== chatDepthChoice
    ) {
      await supa.from("projects").update({ planning_depth: chatDepthChoice }).eq("id", projectId);
      (project as { planning_depth?: PlanningDepth }).planning_depth = chatDepthChoice;
    }
    const isFirstTurn = (messages?.length ?? 0) <= 1;
    const systemPrompt = buildSystemPrompt(
      project,
      rosters,
      tweaks,
      playbook,
      claudeChatSkills,
      isFirstTurn,
    );
    // Stamp the depth we just rendered so the NEXT turn can detect a flip.
    {
      const currentDepth = normalizePlanningDepth(
        (project as { planning_depth?: unknown }).planning_depth,
        playbook.planning_depth.default,
      );
      if (
        (project as { last_seen_planning_depth?: unknown }).last_seen_planning_depth !==
        currentDepth
      ) {
        void supa
          .from("projects")
          .update({ last_seen_planning_depth: currentDepth })
          .eq("id", projectId);
      }
    }

    // Persist the last user message
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
      return new Response(
        JSON.stringify({
          error:
            "I couldn't start a safe assistant message for this run. Please retry; no document rows were created with broken assistant links.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const toolMessageId = assistantMessageId;

    // Tool-calling loop: up to 4 rounds
    const convo: Array<Record<string, unknown>> = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];
    const executedTools: Array<{ name: string; args?: Record<string, unknown>; result: unknown }> =
      [];
    type ReasoningSegment = { type: "thinking" | "summary"; text: string };
    const reasoningRounds: Array<{ round: number; segments: ReasoningSegment[] }> = [];
    const stageHistory: Array<{ at: string; label: string }> = [];
    const pushStage = (label: string) => {
      const last = stageHistory[stageHistory.length - 1];
      if (last?.label === label) return;
      stageHistory.push({ at: new Date().toISOString(), label });
    };
    const flushProgress = (stage: string) => {
      pushStage(stage);
      void supa
        .from("chat_messages")
        .update({
          metadata: {
            in_progress: true,
            model,
            stage,
            stage_history: stageHistory,
            partial_tools: executedTools.length,
            tools: executedTools,
            ...(reasoningRounds.length ? { reasoning: reasoningRounds } : {}),
          },
        })
        .eq("id", assistantMessageId);
    };
    const baseEffort = String(
      (project as { ai_reasoning_effort?: string }).ai_reasoning_effort ?? "high",
    );
    const TOOLS = buildTools(playbook);

    const MAX_ROUNDS = 6;
    const callerUserId = await getUserIdFromAuth(req);
    let lastFb: { effectiveModel: string; fallback: string } = {
      effectiveModel: model,
      fallback: "none",
    };
    flushProgress("preparing prompt…");
    flushProgress("contacting model…");
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const isFinalRound = round === MAX_ROUNDS - 1;
      const roundEffort = isFinalRound
        ? baseEffort
        : baseEffort === "high"
          ? "medium"
          : baseEffort === "medium"
            ? "low"
            : baseEffort;
      const body: Record<string, unknown> = {
        model,
        messages: convo,
        stream: false,
        reasoningEffort: roundEffort,
        ...claudeSkillRequestShape(claudeChatSkills),
      };
      if (!isFinalRound) body.tools = TOOLS;
      if (round > 0) {
        const lastTool = executedTools[executedTools.length - 1]?.name;
        flushProgress(
          isFinalRound ? "writing reply" : lastTool ? `after ${lastTool}…` : "thinking…",
        );
      }
      flushProgress(
        isFinalRound
          ? `writing reply (round ${round + 1})…`
          : `calling model (round ${round + 1})…`,
      );

      const roundStartedAt = Date.now();
      const liveBaseMetadata: Record<string, unknown> = {
        in_progress: true,
        model,
        stage: isFinalRound
          ? `writing reply (round ${round + 1})…`
          : `calling model (round ${round + 1})…`,
        stage_history: stageHistory,
        partial_tools: executedTools.length,
        tools: executedTools,
      };
      const live = await runRoundWithLiveReasoning({
        supa,
        messageId: assistantMessageId,
        model,
        body,
        priorReasoningRounds: reasoningRounds,
        roundIndex: round,
        baseMetadata: liveBaseMetadata,
      });
      logAiRun({
        userId: callerUserId,
        projectId,
        surface: "assistant-chat",
        requestedModel: model,
        effectiveModel: live.ok ? live.effectiveModel : model,
        fallback: live.ok ? live.fallback : "none",
        status: live.ok ? "ok" : "error",
        latencyMs: Date.now() - roundStartedAt,
        errorMessage: live.ok ? undefined : `status ${live.status}`,
        targetId: assistantMessageId,
        promptExcerpt: lastUser?.content ? String(lastUser.content) : undefined,
      });

      if (!live.ok) {
        const provider = model.startsWith("openai/")
          ? "OpenAI"
          : model.startsWith("anthropic/")
            ? "Anthropic"
            : model.startsWith("gemini-direct/")
              ? "Google Gemini"
              : "Lovable AI";
        console.error(`${provider} error`, live.status, live.errorText);

        let errMsg: string;
        let errStatus = 500;
        if (live.status === 429) {
          errMsg = `${provider} rate limit — try again in a moment.`;
          errStatus = 429;
        } else if (live.status === 402) {
          const hint =
            provider === "Lovable AI"
              ? "Add credits in Settings → Workspace → Usage, or switch this project's planning provider."
              : `Check your ${provider} account billing or switch this project's planning provider.`;
          errMsg = `${provider} credits/key issue (status 402). ${hint}`;
          errStatus = 402;
        } else if (live.status === 401) {
          errMsg = `${provider} authentication failed — check the API key in Settings → API keys.`;
          errStatus = 401;
        } else {
          errMsg = `${provider} error (status ${live.status})`;
          errStatus = 500;
        }

        if (executedTools.length > 0) {
          const okCount = executedTools.filter((t) => (t.result as { ok?: boolean })?.ok).length;
          const totalCount = executedTools.length;
          const recoveryNote =
            `⚠️ ${errMsg}\n\n` +
            `Before this happened I successfully executed ${okCount} of ${totalCount} actions ` +
            `(see receipts below). They are already saved — you don't need to redo them. ` +
            `Reply "continue" once the issue is resolved and I'll pick up where I left off.`;
          await supa
            .from("chat_messages")
            .update({
              content: recoveryNote,
              metadata: {
                model,
                effective_model: lastFb.effectiveModel,
                fallback: lastFb.fallback,
                tools: executedTools,
                ...(reasoningRounds.length ? { reasoning: reasoningRounds } : {}),
                partial: true,
                error: errMsg,
                in_progress: false,
              },
            })
            .eq("id", assistantMessageId);
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
      lastFb = { effectiveModel: live.effectiveModel, fallback: live.fallback };

      const msg = live.message as Record<string, unknown>;
      const msgReasoning = msg.reasoning as ReasoningSegment[] | undefined;
      if (Array.isArray(msgReasoning) && msgReasoning.length > 0) {
        reasoningRounds.push({ round, segments: msgReasoning });
        // Flush immediately so the live "Thinking…" disclosure finalises the
        // moment this round's reasoning lands — don't wait for the next loop.
        flushProgress(`thought through round ${round + 1}`);
      }
      const toolCalls = msg.tool_calls as
        | Array<{ id: string; function: { name: string; arguments: string } }>
        | undefined;
      const thinkingBlocks = (
        msg as { thinking_blocks?: Array<{ type: "thinking"; text: string; signature?: string }> }
      ).thinking_blocks;

      if (toolCalls && toolCalls.length > 0) {
        if (!Array.isArray(msgReasoning) || msgReasoning.length === 0) {
          const segs: ReasoningSegment[] = toolCalls.map((c) => {
            let preview = "";
            try {
              const obj = JSON.parse(c.function.arguments || "{}") as Record<string, unknown>;
              const keys = Object.keys(obj).slice(0, 4);
              preview = keys
                .map((k) => {
                  const v = obj[k];
                  const s = typeof v === "string" ? v : JSON.stringify(v);
                  return `${k}: ${s.length > 60 ? s.slice(0, 57) + "…" : s}`;
                })
                .join(", ");
            } catch {
              /* ignore */
            }
            return {
              type: "thinking",
              text: `Calling ${c.function.name}${preview ? ` — ${preview}` : ""}`,
            };
          });
          if (segs.length) reasoningRounds.push({ round, segments: segs });
        }
        convo.push({
          role: "assistant",
          content: msg.content ?? "",
          tool_calls: toolCalls,
          ...(thinkingBlocks?.length ? { thinking: thinkingBlocks } : {}),
        });
        for (const call of toolCalls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.function.arguments || "{}");
          } catch {
            /* ignore */
          }
          flushProgress(`running ${call.function.name}…`);
          const result = await executeTool(
            supa,
            projectId,
            call.function.name,
            args,
            toolMessageId,
            playbook,
          );
          const argsForUi = call.function.name === "propose_options" ? undefined : args;
          executedTools.push({ name: call.function.name, args: argsForUi, result });
          convo.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
          flushProgress(`finished ${call.function.name}`);
        }
        continue;
      }

      const finalText = msg.content ?? "";
      const lastOptionsTool = [...executedTools]
        .reverse()
        .find((t) => t.name === "propose_options" && (t.result as { ok?: boolean })?.ok);
      const optionsResult = lastOptionsTool?.result as
        | { options?: Array<{ label: string; send: string }>; question?: string }
        | undefined;
      let quickOptions = optionsResult?.options ?? null;
      let quickQuestion = optionsResult?.question ?? null;

      // Stale-args guard (mirror of background branch): if the model copied
      // a previous turn's propose_options arguments, none of the labels will
      // appear in this turn's numbered list. Reject and fall through to synth.
      if (quickOptions && quickOptions.length > 0 && !optionsMatchProse(quickOptions, finalText)) {
        console.warn(
          "[assistant-chat] propose_options stale — labels don't match prose, falling back to synth",
          { labels: quickOptions.map((o) => o.label) },
        );
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

      await supa
        .from("chat_messages")
        .update({
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
        })
        .eq("id", assistantMessageId);

      return new Response(
        JSON.stringify({
          content: finalText,
          tools: executedTools,
          model,
          messageId: assistantMessageId,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(JSON.stringify({ error: "Too many tool-call rounds" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("assistant-chat error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
