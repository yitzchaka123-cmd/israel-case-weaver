// Generate marketing box copy (front_subtext, back_headline, back_body, tagline)
// for a project. Pulls project + suspects + envelope/doc counts + the
// workspace company profile + the playbook's "marketing" rules.
//
// Body shape:
//   { projectId: string, field?: "front_subtext" | "back_headline" | "back_body" | "tagline" | "all" }
//
// Returns:
//   { copy: { front_subtext?, back_headline?, back_body?, tagline? }, model: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chatCompletions, extractFallback, logAiRun, getUserIdFromAuth } from "../_shared/ai-router.ts";
import { resolvePlaybook } from "../_shared/assistant-playbook.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PLANNING_MODEL: Record<string, string> = {
  lovable: "google/gemini-2.5-flash",
  gemini: "google/gemini-2.5-pro",
  "gemini-3-pro": "google/gemini-3.1-pro-preview",
  "gemini-3-flash": "google/gemini-3-flash-preview",
  "gemini-flash": "google/gemini-2.5-flash",
  "gemini-flash-lite": "google/gemini-2.5-flash-lite",
  openai: "openai/gpt-5",
  "openai-5.4": "openai/gpt-5.4",
  "openai-5.2": "openai/gpt-5.2",
  "openai-mini": "openai/gpt-5-mini",
  claude: "anthropic/claude-sonnet-4-5",
  "claude-opus": "anthropic/claude-opus-4-5",
  "claude-haiku": "anthropic/claude-haiku-4-5",
  "gemini-direct-pro": "gemini-direct/gemini-2.5-pro",
  "gemini-direct-flash": "gemini-direct/gemini-2.5-flash",
  "gemini-direct-flash-lite": "gemini-direct/gemini-2.5-flash-lite",
  "gemini-direct-3-pro": "gemini-direct/gemini-3.1-pro-preview",
  "gemini-direct-3-flash": "gemini-direct/gemini-3-flash-preview",
};

type Field =
  | "front_subtext"
  | "back_headline"
  | "back_body"
  | "tagline"
  | "selling_point"
  | "all";

