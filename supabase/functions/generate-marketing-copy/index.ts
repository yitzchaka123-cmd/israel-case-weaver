// Generate professional packaging copy for the Marketing Box Text panel.
// Pulls project + counts + company profile + playbook marketing rules.
// Body shape: { projectId: string, field?: packaging field | "front" | "back" | "all" }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chatCompletions, extractFallback, logAiRun, getUserIdFromAuth } from "../_shared/ai-router.ts";
import { resolvePlaybook } from "../_shared/assistant-playbook.ts";
import { claudeSkillPromptBlock, loadClaudeSkillsForSurface, withClaudeSkills } from "../_shared/claude-skills.ts";

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
  "openai-5.4": "openai/gpt-5.2",
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
  | "front_title_note"
  | "tagline"
  | "front_subtext"
  | "front_bottom_explanation"
  | "front_company_slogan"
  | "front_logo_note"
  | "back_headline"
  | "back_teaser"
  | "back_body"
  | "back_whats_in_box"
  | "back_how_to_play"
  | "back_feature_bullets"
  | "back_specs"
  | "back_content_note"
  | "back_footer_text"
  | "front"
  | "back"
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

    const [{ data: project }, { data: suspects }, docsRes, envRes] = await Promise.all([
      supa.from("projects").select("title, subtitle, genre, mystery_type, setting, year, player_role, case_goal, selling_point, difficulty, game_language, owner_id, ai_provider_planning, target_doc_count, company_profile_id, cover_reference_url, cover_reference_notes").eq("id", projectId).single(),
      supa.from("suspects").select("name, role_in_case").eq("project_id", projectId).order("position"),
      supa.from("documents").select("id", { count: "exact", head: true }).eq("project_id", projectId),
      supa.from("envelopes").select("id", { count: "exact", head: true }).eq("project_id", projectId),
    ]);
    if (!project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve active company profile: project link → owner default v2 → any v2 → legacy.
    let company: Record<string, unknown> | null = null;
    if (project.company_profile_id) {
      const { data } = await supa.from("company_profiles_v2").select("*").eq("id", project.company_profile_id).maybeSingle();
      if (data) company = data as Record<string, unknown>;
    }
    if (!company) {
      const { data } = await supa.from("company_profiles_v2").select("*").eq("owner_id", project.owner_id).order("is_default", { ascending: false }).order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (data) company = data as Record<string, unknown>;
    }
    if (!company) {
      const { data } = await supa.from("company_profiles").select("*").eq("owner_id", project.owner_id).maybeSingle();
      if (data) company = data as Record<string, unknown>;
    }

    // Pull the owner's playbook so the marketing rules are honored.
    const { data: profile } = await supa
      .from("profiles")
      .select("assistant_playbook")
      .eq("id", project.owner_id)
      .maybeSingle();
    const playbook = resolvePlaybook((profile as { assistant_playbook?: unknown } | null)?.assistant_playbook);

    const projectKey = (project.ai_provider_planning as string) || "lovable";
    const model = PLANNING_MODEL[projectKey] ?? PLANNING_MODEL.lovable;
    const enabledSkills = model.startsWith("anthropic/") ? await loadClaudeSkillsForSurface(supa, "marketing") : [];

    const docCount = docsRes.count ?? 0;
    const envCount = envRes.count ?? playbook.envelopes.count;
    // Profile language wins over project.game_language so EN/HE companies write in their own voice.
    const profileLanguage = company && typeof company.language === "string" ? String(company.language).trim() : "";
    const gameLanguage = profileLanguage || String(project.game_language ?? "Hebrew").trim() || "Hebrew";

    const ctx = [
      project.title && `Title: ${project.title}`,
      project.subtitle && `Subtitle: ${project.subtitle}`,
      project.genre && `Genre: ${project.genre}`,
      project.mystery_type && `Mystery type: ${project.mystery_type}`,
      project.setting && `Setting: ${project.setting}`,
      project.year && `Year: ${project.year}`,
      project.difficulty && `Difficulty: ${project.difficulty}`,
      `Game language: ${gameLanguage}`,
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
- Profile language: ${profileLanguage || "(unset)"}
- Tagline: ${company.tagline ?? ""}
- Legal: ${company.legal_text ?? ""}
- Country: ${company.country ?? ""}
- Age rating: ${company.age_rating ?? ""}
${company.cover_design_brief ? `- Cover design brief (house style): ${company.cover_design_brief}` : ""}`
      : "(No company profile set yet — write generic copy.)";

    const frontFields = ["front_title_note", "tagline", "front_subtext", "front_bottom_explanation", "front_company_slogan", "front_logo_note"];
    const backFields = ["back_headline", "back_teaser", "back_body", "back_whats_in_box", "back_how_to_play", "back_feature_bullets", "back_specs", "back_content_note", "back_footer_text"];
    const fieldsRequested = field === "all"
      ? [...frontFields, ...backFields]
      : field === "front"
        ? frontFields
        : field === "back"
          ? backFields
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
Final language: ${gameLanguage} — but write the selling point in English (it's a planning field, not in-game text).`
      : `
Each field must follow these rules:
FRONT COVER TEXT
- "front_title_note": 1–2 short sentences describing a professional title lockup treatment.
- "tagline": 1 line, max 9 words, directly under the game name.
- "front_subtext": 1–2 short lines selling the case premise.
- "front_bottom_explanation": 1 concise sentence explaining the boxed game near the bottom of the cover.
- "front_company_slogan": use/adapt the company tagline when available; otherwise write a short brand slogan.
- "front_logo_note": short instruction for placing the company logo/brand mark on the front cover.

BACK COVER TEXT
- "back_headline": 1 punchy sentence, max 14 words, sets the stakes.
- "back_teaser": 1–2 cinematic setup sentences.
- "back_body": 80–130 words, paragraph form, mentions player role, ${docCount} documents (all in the box from the start) and ${envCount} sealed task envelopes (opened only at the matching beat in the case), age rating if known, but NEVER spoils the solution.
- "back_whats_in_box": line-separated list of physical contents. State that ALL ${docCount} case documents are loose in the box from the start, and that the ${envCount} sealed envelopes are task gates the player opens only when they reach the matching moment. Include props, evidence, and mini-movie QR when appropriate.
- "back_how_to_play": 2–4 clear sentences explaining the player experience. MUST clarify: all evidence documents are available immediately and the player works through them freely; the sealed envelopes are opened ONLY when the player reaches the specific case beat marked on each one (each envelope contains a task or a reveal — never new evidence to read at random). The final envelope holds the accusation/solution reveal.
- "back_feature_bullets": 3–5 line-separated selling bullets.
- "back_specs": packaging metadata, e.g. Ages, duration, players, difficulty.
- "back_content_note": optional spoiler-safe warning or tone note.
- "back_footer_text": company/legal/support footer text, using company profile details when available.

Voice: ${playbook.identity.brand_voice}
Final language: ${gameLanguage}.`;

    const system = `You are a senior copywriter for premium boxed murder-mystery games. You write tight, evocative marketing copy. You return ONLY a JSON object — no preamble, no markdown fences. Keys must match the requested fields exactly.\n\n${claudeSkillPromptBlock(enabledSkills, "marketing")}`;

    const userMsg = `PROJECT CONTEXT:
${ctx}

${companyBlock}

${fieldGuidance}

REQUESTED FIELDS: ${fieldsRequested.join(", ")}
${hint ? `\nEXTRA STEERING: ${hint}` : ""}

${isSellingPoint
  ? `Return JSON like {"selling_point": "..."} — single key, single 1–2 sentence value.`
  : `Return ONLY a JSON object with the requested keys. Each value must be a string.`}
`;

    const startedAt = Date.now();
    const callerUserId = await getUserIdFromAuth(req);
    const resp = await chatCompletions(withClaudeSkills({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMsg },
      ],
      temperature: 0.85,
      response_format: { type: "json_object" },
    }, enabledSkills));
    const fb = extractFallback(resp, model);

    if (!resp.ok) {
      const t = await resp.text();
      console.error("marketing-copy provider error", resp.status, t);
      const provider = model.startsWith("openai/") ? "OpenAI" : "Lovable AI";
      await logAiRun({
        userId: callerUserId, projectId, surface: "generate-marketing-copy",
        requestedModel: model, effectiveModel: fb.effectiveModel, fallback: fb.fallback,
        status: "error", latencyMs: Date.now() - startedAt,
        errorMessage: `${provider} ${resp.status}: ${t.slice(0, 200)}`,
        promptExcerpt: userMsg,
      });
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

    await logAiRun({
      userId: callerUserId, projectId, surface: "generate-marketing-copy",
      requestedModel: model, effectiveModel: fb.effectiveModel, fallback: fb.fallback,
      status: "ok", latencyMs: Date.now() - startedAt, promptExcerpt: userMsg,
    });
    if (isSellingPoint) {
      return new Response(JSON.stringify({ value: copy.selling_point, model, effectiveModel: fb.effectiveModel, fallback: fb.fallback }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ copy, model, effectiveModel: fb.effectiveModel, fallback: fb.fallback }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-marketing-copy error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
