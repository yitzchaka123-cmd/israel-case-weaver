// Mystery Studio Assistant — streaming chat with structured tool calls
// Uses Lovable AI Gateway (Gemini + GPT-5). Tools mutate project state server-side.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

// Map provider preferences to actual gateway model IDs
const PROVIDER_MODEL: Record<string, string> = {
  lovable: "google/gemini-2.5-pro",
  gemini: "google/gemini-2.5-pro",
  "gemini-flash": "google/gemini-2.5-flash",
  openai: "openai/gpt-5",
  "openai-mini": "openai/gpt-5-mini",
  claude: "openai/gpt-5", // Claude not on gateway; fall back to GPT-5 for planning
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
Phase 4 Documents: Doc 0 = contents; then randomized doc numbers, varied types & print sizes, Hebrew bodies. Interrogations must be long, realistic, with pauses & body language.
Envelopes (fixed 5): Open First / 1 / 2 / 3 / 4. Tasks short, bold, not overly revealing. Every envelope ends with: "פתחו את המעטפה הבאה רק אם אתם בטוחים שביצעתם את המשימה הקודמת כראוי."
Hints: 3 per stage — vague → helpful → gives away task.

NUMBERED OPTIONS
When offering choices, ALWAYS use a numbered list.

TOOL USE (CRITICAL)
When the user approves a change, you MUST persist it by calling the appropriate tool. Do NOT just describe the change. Tools write to the shared project state so the UI, canvas and suspects sections update immediately.
- update_project: change project metadata/phase after approvals.
- add_suspect / update_suspect: manage cast.
- add_document: create a document record (Hebrew content, design notes, print size).
- add_canvas_node: add a logic/clue/deduction/envelope/solution node.

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

    for (let round = 0; round < 4; round++) {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, messages: convo, tools: TOOLS, stream: false }),
      });

      if (!resp.ok) {
        if (resp.status === 429) {
          return new Response(JSON.stringify({ error: "Rate limit reached. Please try again in a moment." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (resp.status === 402) {
          return new Response(JSON.stringify({ error: "AI workspace is out of credits. Add funds in Settings → Workspace → Usage." }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const t = await resp.text();
        console.error("Gateway error", resp.status, t);
        return new Response(JSON.stringify({ error: "AI gateway error" }), {
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