interface Body {
  projectId: string;
  field?: Field;
  /** Optional per-case extra steering ("focus on the locket"). */
  hint?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    const { projectId, field = "all", hint } = body;
    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL, SERVICE);

    const [{ data: project }, { data: suspects }, docsRes, envRes, companyRes] = await Promise.all([
      supa.from("projects").select("title, subtitle, genre, mystery_type, setting, year, player_role, case_goal, selling_point, difficulty, owner_id, ai_provider_planning, target_doc_count").eq("id", projectId).single(),
      supa.from("suspects").select("name, role_in_case").eq("project_id", projectId).order("position"),
      supa.from("documents").select("id", { count: "exact", head: true }).eq("project_id", projectId),
      supa.from("envelopes").select("id", { count: "exact", head: true }).eq("project_id", projectId),
      supa.from("company_profiles").select("*"),
    ]);
    if (!project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pick the company profile owned by the project owner (or first one).
    const companies = (companyRes.data ?? []) as Array<Record<string, unknown>>;
    const company = companies.find((c) => c.owner_id === project.owner_id) ?? companies[0] ?? null;

    // Pull the owner's playbook so the marketing rules are honored.
    const { data: profile } = await supa
      .from("profiles")
      .select("assistant_playbook")
      .eq("id", project.owner_id)
      .maybeSingle();
    const playbook = resolvePlaybook((profile as { assistant_playbook?: unknown } | null)?.assistant_playbook);

    const projectKey = (project.ai_provider_planning as string) || "lovable";
    const model = PLANNING_MODEL[projectKey] ?? PLANNING_MODEL.lovable;

    const docCount = docsRes.count ?? 0;
    const envCount = envRes.count ?? playbook.envelopes.count;

    const ctx = [
      project.title && `Title: ${project.title}`,
      project.subtitle && `Subtitle: ${project.subtitle}`,
      project.genre && `Genre: ${project.genre}`,
      project.mystery_type && `Mystery type: ${project.mystery_type}`,
      project.setting && `Setting: ${project.setting}`,
      project.year && `Year: ${project.year}`,
      project.difficulty && `Difficulty: ${project.difficulty}`,
      project.player_role && `Player role: ${project.player_role}`,
      project.case_goal && `Case goal: ${project.case_goal}`,
      project.selling_point && `Selling point: ${project.selling_point}`,
      suspects?.length && `Suspects (${suspects.length}): ${suspects.map((s) => s.name).filter(Boolean).join(", ")}`,
      `Document count: ${docCount}`,
      `Envelope count: ${envCount}`,
    ].filter(Boolean).join("\n");

    const companyBlock = company
      ? `COMPANY PROFILE
- Company: ${company.company_name ?? ""}
- Tagline: ${company.tagline ?? ""}
- Legal: ${company.legal_text ?? ""}
- Country: ${company.country ?? ""}
- Age rating: ${company.age_rating ?? ""}`
      : "(No company profile set yet — write generic copy.)";

    const fieldsRequested = field === "all"
      ? ["front_subtext", "back_headline", "back_body", "tagline"]
      : [field];

    const isSellingPoint = field === "selling_point";

    const fieldGuidance = isSellingPoint
      ? `
You are generating ONE creative "extra selling point" for this case — a standout, concrete, tactile hook that elevates the box above generic murder-mystery products.

Rules for "selling_point":
- 1–2 short sentences, max ~40 words total.
- Must be CONCRETE and TACTILE — name a specific physical prop, mechanic, or twist (e.g. "A 1980s telex machine bundled in the box that decodes the final clue when the player feeds it the right paper tape.").
- Must fit the case's era, setting, mystery type, genre, difficulty, and player role.
- NO generic marketing fluff ("immersive experience", "thrilling mystery"). Be specific.
- Do NOT spoil the solution.

Voice: ${playbook.identity.brand_voice}
Final language: ${playbook.identity.final_content_language} — but write the selling point in English (it's a planning field, not in-game text).`
      : `
Each field must follow these rules:
- "tagline": 1 line, max 9 words, evocative, ad-friendly.
- "front_subtext": 1–2 short lines, hook for the front of the box, under the title.
- "back_headline": 1 punchy sentence, max 14 words, sets the stakes.
- "back_body": 60–90 words, paragraph form, must subtly mention player role, that the box contains ${docCount} documents and ${envCount} envelopes, age rating if known, but NEVER spoil the solution.

Voice: ${playbook.identity.brand_voice}
Final language: ${playbook.identity.final_content_language} (output Hebrew when the project's final content language is Hebrew, otherwise match the project's planning language).`;

    const system = `You are a senior copywriter for premium boxed murder-mystery games. You write tight, evocative marketing copy. You return ONLY a JSON object — no preamble, no markdown fences. Keys must match the requested fields exactly.`;

    const userMsg = `PROJECT CONTEXT:
${ctx}

${companyBlock}

${fieldGuidance}

REQUESTED FIELDS: ${fieldsRequested.join(", ")}
${hint ? `\nEXTRA STEERING: ${hint}` : ""}

${isSellingPoint
  ? `Return JSON like {"selling_point": "..."} — single key, single 1–2 sentence value.`
  : `Return JSON like {"front_subtext": "...", "back_headline": "...", "back_body": "...", "tagline": "..."} (only include the requested keys).`}
`;

    const resp = await chatCompletions({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMsg },
      ],
      temperature: 0.85,
      response_format: { type: "json_object" },
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("marketing-copy provider error", resp.status, t);
      const provider = model.startsWith("openai/") ? "OpenAI" : "Lovable AI";
      if (resp.status === 429) {
        return new Response(JSON.stringify({ error: `${provider} rate limit — try again shortly.` }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (resp.status === 402) {
        return new Response(JSON.stringify({ error: `${provider} credits/key issue (status 402). Add credits in Settings → Workspace → Usage, or switch this project's planning provider.` }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `${provider} error (status ${resp.status})` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const text: string = (data.choices?.[0]?.message?.content ?? "").trim();
    let parsed: Record<string, string> = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      // Try to recover the first JSON-looking block
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch { /* keep empty */ }
      }
    }

    const copy: Record<string, string> = {};
    for (const k of fieldsRequested) {
      if (typeof parsed[k] === "string" && parsed[k].trim()) {
        copy[k] = parsed[k].trim();
      }
    }

    if (Object.keys(copy).length === 0) {
      return new Response(JSON.stringify({ error: "Model returned no usable copy" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (isSellingPoint) {
      return new Response(JSON.stringify({ value: copy.selling_point, model }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ copy, model }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-marketing-copy error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
