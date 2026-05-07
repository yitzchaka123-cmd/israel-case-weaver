// Generate all envelopes for a project in one shot — produces label, task,
// and design_instructions for every envelope slot defined by the playbook.
// Reuses existing rows by `number` (UPSERT semantics) so it's safe to re-run.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chatCompletions, providerLabel, extractFallback, logAiRun, getUserIdFromAuth } from "../_shared/ai-router.ts";
import {
  PLAYBOOK_DEFAULTS,
  resolvePlaybook,
  renderEnvelopeDesignTemplate,
  renderEnvelopeTaskVoiceTemplate,
} from "../_shared/assistant-playbook.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PROVIDER_MODEL: Record<string, string> = {
  lovable: "google/gemini-3.1-pro-preview",
  gemini: "google/gemini-2.5-pro",
  "gemini-3-pro": "google/gemini-3.1-pro-preview",
  "gemini-3-flash": "google/gemini-3-flash-preview",
  "gemini-flash": "google/gemini-2.5-flash",
  "gemini-flash-lite": "google/gemini-2.5-flash-lite",
  openai: "openai/gpt-5",
  "openai-5.4": "openai/gpt-5.2",
  "openai-5.2": "openai/gpt-5.2",
  "openai-mini": "openai/gpt-5-mini",
  claude: "anthropic/claude-sonnet-4-5",
  "claude-opus": "anthropic/claude-opus-4-5",
  "gemini-direct-pro": "gemini-direct/gemini-2.5-pro",
  "gemini-direct-flash": "gemini-direct/gemini-2.5-flash",
  "gemini-direct-flash-lite": "gemini-direct/gemini-2.5-flash-lite",
  "gemini-direct-3-pro": "gemini-direct/gemini-3.1-pro-preview",
  "gemini-direct-3-flash": "gemini-direct/gemini-3-flash-preview",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { projectId, modelOverride, envelopeNumber } = await req.json() as {
      projectId?: string;
      modelOverride?: string;
      envelopeNumber?: number; // when provided, generate ONLY this envelope (faster, avoids gateway timeouts)
    };
    const onlyNumber = typeof envelopeNumber === "number" ? Math.round(envelopeNumber) : null;
    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL, SERVICE);
    const { data: project, error: pErr } = await supa
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();
    if (pErr || !project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Owner playbook (envelopes config + design template) AND company branding.
    const { data: profile } = await supa
      .from("profiles")
      .select("assistant_playbook")
      .eq("id", project.owner_id)
      .maybeSingle();
    const playbook = resolvePlaybook((profile as { assistant_playbook?: unknown } | null)?.assistant_playbook);

    const { data: companyProfile } = await supa
      .from("company_profiles")
      .select("company_name, tagline, logo_url")
      .eq("owner_id", project.owner_id)
      .maybeSingle();
    const brand = companyProfile as { company_name?: string | null; tagline?: string | null; logo_url?: string | null } | null;
    const brandingBlock = brand?.logo_url
      ? `COMPANY BRANDING (apply to every A4 page insert):
- Company name: ${brand.company_name ?? "(unspecified)"}
- Tagline: ${brand.tagline ?? "(none)"}
- Logo URL: ${brand.logo_url}
The image generator will receive the logo file separately. In the design_instructions, REQUIRE the logo to appear in the top letterhead/header area of the A4 page insert (top-center, top-left, or top-right — pick the spot that fits this page layout best, and use the SAME spot for every page insert in the set so the box looks like one branded series). Logo height ≈ 5–9% of the page's longer side, with breathing room from stamps, file codes, and title text. Treat it as if printed onto the page (matte ink, period-correct registration), not a sticker, not a watermark, no drop shadows. If a company name is supplied, render it in small clean type beside or beneath the logo.`
      : `COMPANY BRANDING: no company logo configured for this workspace — do NOT invent one. Skip the branding lockup entirely.`;

    const { data: existing } = await supa
      .from("envelopes")
      .select("id, number, solution_video_url, followup_clue_note")
      .eq("project_id", projectId);
    const existingByNumber = new Map<number, string>(
      (existing ?? []).map((e) => [e.number as number, e.id as string]),
    );
    type ExistingRow = { number: number | null; solution_video_url: string | null; followup_clue_note: string | null };
    const existingMeta = new Map<number, ExistingRow>(
      (existing ?? []).map((e) => [e.number as number, e as ExistingRow]),
    );

    const { data: suspects } = await supa
      .from("suspects")
      .select("name, role_in_case, is_red_herring")
      .eq("project_id", projectId)
      .order("position");
    const { data: docs } = await supa
      .from("documents")
      .select("doc_number, title, doc_type")
      .eq("project_id", projectId)
      .order("doc_number");
    const { data: logicNodes } = await supa
      .from("canvas_nodes")
      .select("id, title, node_type, description")
      .eq("project_id", projectId)
      .eq("board", "logic")
      .order("created_at", { ascending: true });

    const modelKey = (modelOverride as string) || (project.ai_provider_planning as string) || "lovable";
    const model = PROVIDER_MODEL[modelKey] ?? PROVIDER_MODEL.lovable;
    const gameLanguage = String(project.game_language ?? "Hebrew").trim() || "Hebrew";
    const isRtl = ["Hebrew", "Arabic", "Persian", "Urdu", "Yiddish"].includes(gameLanguage);

    const labels = playbook.envelopes.labels;
    const count = playbook.envelopes.count;

    const sys = `You are a senior boxed-mystery game designer. You are designing the ${count} sealed TASK envelopes that gate key beats of the player flow for a ${gameLanguage} murder-mystery game. The output MUST be a single JSON tool call. No prose.

GAME-FLOW MODEL (read carefully):
- All evidence documents in this case are in the box from the very start. The player has access to every document immediately.
- Envelopes are NOT document containers. Each envelope is a SEALED TASK GATE — the player only opens envelope #N after they finish the task printed inside envelope #N − 1.
- Inside each envelope is a full A4-page in-character letter from the Case Officer to the Detective — never the next batch of evidence.

ENVELOPE FLOW RULES (workspace defaults — follow):
- There are exactly ${count} envelopes in this case, numbered 1..${count}, in order: ${labels.map((l, i) => `#${i + 1} "${l}"`).join(", ")}.
- Envelope #1 ("${labels[0]}") is the MISSION BRIEFING / CINEMATIC GREETING — opened first. It is a warm, in-character welcome from the case officer to the detective: a short cinematic scene-set (weather/place/mood, the moment the case lands on the desk), then the assignment, then ONE single straightforward task. Its opening trigger is the equivalent of "Open first, before reading anything else." HARD RULE: NEVER mention "Doc 0", "Document 0", a contents list, a case-file index, a table of contents, or instruct the player to read any specific document. The case file is just "the case file in front of you" — never named items.
- The FINAL envelope (#${count}) is the CINEMATIC VERDICT + REVEAL — a real game-ending letter (NOT a thin "here's a QR" note). It bookends the cinematic opener of envelope #1, delivers the verdict on a single bold red line, walks the detective through what really happened, signs off in character, and points to the framed QR card printed on the same page that links to the official news report (fake YouTube segment). Its opening trigger is the equivalent of "Open only after you have decided who you want to accuse."
- Every other envelope (#2..#${count - 1}) is unlocked by ONE thing only: the player completing the task printed inside the previous envelope. Envelope #2 MUST OPEN with a 1–2 sentence recap of what the player should have discovered after working on envelope #1's task, then deliver its own follow-up task. The "task" you write for envelope #N is what gates envelope #N + 1 — design the chain so the tasks form a coherent investigative arc that walks the player through the Logic Flow beat by beat.
- DO NOT write opening triggers like "open after you narrow it down to two suspects" or "open after you decode the cipher." The trigger is ALWAYS "open after you complete the task in the previous envelope" (env #1 excepted). The actual investigative work IS the task printed inside the previous envelope.
- All player-facing text is in ${gameLanguage}, ${isRtl ? "RTL" : "LTR"}. The closing line "${playbook.envelopes.closing_line_he}" is appended automatically by the UI when the language matches — do NOT include it in the task field.

TASK FIELD — A4 IN-CHARACTER LETTER (CRITICAL — read carefully):
The "task" field is the FULL printed insert that goes inside the envelope. It must read like a real case-officer hand-off to the detective and EASILY FILL AN A4 PAGE — sometimes spilling onto a second. Thin notes are unacceptable.

LENGTH: ~380–560 words for envelopes #1..#${count - 1}. Hard floor of 340 words — do NOT ship short. The final envelope (#${count}) is ~280–420 words — it must feel like a real ending, not a thin postscript.

VOICE: second-person, addressing "Detective" (or the ${gameLanguage} equivalent). Written in-world by a Case Officer / Dispatcher / Captain. Sober, direct, period- and setting-appropriate. End with a short signature line in character (e.g. "— Dispatch, Central Precinct").

REQUIRED THREE-PART STRUCTURE — every middle (#2..#${count - 1}) and #1 envelope's task body MUST contain, in this order, with each part visually distinct in the printed letter:

PART A — BRIEFING (env #1) or RECAP (envs #2..#${count - 1}). At least 2 real paragraphs, ~180–280 words.
- Envelope #1 (Cinematic Mission Briefing): Open with a 2–4 sentence CINEMATIC scene-set in the in-world setting — weather, location, mood, the moment the case file lands on the detective's desk — before the case-officer's greeting. Then the equivalent of "Hi, Detective — you've been assigned to this case." Two paragraphs total that set the scene: the victim (use approved Phase-1 facts only — never invent a different victim or solution), where and when it happened, the detective's role/jurisdiction, the mood/era of the case, and that the case file in front of them is everything they get. NEVER mention Doc 0, "the contents list", "the index", "the table of contents", or instruct the player to read any specific document — refer to the materials only as "the case file" / "what's in front of you". Vivid and atmospheric. Use the Solution Summary and Phase-1 facts in the user message to anchor real specifics — NEVER spoil the solution.
- Envelopes #2..#${count - 1} (Stage Recap → Follow-up Task): Open with a recap that explicitly references what the previous envelope's task asked the player to do, in the equivalent of "By now, you've worked through [previous task topic] — and you've probably worked out that…" Two paragraphs that summarise — in-world, as if the player succeeded — what the detective should have figured out by THIS beat, anchored to the Logic Flow node this envelope gates. Refer to suspects by name when the beat is about them. Acknowledge what is still open ahead. Strict anti-spoiler: never name a specific document, never reveal the final culprit/method/motive/red-herring/decisive-clue. Only summarise what should already be solved up to and including the previous envelope's task.

PART B — YOUR TASK (THE RED LINE — CRITICAL FORMATTING). ~40–80 words.
- The single task sentence MUST be presented as one bold, visually unmistakable line, set off on its own line(s), beginning with the ${gameLanguage} equivalent of "Your task:" and rendered in red ink (or the period-appropriate equivalent: red typewriter ribbon, red rubber stamp, red marker underline). Author it with a clear visual call-out marker so the design pass renders it that way — wrap it like: **<TASK_RED_LINE>Your task: {one straightforward sentence}.</TASK_RED_LINE>**. The marker tags will be stripped by the UI; the design_instructions MUST require this line to be printed in red, bold, on its own line, visually unmistakable on the A4 page.
- ONE clear, straightforward investigative goal in the world, INVENTED FRESH for THIS case's beat — not template phrasing. Examples of the SHAPE only (do NOT copy these words): "Find out who is lying.", "Figure out who could have been at the scene at the time of the murder.", "Decide who actually had a reason to want him dead." Use the Logic Flow node and case context to write a goal specific to this case.
- DO NOT include any "tips", "how to approach this", investigative-prompt list, or bullet-point guidance after the red task line. The red task line stands alone — no supporting prompts, no checklist, no hints on how to solve it. (Exception: envelope #1 includes one short GENERAL TIPS block — see ENVELOPE #1 rules below.)

PART C — SEAL INSTRUCTION. 2–3 lines.
- The ${gameLanguage} equivalent of "Only break the seal on the next envelope once you are sure you have completed this task correctly." Always references "the next envelope" generically — never hints what is inside it.
- One-line sign-off + in-character signature.

NO-WRITING RULE (LOCKED — non-negotiable):
There is NO notepad, no worksheet, no pen-and-paper component in this game. The detective tracks everything mentally and by re-reading the documents. NEVER instruct the player to "write down", "jot", "note down", "record on paper", "list", "make a chart", "fill in", "mark on the page", or any equivalent. Replace every such instruction with mental-tracking phrasing in the game language: equivalents of "keep in mind", "remember", "hold onto the thought that…", "pay attention to", "stay aware of". This rule applies to PART A, PART B (including the general-tips block in env #1), and PART C. Forbidden verbs (and their game-language equivalents): write, jot, note (as a verb), record, list, chart, log, fill in, mark on paper, scribble.

ANTI-SPOILER RULE (LOCKED — non-negotiable, applies to ALL three parts including the new recap):
The task body MUST NOT (except in the FINAL envelope where the solution IS the point):
- Name or reference any specific document by number, title, or filename (no "pull Doc 3", no "open the autopsy report", no "look at the floor plan", no "Doc 0", no "the contents list/index/table of contents"). Documents are NEVER named in any envelope.
- Reference a specific clue mechanic ("decode the cipher on page 2", "compare the alibis on the timeline grid", "match the prints", "check the receipts").
- Reveal or strongly hint at the culprit, the motive, the murder method, the red herring, or which clue is decisive.
- Tell the player which evidence proves what.
- In Part A recap, reveal answers to beats AFTER the previous envelope's task — only summarise what should already be solved.

Allowed in Part A: naming suspects (they're public), naming the victim, summarising in-world events, naming what the detective is still unsure about. Goals stay at the category level at most ("the materials in your case file", "what you've gathered so far", "the statements you have").

ENVELOPE #1 (Cinematic Mission Briefing) — additional rules:
- Part A is the BRIEFING variant with the cinematic 2–4 sentence opener. No "you've probably worked out…" — the case is brand new.
- Part B walks the player into the first beat of the Logic Flow with ONE straightforward task on the red bold line.
- GENERAL TIPS BLOCK (env #1 ONLY): After Part B's red task line, include a short paragraph or 3–5 bullet block titled the ${gameLanguage} equivalent of "A few tips for the road" — GENERAL, spoiler-free advice for working through the entire game (e.g. "read every page slowly", "take notes on names and times", "compare what each suspect says against the others", "don't break a seal until you're confident"). NEVER reference the specific solution, culprit, decisive clue, or any later envelope's task. This is the ONLY envelope that contains tips. All other envelopes (#2..#${count - 1}) MUST NOT include any tips, how-to-solve guidance, or supporting investigative prompts after the red task line.

FINAL ENVELOPE (#${count}) — CINEMATIC VERDICT + REVEAL (~280–420 words, four beats):
- BEAT 1 — CINEMATIC CLOSE (2–3 sentences): an in-world closing scene that bookends the cinematic opener of envelope #1 — the case officer at their desk late at night, the file finally closing, the city/setting outside, period- and setting-appropriate mood. NOT a recap; a moment in time that closes the loop.
- BEAT 2 — THE VERDICT (single bold red line, same <TASK_RED_LINE> treatment as the other envelopes): one short, unmistakable verdict sentence that explicitly NAMES the culprit and the victim — e.g. "Verdict: {Culprit} killed {Victim}." in game language. This closes the red-line motif from the earlier envelopes.
- BEAT 3 — THE REVEAL (4–7 sentences, in-character): confirm the accusation and walk through what really happened — culprit, method, motive, drawn from the Solution Summary. If a red herring exists in Phase-1 facts, acknowledge them by name ("…and yes, {Red Herring} threw us all, but they were never our person"). This is the ONE place spoilers are allowed.
- BEAT 4 — SIGN-OFF + BROADCAST CALL-OUT (2–4 sentences): a short in-character thank-you to the detective ("Case closed. You did good work."), then a clearly delimited paragraph pointing the detective to the framed QR card printed on the lower portion of this same page — game-language equivalent of "Scan the card below to watch the official news report." Do NOT include the closing line; the UI appends it.

WORKSPACE TASK-VOICE TEMPLATE (the workspace owner's source-of-truth rules for what goes inside every envelope — follow this in addition to the rules above; if anything conflicts, the stricter rule wins):
${renderEnvelopeTaskVoiceTemplate(playbook)}

${renderEnvelopeDesignTemplate(playbook)}

DESIGN_INSTRUCTIONS TARGET (IMPORTANT): The generated mockup is NOT a physical envelope. It is the A4 printed PAGE INSERT that goes inside a real envelope the user will assemble manually. Never describe wax seals, envelope flaps, kraft mailers, front-of-envelope labels, or sealed covers unless the user explicitly asks. The page insert should look like a believable in-world briefing/recap sheet.

PAGE FILL & SPACING (IMPORTANT): Every envelope insert must read like a FULL A4 page — generous body text, clear paragraph rhythm, smart spacing. No half-empty pages, no token paragraphs. The "Your task:" red bold line must sit on its own line with breathing room above and below it so it visually punches.

RED TASK LINE (CRITICAL — applies to envelopes #1..#${count - 1}): The design_instructions MUST explicitly require the "Your task:" sentence to be rendered as a SINGLE BOLD RED LINE on its own line, visually unmistakable — period-appropriate equivalents are fine (red typewriter ribbon, red rubber stamp underline, red marker). The 3–5 supporting investigative prompts that follow stay in normal body type. Call this out in the design brief.

FINAL ENVELOPE QR CARD (CRITICAL — applies ONLY to envelope #${count}): The design_instructions MUST reserve the BOTTOM ~35% of the A4 page for a single LARGE FRAMED QR CARD — not a small inline graphic. Spec the card as: thin printed border (or evidence-tape frame fitting the era), a short bold ${gameLanguage} label at the top of the card (equivalent of "Official News Report"), a believable printed black-and-white QR square roughly 5×5 cm centered inside the frame, a short helper line directly under the QR (equivalent of "Scan to watch"), and the URL printed beneath the helper line in small monospace type as a fallback for players whose phones won't scan. The actual scannable QR is composited later by the app — render a believable placeholder square. The QR card must visually punch as the page's closing element.

REALISM (KEEP IT SIMPLE — IMPORTANT): Each page insert is just a regular era-appropriate briefing/recap sheet — a normal in-world page (e.g. typed memo on letterhead, plain casebook page). Subtle paper texture / light aging is enough. Do NOT pile on tactile gimmicks. Do NOT default to coffee stains, water rings, fold lines, or "smudged ink". If you do use a realism detail, pick something that fits the era and setting (e.g. routing initials for an interoffice memo, a timestamp for a dispatch). Each insert may use a slightly different administrative detail; they do NOT need to be visually distinct document TYPES — same letterhead across the set is fine.

${brandingBlock}

For each envelope you generate:
- "label": short ${gameLanguage} name shown on the envelope front. ${isRtl ? "RTL" : "LTR"}, grammatical.
- "task": the FULL A4 in-character letter described above, in ${gameLanguage}, ${isRtl ? "RTL" : "LTR"}. ~380–560 words for #1..#${count - 1} (hard floor 340 — do NOT ship short), ~200–320 for the final. MUST follow the three-part A/B/C structure (Briefing-or-Recap → Your Task (red bold line, NO supporting prompt list) → Seal Instruction). Envelope #1 only adds a short general-tips block after the red task line. For env #1..#${count - 1}: strictly no specific-document, specific-clue, or solution references. For env #${count}: include the solution confirmation paragraph and the QR scan call-out (the answer IS the point here). The closing line is appended by the UI — do NOT include it.
- "opening_trigger": 1 short sentence in ${gameLanguage}. For envelope #1, the equivalent of "Open first." For envelope #${count}, the equivalent of "Open only after completing the task in envelope #${count - 1}, when you are ready to name the culprit." For every other envelope #N, the equivalent of "Open only after you have completed the task in envelope #N − 1." Do NOT reference specific case beats here — that belongs in the previous envelope's task.
- "design_instructions": a structured visual brief for the image generator describing the A4 page insert placed inside the physical envelope — NOT an envelope cover. Include the envelope marker (1, 2, 3...) as a page header/filing mark, the ${gameLanguage} label verbatim, and at least one detail tied to this case (era, genre, setting). Treat it as a normal era-appropriate briefing page (typed memo on letterhead is the safe default). Pick AT MOST 2–3 subtle realism details that fit a real example of this page in this era — and NEVER default to coffee stains, water rings, fold lines, or generic "smudged ink". MUST require the red bold "Your task:" line for env #1..#${count - 1}; MUST require a printed QR placeholder + caption for env #${count}. When a company logo is configured (see COMPANY BRANDING block above), the brief MUST include explicit instructions to print the logo in the chosen top letterhead/header position — keep that position consistent across every page insert you write in this batch. Keep the brief concise enough for image generation: 8–14 lines.`;

    const userPrompt = `CASE CONTEXT
Title: ${project.title}
Game language: ${gameLanguage}
Subtitle: ${project.subtitle ?? "—"}
Year/Setting: ${project.year ?? "—"} · ${project.setting ?? "—"}
Genre: ${project.genre ?? "mystery"} · Type: ${project.mystery_type ?? "—"} · Difficulty: ${project.difficulty ?? "—"}
Player role: ${project.player_role ?? "—"}
Case goal: ${project.case_goal ?? "—"}
Selling point: ${project.selling_point ?? "—"}
Solution summary: ${project.solution_summary ?? "(not yet written)"}

SUSPECTS:
${(suspects ?? []).map((s, i) => `${i + 1}. ${s.name}${s.is_red_herring ? " (red herring)" : ""} — ${s.role_in_case ?? "—"}`).join("\n") || "(none yet)"}

LOGIC FLOW NODES (use these to choose the case beat each middle envelope is gated on):
${(logicNodes ?? []).slice(0, 40).map((n) => `- [${n.node_type}] ${n.title}${n.description ? ` — ${String(n.description).slice(0, 120)}` : ""}`).join("\n") || "(none yet)"}

DOCUMENTS in the box (${docs?.length ?? 0} total — all available to the player from the start; do NOT use these to fill envelopes):
${(docs ?? []).slice(0, 30).map((d) => `#${d.doc_number ?? "?"} ${d.title} (${d.doc_type ?? "—"})`).join("\n") || "(none yet)"}

PER-ENVELOPE WRITER NOTES (optional follow-up-clue inserts and final-envelope solution video). Apply ONLY to the matching envelope number; if blank, ignore:
${Array.from({ length: count }, (_, i) => i + 1).map((n) => {
  const meta = existingMeta.get(n);
  const followup = (meta?.followup_clue_note ?? "").trim();
  const video = (meta?.solution_video_url ?? "").trim();
  const bits: string[] = [];
  if (followup) bits.push(`follow-up clue: ${followup} → weave a 2–3 sentence note into Part A or between Part A and Part B telling the detective that a small additional in-world enclosure is included in this envelope (e.g. "you'll find a fresh page in this envelope — handle it as new evidence"); do NOT spoil what's on it.`);
  if (n === count && video) bits.push(`solution video URL (for QR caption ONLY — do NOT print the URL itself): ${video}`);
  return bits.length ? `#${n}: ${bits.join(" | ")}` : `#${n}: (none)`;
}).join("\n")}

${onlyNumber !== null
  ? `Produce ONLY envelope #${onlyNumber} (label starting point: "${labels[Math.max(0, Math.min(count - 1, onlyNumber - 1))]}"). Return a single-element envelopes array containing just that envelope. Follow every rule above as if it were part of the full set — its task body must respect the three-part structure and the recap/briefing distinction for its position in the chain.`
  : `Produce all ${count} envelopes now in numerical order (numbered 1..${count}). Reuse the labels above as the starting point for the "label" field but you may refine them. Each envelope must have a distinct opening_trigger anchored in this case's logic flow.`}`;

    const tool = {
      type: "function",
      function: {
        name: "emit_envelopes",
        description: `Return all ${count} envelopes in order.`,
        parameters: {
          type: "object",
          properties: {
            envelopes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  number: { type: "number", description: `1..${count}` },
                  label: { type: "string" },
                  task: { type: "string", description: "Full A4 in-character letter from the Case Officer to the Detective, ~380–560 words (hard floor 340) for env #1 and middle envelopes, ~200–320 for the final envelope. Three-part structure: PART A briefing (env #1, cinematic 2–4 sentence opener) or recap 'By now you've probably worked out…' (middle envelopes), at least 2 paragraphs ~180–280 words; PART B '<TASK_RED_LINE>Your task: ...</TASK_RED_LINE>' on its own line (rendered red bold by the design pass) and NOTHING after it (no supporting prompt list, no how-to-solve bullets) — EXCEPT envelope #1 which appends one short general spoiler-free tips block; PART C 2–3 line seal instruction telling the player to only open the next envelope when sure, plus in-character sign-off. Final envelope (#N) instead carries solution confirmation + QR scan call-out (the answer is allowed there only). For envs #1..#N-1: strictly NEVER references specific document numbers/titles, specific clue mechanics, or the solution. Closing line is appended by UI — do not include it." },
                  opening_trigger: { type: "string", description: "1-sentence description of when the player should open this envelope (in the game language)." },
                  design_instructions: { type: "string" },
                },
                required: ["number", "label", "task", "opening_trigger", "design_instructions"],
                additionalProperties: false,
              },
            },
          },
          required: ["envelopes"],
          additionalProperties: false,
        },
      },
    };

    const startedAt = Date.now();
    const callerUserId = await getUserIdFromAuth(req);
    const resp = await chatCompletions({
      model,
      messages: [{ role: "system", content: sys }, { role: "user", content: userPrompt }],
      tools: [tool],
      tool_choice: { type: "function", function: { name: "emit_envelopes" } },
    });
    const fb = extractFallback(resp, model);

    if (!resp.ok) {
      const provider = providerLabel(model);
      const t = await resp.text().catch(() => "");
      console.error(`generate-envelopes ${provider} error`, resp.status, t);
      await logAiRun({
        userId: callerUserId, projectId, surface: "generate-envelopes",
        requestedModel: model, effectiveModel: fb.effectiveModel, fallback: fb.fallback,
        status: "error", latencyMs: Date.now() - startedAt,
        errorMessage: `${provider} ${resp.status}: ${t.slice(0, 200)}`, promptExcerpt: userPrompt,
      });
      if (resp.status === 429) return new Response(JSON.stringify({ error: `${provider} rate limit — try again shortly.` }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (resp.status === 402) return new Response(JSON.stringify({ error: `${provider} credits/key issue. Check Settings → AI provider routing.` }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (resp.status === 401) return new Response(JSON.stringify({ error: `${provider} auth failed — check the API key in Settings → API keys.` }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: `${provider} error (status ${resp.status})${t ? ": " + t.slice(0, 200) : ""}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await resp.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!call) {
      return new Response(JSON.stringify({ error: "No structured output returned" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const parsed = JSON.parse(call) as {
      envelopes: { number: number; label: string; task: string; opening_trigger?: string; design_instructions: string }[];
    };

    let written = 0;
    for (const env of parsed.envelopes) {
      const number = Math.max(1, Math.min(count, Math.round(env.number)));
      const id = existingByNumber.get(number);
      const trigger = (env.opening_trigger ?? "").trim();
      const notes = trigger ? `Opening trigger: ${trigger}` : null;
      if (id) {
        await supa.from("envelopes").update({
          label: env.label,
          task: env.task,
          design_instructions: env.design_instructions,
          ...(notes ? { notes } : {}),
          status: "review",
        }).eq("id", id);
      } else {
        await supa.from("envelopes").insert({
          project_id: projectId,
          number,
          label: env.label,
          task: env.task,
          design_instructions: env.design_instructions,
          ...(notes ? { notes } : {}),
          status: "review",
        });
      }
      written += 1;
    }

    // Stamp assistant_origins.envelopes so the badge shows up.
    const origins = (project.assistant_origins ?? {}) as Record<string, string>;
    await supa.from("projects").update({
      assistant_origins: { ...origins, envelopes: "manual-generate" },
    }).eq("id", projectId);

    await supa.from("prompts").insert({
      project_id: projectId,
      scope: "envelopes-batch",
      original_prompt: userPrompt,
      final_prompt: userPrompt,
      provider: providerLabel(model),
      model,
    });

    await logAiRun({
      userId: callerUserId, projectId, surface: "generate-envelopes",
      requestedModel: model, effectiveModel: fb.effectiveModel, fallback: fb.fallback,
      status: "ok", latencyMs: Date.now() - startedAt, promptExcerpt: userPrompt,
    });
    return new Response(JSON.stringify({ ok: true, count: written, model, effectiveModel: fb.effectiveModel, fallback: fb.fallback }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-envelopes error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
