// Image generation — supports OpenAI direct (gpt-image-*), Google Gemini direct
// (Nano Banana via GEMINI_API_KEY), and Lovable AI Gateway fallback. Can target
// media_assets, a suspect thumbnail, or a project cover.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { generateImage, ImageGenError } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, prefer, openai-organization, openai-project, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OpenAi") ?? Deno.env.get("OPENAI_API_KEY") ?? "";

// Per OpenAI image API docs (Apr 2026):
//   gpt-image-2     — current flagship; best quality, ~30–120 s depending on quality.
//                     "high" can take up to 2 min; "medium" is the recommended sweet spot.
//   gpt-image-1.5   — incremental update on gpt-image-1, available.
//   gpt-image-1     — legacy generation, faster but lower fidelity.
//   gpt-image-1-mini — cheap/fast option for drafts.
const IMAGE_MODEL: Record<string, string> = {
  "chatgpt-image-2": "gpt-image-2", // OpenAI direct — current flagship
  "chatgpt-image": "gpt-image-1",   // OpenAI direct — legacy
  "nano-banana-2": "google/gemini-3.1-flash-image-preview",
  "nano-banana-pro": "google/gemini-3-pro-image-preview",
  "nano-banana": "google/gemini-2.5-flash-image",
};
const OPENAI_KEYS = new Set(["chatgpt-image-2", "chatgpt-image"]);

