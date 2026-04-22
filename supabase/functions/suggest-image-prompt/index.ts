// Generates a contextually-aware image prompt for a project, using the
// project's title/genre/setting/suspects/etc. so the resulting image fits the
// rest of the game. Routes through the shared AI router (OpenAI direct when
// the user picked an openai/* planning model, otherwise Lovable AI Gateway).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chatCompletions } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PLANNING_MODEL: Record<string, string> = {
  "gpt-5.2": "openai/gpt-5.2",
  "gpt-5": "openai/gpt-5",
  "gpt-5-mini": "openai/gpt-5-mini",
  "gpt-5-nano": "openai/gpt-5-nano",
  "gemini-2.5-pro": "google/gemini-2.5-pro",
  "gemini-2.5-flash": "google/gemini-2.5-flash",
  "gemini-3.1-pro": "google/gemini-3.1-pro-preview",
  "gemini-3-flash": "google/gemini-3-flash-preview",
};

const CATEGORY_GUIDANCE: Record<string, string> = {
  cover: "Front cover art for the boxed mystery game. Eye-catching, evocative, hints at the case without spoiling it. Genre-appropriate atmosphere. Title space friendly (composition leaves room near top).",
  back: "Back-of-box hero illustration. Shows tone and stakes. Slightly more revealing than the cover but still spoiler-free.",
  news: "A still frame as if from a televised news report covering the case. Lower-third / chyron friendly. Photorealistic, broadcast feel.",
  promo: "Cinematic key art / promo still that could anchor a short trailer. Dramatic lighting, strong silhouette.",
  external: "A general supporting visual related to the case world.",
};

interface Body {
  projectId: string;
  category?: string;
  hint?: string; // optional user steering ("focus on the rainy alley")
  currentPrompt?: string; // if revising
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    const { projectId, category = "cover", hint, currentPrompt } = body;
    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL, SERVICE);

    const { data: project } = await supa
      .from("projects")
      .select("title, subtitle, genre, setting, year, mystery_type, player_role, case_goal, selling_point, image_prompt_instructions, ai_provider_planning")
      .eq("id", projectId)
      .single();

    if (!project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: suspects } = await supa
      .from("suspects")
      .select("name, role_in_case, summary")
      .eq("project_id", projectId)
      .order("position")
      .limit(8);

    const projectKey = (project.ai_provider_planning as string) || "gemini-2.5-flash";
    const model = PLANNING_MODEL[projectKey] ?? "google/gemini-2.5-flash";

    const ctx = [
      project.title && `Title: ${project.title}`,
      project.subtitle && `Subtitle: ${project.subtitle}`,
      project.genre && `Genre: ${project.genre}`,
      project.mystery_type && `Mystery type: ${project.mystery_type}`,
      project.setting && `Setting: ${project.setting}`,
      project.year && `Year: ${project.year}`,
      project.player_role && `Player role: ${project.player_role}`,
      project.case_goal && `Case goal: ${project.case_goal}`,
      project.selling_point && `Selling point: ${project.selling_point}`,
      project.image_prompt_instructions && `Global image style notes: ${project.image_prompt_instructions}`,
      suspects?.length && `Key characters: ${suspects.map((s) => `${s.name}${s.role_in_case ? ` (${s.role_in_case})` : ""}`).join("; ")}`,
    ].filter(Boolean).join("\n");

    const guidance = CATEGORY_GUIDANCE[category] ?? CATEGORY_GUIDANCE.external;

    const system = `You are an expert art director for boxed murder-mystery games. You write concise, vivid image-generation prompts (3–6 sentences) that an image model like Gemini Nano Banana or OpenAI gpt-image will turn into a single still image. Focus on subject, composition, lighting, mood, color palette, medium/style, and lens. No camera-shake instructions, no text overlays unless requested. Never output anything except the prompt itself.`;

    const userMsg = `PROJECT CONTEXT:\n${ctx || "(no context yet)"}\n\nIMAGE PURPOSE: ${category.toUpperCase()} — ${guidance}${
      hint ? `\n\nUSER STEERING: ${hint}` : ""
    }${currentPrompt ? `\n\nPREVIOUS PROMPT (revise / improve, don't repeat verbatim):\n${currentPrompt}` : ""}\n\nWrite the new image prompt now. Only the prompt — no preamble, no quotes, no markdown.`;

    const resp = await chatCompletions({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMsg },
      ],
      temperature: 0.9,
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("suggest-image-prompt provider error", resp.status, t);
      const provider = model.startsWith("openai/") ? "OpenAI" : "Lovable AI";
      if (resp.status === 429) {
        return new Response(JSON.stringify({ error: `${provider} rate limit — try again shortly.` }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (resp.status === 402) {
        return new Response(JSON.stringify({ error: `${provider} credits/key issue (status 402). Add funds or check your key.` }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `${provider} error (status ${resp.status})` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const text: string = (data.choices?.[0]?.message?.content ?? "").trim();
    if (!text) {
      return new Response(JSON.stringify({ error: "Model returned an empty prompt" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ prompt: text, model }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("suggest-image-prompt error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
