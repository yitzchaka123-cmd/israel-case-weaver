// Image generation — supports OpenAI direct (gpt-image-*), Google Gemini direct
// (Nano Banana via GEMINI_API_KEY), and Lovable AI Gateway fallback. Can target
// media_assets, a suspect thumbnail, or a project cover.
//
// On every call we also: persist the prompt + history onto the corresponding
// row, return { requestedModel, effectiveModel, provider, fallback }, and log
// the run into ai_run_logs so the user can audit it later.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { generateImage, ImageGenError, logAiRun } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, prefer, openai-organization, openai-project, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY_PRIMARY = Deno.env.get("OpenAi") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_API_KEY_IMAGE2 = Deno.env.get("OPENAI_IMAGE2_API_KEY") ?? "";

function pickOpenAIKey(pref: string): { key: string; usedDedicated: boolean; missingName: string } {
  if (pref === "chatgpt-image-2" && OPENAI_API_KEY_IMAGE2) {
    return { key: OPENAI_API_KEY_IMAGE2, usedDedicated: true, missingName: "OPENAI_IMAGE2_API_KEY" };
  }
  return { key: OPENAI_API_KEY_PRIMARY, usedDedicated: false, missingName: "OpenAi" };
}

const IMAGE_MODEL: Record<string, string> = {
  "chatgpt-image-2": "gpt-image-2",
  "chatgpt-image": "gpt-image-1",
  "nano-banana-2": "google/gemini-3.1-flash-image-preview",
  "nano-banana-pro": "google/gemini-3-pro-image-preview",
  "nano-banana": "google/gemini-2.5-flash-image",
};
const OPENAI_KEYS = new Set(["chatgpt-image-2", "chatgpt-image"]);

