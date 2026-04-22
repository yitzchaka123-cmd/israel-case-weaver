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
function buildSystemPrompt(project: Record<string, unknown>, suspectCount: number, docCount: number) {
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
Envelopes (fixed 5): Open First / 1 / 2 / 3 / 4. Tasks short, bold, not overly revealing. Every envelope ends with: "פתחו את המעטפה הבאה רק אם אתם בטוחים שביצעתם את המשימה הקודמת כראוי."
Hints: 3 per stage — vague → helpful → gives away task.

NUMBERED OPTIONS
When offering choices, ALWAYS use a numbered list.

TOOL USE (CRITICAL)
When the user approves a change, you MUST persist it by calling the appropriate tool. Do NOT just describe the change. Tools write to the shared project state so the UI, canvas and suspects sections update immediately.
- update_project: change project metadata/phase after approvals.
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

Respond in English for planning. Write Hebrew for any final in-game text. Keep outputs concise unless the user requests depth.`;
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
];

// ---------- Tool executor ----------
async function executeTool(
  supa: ReturnType<typeof createClient>,
  projectId: string,
  name: string,
  args: Record<string, unknown>,
) {
  try {
    if (name === "update_project") {
      const { error } = await supa.from("projects").update(args).eq("id", projectId);
      if (error) throw error;
      return { ok: true, message: `Project updated: ${Object.keys(args).join(", ")}` };
    }
    if (name === "set_solution_summary") {
      const summary = String((args as { summary?: string }).summary ?? "").trim();
      const markApproved = Boolean((args as { mark_approved?: boolean }).mark_approved);
      if (!summary) return { ok: false, message: "summary is required" };
      const patch: Record<string, unknown> = { solution_summary: summary };
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
        .insert({ ...args, project_id: projectId })
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
        .insert({ ...args, doc_number: docNumber, project_id: projectId })
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
        })
        .select("id, title")
        .single();
      if (error) throw error;
      return { ok: true, message: `Canvas node added: ${data.title}`, id: data.id };
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

    const model = PROVIDER_MODEL[project.ai_provider_planning ?? "lovable"] ?? PROVIDER_MODEL.lovable;
    const systemPrompt = buildSystemPrompt(project, suspectCount ?? 0, docCount ?? 0);

    // Persist the last user message
    const lastUser = [...messages].reverse().find((m: { role: string }) => m.role === "user");
    if (lastUser) {
      await supa.from("chat_messages").insert({
        project_id: projectId,
        role: "user",
        content: lastUser.content,
      });
    }

    // Tool-calling loop: up to 4 rounds
    const convo: Array<Record<string, unknown>> = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];
    const executedTools: Array<{ name: string; result: unknown }> = [];

    const MAX_ROUNDS = 8;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      // On the final round, drop tools so the model MUST produce a text answer.
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
          const result = await executeTool(supa, projectId, call.function.name, args);
          executedTools.push({ name: call.function.name, result });
          convo.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
        }
        continue; // ask the model to produce final text after tool results
      }

      // Final assistant message
      const finalText = msg.content ?? "";
      await supa.from("chat_messages").insert({
        project_id: projectId,
        role: "assistant",
        content: finalText,
        metadata: { model, tools: executedTools },
      });

      return new Response(JSON.stringify({ content: finalText, tools: executedTools, model }), {
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