// Build an actionable error response for image-gen failures coming from the
// Lovable AI Gateway or direct Google Gemini. Surfaces 3 concrete fixes when
// credits are exhausted so the user knows exactly what to do next.
function handleImageGenError(e: unknown, headers: Record<string, string>): Response {
  if (e instanceof ImageGenError) {
    const provider = e.provider === "gemini-direct" ? "Google Gemini" : "Lovable AI";
    console.error(`${provider} image error`, e.status, e.message);

    // Try to extract the gateway's raw error body for transparency.
    let raw = "";
    const m = e.message.match(/:\s*(\{.*\}|.+)$/);
    if (m) raw = m[1].slice(0, 300);

    if (e.status === 429) {
      return new Response(
        JSON.stringify({ error: `${provider} rate limit — wait a moment and try again. ${raw}` }),
        { status: 429, headers: { ...headers, "Content-Type": "application/json" } },
      );
    }
    if (e.status === 402) {
      const msg = e.provider === "lovable-ai"
        ? `Your Lovable AI workspace is out of credits for this month. Three ways to fix it: ` +
          `(1) top up at Settings → Workspace → Usage in Lovable, ` +
          `(2) switch to "ChatGPT Image" in the model picker (uses your OpenAI key directly, no Lovable credits), ` +
          `(3) add a Google GEMINI_API_KEY in Settings → API keys to call Nano Banana directly and bypass the gateway entirely. ` +
          `(Gateway said: ${raw || "402 Payment Required"})`
        : `Google Gemini billing issue — check that billing is enabled for your Google AI Studio key. ${raw}`;
      return new Response(
        JSON.stringify({ error: msg }),
        { status: 402, headers: { ...headers, "Content-Type": "application/json" } },
      );
    }
    if (e.status === 401 || e.status === 403) {
      return new Response(
        JSON.stringify({ error: `${provider} auth failed — check the API key in Settings → API keys. ${raw}` }),
        { status: e.status, headers: { ...headers, "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ error: `${provider} image generation failed (${e.status}). ${raw}` }),
      { status: 500, headers: { ...headers, "Content-Type": "application/json" } },
    );
  }
  throw e;
}

// target = "media" (default, inserts media_assets row)
//        | "suspect-thumbnail" | "suspect-alt-thumbnail"  (updates suspects row)
//        | "project-cover" (updates projects.cover_image_url)
//        | "envelope" (updates envelopes.cover_image_url for the given targetId)
type Target =
  | "media"
  | "suspect-thumbnail"
  | "suspect-alt-thumbnail"
  | "project-cover"
  | "envelope";

type Quality = "low" | "medium" | "high";

interface Body {
  projectId: string;
  prompt: string;
  title?: string;
  category?: string;
  modelOverride?: string;
  target?: Target;
  targetId?: string; // suspect id when target is suspect-*; envelope id when target is envelope
  aspect?: "portrait" | "landscape" | "square";
  quality?: Quality;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    const { projectId, prompt, title, category, modelOverride, targetId, aspect, quality } = body;
    const target: Target = body.target ?? "media";

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

    const userImageInstructions = (project?.image_prompt_instructions as string ?? "").trim();
    const finalPrompt = userImageInstructions
      ? `USER GLOBAL IMAGE INSTRUCTIONS (apply to every image in this project — highest priority):\n${userImageInstructions}\n\n---\n\n${prompt}`
      : prompt;

    let mime = "image/png";
    let bytes: Uint8Array;

    if (useOpenAI) {
      if (!OPENAI_API_KEY) {
        return new Response(JSON.stringify({ error: "OpenAI API key not configured" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Suspect thumbnails are 3:4 portrait; covers are 3:4 portrait too;
      // envelopes are 3:4 portrait (front of envelope); media defaults landscape.
      const ar = aspect ?? (target.startsWith("suspect") || target === "project-cover" || target === "envelope" ? "portrait" : "landscape");
      const size = ar === "portrait" ? "1024x1536" : ar === "landscape" ? "1536x1024" : "1024x1024";
      // Default to "medium" — per OpenAI docs this is the latency/quality sweet spot.
      // "high" can take up to 2 min and risks exceeding the edge function timeout.
      const q: Quality = quality ?? "medium";

      // 110 s abort: edge function platform timeout is ~150s — give us headroom
      // to translate the abort into a clean 504 instead of being killed.
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 110_000);

      let oResp: Response;
      try {
        oResp = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          signal: ctrl.signal,
          headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
          // jpeg + compression 90 is dramatically faster than png per OpenAI docs.
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
          return new Response(
            JSON.stringify({ error: `OpenAI took too long (>110s). Try Medium or Low quality, or switch to a Gemini "Nano Banana" model.` }),
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
        // Surface OpenAI's actual error message so the user sees actionable info
        // (e.g. "organization must be verified to use gpt-image-2").
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
        if (oResp.status === 429) return new Response(JSON.stringify({ error: `OpenAI rate limit: ${detail}${tail}` }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (oResp.status === 401) return new Response(JSON.stringify({ error: `OpenAI auth failed — check the OpenAI API key in Settings. ${detail}${tail}` }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (oResp.status === 403) return new Response(JSON.stringify({ error: friendly }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (oResp.status === 400) return new Response(JSON.stringify({ error: `OpenAI rejected request: ${detail}${tail}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        return new Response(JSON.stringify({ error: friendly }), { status: oResp.status || 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const oData = await oResp.json();
      const b64: string | undefined = oData.data?.[0]?.b64_json;
      if (!b64) return new Response(JSON.stringify({ error: "No image returned (OpenAI)" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      mime = "image/jpeg";
    } else {
      const hasGeminiDirect = !!Deno.env.get("GEMINI_API_KEY");
      const FALLBACK_MODEL = "google/gemini-2.5-flash-image";
      const tryGenerate = async (m: string) => generateImage({ prompt: finalPrompt, model: m });

      try {
        const result = await tryGenerate(model);
        bytes = result.bytes;
        mime = result.mime;
      } catch (e) {
        // Auto-fallback: if we hit 402 on the Lovable gateway with a Pro/preview
        // Nano Banana model and we don't have a direct Google key, try the
        // cheapest variant once before erroring.
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
          } catch (e2) {
            return handleImageGenError(e2, corsHeaders);
          }
        } else {
          return handleImageGenError(e, corsHeaders);
        }
      }
    }

    const ext = mime === "image/jpeg" ? "jpg" : (mime.split("/")[1] ?? "png");

    // Pick bucket + path + post-write logic per target
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
    }

    const { error: upErr } = await supa.storage.from(bucket).upload(path, bytes, { contentType: mime, upsert: true });
    if (upErr) {
      console.error("upload error", upErr);
      return new Response(JSON.stringify({ error: upErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: pub } = supa.storage.from(bucket).getPublicUrl(path);

    let asset: any = null;

    if (target === "media") {
      const { data, error } = await supa.from("media_assets").insert({
        project_id: projectId,
        category: category ?? "external",
        title: title ?? null,
        url: pub.publicUrl,
        prompt,
        provider: useOpenAI ? "openai" : (Deno.env.get("GEMINI_API_KEY") ? "gemini-direct" : "lovable-ai"),
        model,
        mime_type: mime,
      }).select().single();
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      asset = data;
    } else if (target === "suspect-thumbnail" && targetId) {
      await supa.from("suspects").update({ thumbnail_url: pub.publicUrl }).eq("id", targetId);
    } else if (target === "suspect-alt-thumbnail" && targetId) {
      await supa.from("suspects").update({ alt_thumbnail_url: pub.publicUrl }).eq("id", targetId);
    } else if (target === "project-cover") {
      await supa.from("projects").update({ cover_image_url: pub.publicUrl }).eq("id", projectId);
    } else if (target === "envelope" && targetId) {
      await supa.from("envelopes").update({ cover_image_url: pub.publicUrl, status: "review" }).eq("id", targetId);
    }

    await supa.from("prompts").insert({
      project_id: projectId,
      scope: target,
      target_id: targetId ?? asset?.id ?? null,
      original_prompt: prompt,
      final_prompt: finalPrompt,
      provider: useOpenAI ? "openai" : (Deno.env.get("GEMINI_API_KEY") ? "gemini-direct" : "lovable-ai"),
      model,
    });

    return new Response(JSON.stringify({ asset, url: pub.publicUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-image error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