function handleImageGenError(e: unknown, headers: Record<string, string>): Response {
  if (e instanceof ImageGenError) {
    const provider = e.provider === "gemini-direct" ? "Google Gemini" : "Lovable AI";
    console.error(`${provider} image error`, e.status, e.message);
    let raw = "";
    const m = e.message.match(/:\s*(\{.*\}|.+)$/);
    if (m) raw = m[1].slice(0, 300);
    if (e.status === 429) {
      return new Response(JSON.stringify({ error: `${provider} rate limit — wait a moment and try again. ${raw}` }), { status: 429, headers: { ...headers, "Content-Type": "application/json" } });
    }
    if (e.status === 402) {
      const msg = e.provider === "lovable-ai"
        ? `Your Lovable AI workspace is out of credits for this month. Three ways to fix it: (1) top up at Settings → Workspace → Usage in Lovable, (2) switch to "ChatGPT Image" in the model picker (uses your OpenAI key directly, no Lovable credits), (3) add a Google GEMINI_API_KEY in Settings → API keys to call Nano Banana directly and bypass the gateway entirely. (Gateway said: ${raw || "402 Payment Required"})`
        : `Google Gemini billing issue — check that billing is enabled for your Google AI Studio key. ${raw}`;
      return new Response(JSON.stringify({ error: msg }), { status: 402, headers: { ...headers, "Content-Type": "application/json" } });
    }
    if (e.status === 401 || e.status === 403) {
      return new Response(JSON.stringify({ error: `${provider} auth failed — check the API key in Settings → API keys. ${raw}` }), { status: e.status, headers: { ...headers, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: `${provider} image generation failed (${e.status}). ${raw}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
  }
  throw e;
}

type Target =
  | "media"
  | "suspect-thumbnail"
  | "suspect-alt-thumbnail"
  | "project-cover"
  | "envelope"
  | "hint-sheet";

type Quality = "low" | "medium" | "high";

interface Body {
  projectId: string;
  prompt: string;
  title?: string;
  category?: string;
  modelOverride?: string;
  target?: Target;
  targetId?: string;
  aspect?: "portrait" | "landscape" | "square";
  quality?: Quality;
}

async function getUserIdFromAuth(req: Request): Promise<string | null> {
  try {
    const authH = req.headers.get("Authorization") ?? "";
    const token = authH.replace(/^Bearer\s+/i, "");
    if (!token) return null;
    const supa = createClient(SUPABASE_URL, SERVICE);
    const { data } = await supa.auth.getUser(token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  let userId: string | null = null;
  let projectIdForLog: string | null = null;
  let requestedModelForLog = "";
  let targetIdForLog: string | null = null;
  let promptForLog = "";

  try {
    userId = await getUserIdFromAuth(req);
    const body = (await req.json()) as Body;
    const { projectId, prompt, title, category, modelOverride, targetId, aspect, quality } = body;
    const target: Target = body.target ?? "media";
    projectIdForLog = projectId ?? null;
    targetIdForLog = targetId ?? null;
    promptForLog = prompt ?? "";

    if (!projectId || !prompt) {
      return new Response(JSON.stringify({ error: "projectId and prompt required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL, SERVICE);

    const { data: project } = await supa
      .from("projects")
      .select("ai_provider_images, image_prompt_instructions")
      .eq("id", projectId)
      .single();

    const pref = (modelOverride || (project?.ai_provider_images as string) || "chatgpt-image");
    const model = IMAGE_MODEL[pref] ?? IMAGE_MODEL["chatgpt-image"];
    const useOpenAI = OPENAI_KEYS.has(pref);
    requestedModelForLog = model;

    const userImageInstructions = (project?.image_prompt_instructions as string ?? "").trim();
    const finalPrompt = userImageInstructions
      ? `USER GLOBAL IMAGE INSTRUCTIONS (apply to every image in this project — highest priority):\n${userImageInstructions}\n\n---\n\n${prompt}`
      : prompt;

    let mime = "image/png";
    let bytes: Uint8Array;
    let effectiveModel = model;
    let providerLabel: string = useOpenAI ? "openai-direct" : (Deno.env.get("GEMINI_API_KEY") ? "gemini-direct" : "lovable-ai");
    let fallbackLabel: "none" | "openai-direct" | "lovable-ai" = "none";

    const openAiPick = useOpenAI ? pickOpenAIKey(pref) : null;

    if (useOpenAI) {
      if (!openAiPick!.key) {
        const errMsg = `OpenAI API key not configured (missing ${openAiPick!.missingName})`;
        await logAiRun({ userId, projectId: projectIdForLog, surface: "generate-image", requestedModel: requestedModelForLog, status: "error", errorMessage: errMsg, latencyMs: Date.now() - startedAt, targetId: targetIdForLog, promptExcerpt: promptForLog });
        return new Response(JSON.stringify({ error: errMsg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const ar = aspect ?? (target.startsWith("suspect") || target === "project-cover" || target === "envelope" || target === "hint-sheet" ? "portrait" : "landscape");
      const size = ar === "portrait" ? "1024x1536" : ar === "landscape" ? "1536x1024" : "1024x1024";
      const q: Quality = quality ?? "medium";

      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 145_000);

      let oResp: Response;
      try {
        oResp = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          signal: ctrl.signal,
          headers: { Authorization: `Bearer ${openAiPick!.key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            prompt: finalPrompt,
            size,
            quality: q,
            n: 1,
            moderation: "auto",
            output_format: "jpeg",
            output_compression: 90,
          }),
        });
      } catch (e) {
        clearTimeout(timeoutId);
        if (e instanceof Error && e.name === "AbortError") {
          await logAiRun({ userId, projectId: projectIdForLog, surface: "generate-image", requestedModel: requestedModelForLog, status: "error", errorMessage: "OpenAI image timeout (>145s)", latencyMs: Date.now() - startedAt, targetId: targetIdForLog, promptExcerpt: promptForLog });
          return new Response(
            JSON.stringify({ error: `OpenAI took too long (>145s). Try Medium or Low quality, or switch to a Gemini "Nano Banana" model.` }),
            { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        throw e;
      }
      clearTimeout(timeoutId);
      if (!oResp.ok) {
        const t = await oResp.text();
        const requestId = oResp.headers.get("x-request-id") ?? "";
        console.error("openai image error", oResp.status, requestId, t);
        let detail = t;
        try {
          const parsed = JSON.parse(t);
          detail = parsed?.error?.message ?? t;
        } catch { /* keep raw text */ }
        const tail = requestId ? ` (request_id: ${requestId})` : "";
        const isVerify = /verified to use the model/i.test(detail);
        const friendly = isVerify
          ? `OpenAI requires organization verification to use ${model}. Open https://platform.openai.com/settings/organization/general → "Verify Organization". After verifying it can take up to 15 min. (Tip: switch to "ChatGPT Image 1" or a Gemini model in the meantime.)${tail}`
          : (detail || "OpenAI image generation failed") + tail;
        await logAiRun({ userId, projectId: projectIdForLog, surface: "generate-image", requestedModel: requestedModelForLog, status: "error", errorMessage: friendly, latencyMs: Date.now() - startedAt, targetId: targetIdForLog, promptExcerpt: promptForLog });
        if (oResp.status === 429) return new Response(JSON.stringify({ error: `OpenAI rate limit: ${detail}${tail}` }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (oResp.status === 401) return new Response(JSON.stringify({ error: `OpenAI auth failed — check the OpenAI API key in Settings. ${detail}${tail}` }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (oResp.status === 403) return new Response(JSON.stringify({ error: friendly }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (oResp.status === 400) return new Response(JSON.stringify({ error: `OpenAI rejected request: ${detail}${tail}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        return new Response(JSON.stringify({ error: friendly }), { status: oResp.status || 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const oData = await oResp.json();
      const b64: string | undefined = oData.data?.[0]?.b64_json;
      if (!b64) {
        await logAiRun({ userId, projectId: projectIdForLog, surface: "generate-image", requestedModel: requestedModelForLog, status: "error", errorMessage: "No image returned (OpenAI)", latencyMs: Date.now() - startedAt, targetId: targetIdForLog, promptExcerpt: promptForLog });
        return new Response(JSON.stringify({ error: "No image returned (OpenAI)" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      mime = "image/jpeg";
      providerLabel = openAiPick!.usedDedicated ? "openai-image2" : "openai-direct";
      effectiveModel = model;
    } else {
      const hasGeminiDirect = !!Deno.env.get("GEMINI_API_KEY");
      const FALLBACK_MODEL = "google/gemini-2.5-flash-image";
      const tryGenerate = async (m: string) => generateImage({ prompt: finalPrompt, model: m });

      try {
        const result = await tryGenerate(model);
        bytes = result.bytes;
        mime = result.mime;
        providerLabel = result.provider;
      } catch (e) {
        const canFallback =
          e instanceof ImageGenError &&
          e.status === 402 &&
          e.provider === "lovable-ai" &&
          !hasGeminiDirect &&
          model !== FALLBACK_MODEL;

        if (canFallback) {
          console.warn(`gateway 402 on ${model} — falling back to ${FALLBACK_MODEL}`);
          try {
            const result = await tryGenerate(FALLBACK_MODEL);
            bytes = result.bytes;
            mime = result.mime;
            providerLabel = result.provider;
            effectiveModel = FALLBACK_MODEL;
            fallbackLabel = "lovable-ai";
          } catch (e2) {
            const errMsg = e2 instanceof Error ? e2.message : "image gen failed";
            await logAiRun({ userId, projectId: projectIdForLog, surface: "generate-image", requestedModel: requestedModelForLog, status: "error", errorMessage: errMsg, latencyMs: Date.now() - startedAt, targetId: targetIdForLog, promptExcerpt: promptForLog });
            return handleImageGenError(e2, corsHeaders);
          }
        } else {
          const errMsg = e instanceof Error ? e.message : "image gen failed";
          await logAiRun({ userId, projectId: projectIdForLog, surface: "generate-image", requestedModel: requestedModelForLog, status: "error", errorMessage: errMsg, latencyMs: Date.now() - startedAt, targetId: targetIdForLog, promptExcerpt: promptForLog });
          return handleImageGenError(e, corsHeaders);
        }
      }
    }

    const ext = mime === "image/jpeg" ? "jpg" : (mime.split("/")[1] ?? "png");

    let bucket = "media";
    let path = `${projectId}/${category ?? "generated"}/${Date.now()}.${ext}`;
    if (target === "suspect-thumbnail" || target === "suspect-alt-thumbnail") {
      bucket = "suspects";
      path = `${projectId}/${targetId ?? "x"}-${target === "suspect-alt-thumbnail" ? "alt-" : ""}${Date.now()}.${ext}`;
    } else if (target === "project-cover") {
      bucket = "covers";
      path = `${projectId}/${Date.now()}.${ext}`;
    } else if (target === "envelope") {
      bucket = "media";
      path = `${projectId}/envelopes/${targetId ?? "x"}-${Date.now()}.${ext}`;
    } else if (target === "hint-sheet") {
      bucket = "media";
      path = `${projectId}/hint-sheets/${targetId ?? "x"}-${Date.now()}.${ext}`;
    }

    const { error: upErr } = await supa.storage.from(bucket).upload(path, bytes, { contentType: mime, upsert: true });
    if (upErr) {
      console.error("upload error", upErr);
      await logAiRun({ userId, projectId: projectIdForLog, surface: "generate-image", requestedModel: requestedModelForLog, effectiveModel, fallback: fallbackLabel, status: "error", errorMessage: upErr.message, latencyMs: Date.now() - startedAt, targetId: targetIdForLog, promptExcerpt: promptForLog });
      return new Response(JSON.stringify({ error: upErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: pub } = supa.storage.from(bucket).getPublicUrl(path);

    let asset: any = null;
    const historyEntry = {
      at: new Date().toISOString(),
      prompt,
      effective_model: effectiveModel,
      requested_model: requestedModelForLog,
      fallback: fallbackLabel,
      provider: providerLabel,
    };

    // Persist prompt + provenance per target. Each branch keeps a JSON history
    // array so the user can always see "what generated this image" and
    // browse previous attempts.
    if (target === "media") {
      const { data, error } = await supa.from("media_assets").insert({
        project_id: projectId,
        category: category ?? "external",
        title: title ?? null,
        url: pub.publicUrl,
        prompt,
        provider: providerLabel,
        model,
        effective_model: effectiveModel,
        fallback: fallbackLabel,
        prompt_history: [historyEntry],
        mime_type: mime,
      } as any).select().single();
      if (error) {
        await logAiRun({ userId, projectId: projectIdForLog, surface: "generate-image", requestedModel: requestedModelForLog, effectiveModel, fallback: fallbackLabel, status: "error", errorMessage: error.message, latencyMs: Date.now() - startedAt, targetId: targetIdForLog, promptExcerpt: promptForLog });
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      asset = data;
    } else if ((target === "suspect-thumbnail" || target === "suspect-alt-thumbnail") && targetId) {
      const isAlt = target === "suspect-alt-thumbnail";
      const { data: prior } = await supa.from("suspects").select(isAlt ? "alt_thumbnail_prompt_history" : "thumbnail_prompt_history").eq("id", targetId).single();
      const priorHist = ((prior as any)?.[isAlt ? "alt_thumbnail_prompt_history" : "thumbnail_prompt_history"] ?? []) as any[];
      const update: Record<string, unknown> = isAlt
        ? {
            alt_thumbnail_url: pub.publicUrl,
            alt_thumbnail_prompt: prompt,
            alt_thumbnail_effective_model: effectiveModel,
            alt_thumbnail_fallback: fallbackLabel,
            alt_thumbnail_prompt_history: [historyEntry, ...priorHist].slice(0, 20),
          }
        : {
            thumbnail_url: pub.publicUrl,
            thumbnail_prompt: prompt,
            thumbnail_effective_model: effectiveModel,
            thumbnail_fallback: fallbackLabel,
            thumbnail_prompt_history: [historyEntry, ...priorHist].slice(0, 20),
          };
      await supa.from("suspects").update(update as any).eq("id", targetId);
    } else if (target === "project-cover") {
      const { data: prior } = await supa.from("projects").select("cover_prompt_history").eq("id", projectId).single();
      const priorHist = ((prior as any)?.cover_prompt_history ?? []) as any[];
      await supa.from("projects").update({
        cover_image_url: pub.publicUrl,
        cover_prompt: prompt,
        cover_effective_model: effectiveModel,
        cover_fallback: fallbackLabel,
        cover_prompt_history: [historyEntry, ...priorHist].slice(0, 20),
      } as any).eq("id", projectId);
    } else if (target === "envelope" && targetId) {
      const { data: prior } = await supa.from("envelopes").select("cover_prompt_history").eq("id", targetId).single();
      const priorHist = ((prior as any)?.cover_prompt_history ?? []) as any[];
      await supa.from("envelopes").update({
        cover_image_url: pub.publicUrl,
        status: "review",
        cover_prompt: prompt,
        cover_effective_model: effectiveModel,
        cover_fallback: fallbackLabel,
        cover_prompt_history: [historyEntry, ...priorHist].slice(0, 20),
      } as any).eq("id", targetId);
    } else if (target === "hint-sheet" && targetId) {
      // targetId is the stage number as a string (e.g. "1", "2"…)
      const stageNum = Number.parseInt(targetId, 10);
      if (Number.isFinite(stageNum)) {
        const { data: prior } = await supa
          .from("hint_sheets")
          .select("prompt_history")
          .eq("project_id", projectId)
          .eq("stage", stageNum)
          .maybeSingle();
        const priorHist = ((prior as any)?.prompt_history ?? []) as any[];
        await supa.from("hint_sheets").upsert({
          project_id: projectId,
          stage: stageNum,
          image_url: pub.publicUrl,
          prompt,
          requested_model: requestedModelForLog,
          effective_model: effectiveModel,
          fallback: fallbackLabel,
          prompt_history: [historyEntry, ...priorHist].slice(0, 20),
          updated_at: new Date().toISOString(),
        } as any, { onConflict: "project_id,stage" });
      }
    }

    await supa.from("prompts").insert({
      project_id: projectId,
      scope: target,
      target_id: targetId ?? asset?.id ?? null,
      original_prompt: prompt,
      final_prompt: finalPrompt,
      provider: providerLabel,
      model: effectiveModel,
    });

    await logAiRun({
      userId,
      projectId: projectIdForLog,
      surface: "generate-image",
      requestedModel: requestedModelForLog,
      effectiveModel,
      fallback: fallbackLabel,
      status: "ok",
      latencyMs: Date.now() - startedAt,
      targetId: targetId ?? asset?.id ?? null,
      promptExcerpt: prompt,
    });

    return new Response(
      JSON.stringify({
        asset,
        url: pub.publicUrl,
        requestedModel: requestedModelForLog,
        effectiveModel,
        fallback: fallbackLabel,
        provider: providerLabel,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("generate-image error", e);
    const errMsg = e instanceof Error ? e.message : "Unknown";
    await logAiRun({ userId, projectId: projectIdForLog, surface: "generate-image", requestedModel: requestedModelForLog, status: "error", errorMessage: errMsg, latencyMs: Date.now() - startedAt, targetId: targetIdForLog, promptExcerpt: promptForLog });
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
