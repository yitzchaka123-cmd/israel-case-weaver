// Image generation — supports Lovable AI Gateway (Nano Banana / Gemini) AND
// OpenAI direct (gpt-image-1 / "ChatGPT Image"). Can target media_assets, a
// suspect thumbnail, or a project cover.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OpenAi") ?? Deno.env.get("OPENAI_API_KEY") ?? "";

const IMAGE_MODEL: Record<string, string> = {
  "chatgpt-image-2": "gpt-image-2", // OpenAI direct — latest (2026-04-21)
  "chatgpt-image": "gpt-image-1",   // OpenAI direct — previous gen
  "nano-banana-2": "google/gemini-3.1-flash-image-preview",
  "nano-banana-pro": "google/gemini-3-pro-image-preview",
  "nano-banana": "google/gemini-2.5-flash-image",
};
const OPENAI_KEYS = new Set(["chatgpt-image-2", "chatgpt-image"]);

// target = "media" (default, inserts media_assets row)
//        | "suspect-thumbnail" | "suspect-alt-thumbnail"  (updates suspects row)
//        | "project-cover" (updates projects.cover_image_url)
type Target =
  | "media"
  | "suspect-thumbnail"
  | "suspect-alt-thumbnail"
  | "project-cover";

interface Body {
  projectId: string;
  prompt: string;
  title?: string;
  category?: string;
  modelOverride?: string;
  target?: Target;
  targetId?: string; // suspect id when target is suspect-*
  aspect?: "portrait" | "landscape" | "square";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    const { projectId, prompt, title, category, modelOverride, targetId, aspect } = body;
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
      // Suspect thumbnails are 3:4 portrait; covers are 3:4 portrait too; media defaults landscape.
      const ar = aspect ?? (target.startsWith("suspect") || target === "project-cover" ? "portrait" : "landscape");
      const size = ar === "portrait" ? "1024x1536" : ar === "landscape" ? "1536x1024" : "1024x1024";
      const oResp = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: finalPrompt, size, quality: "high", n: 1 }),
      });
      if (!oResp.ok) {
        const t = await oResp.text();
        console.error("openai image error", oResp.status, t);
        if (oResp.status === 429) return new Response(JSON.stringify({ error: "OpenAI rate limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        return new Response(JSON.stringify({ error: "OpenAI image generation failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const oData = await oResp.json();
      const b64: string | undefined = oData.data?.[0]?.b64_json;
      if (!b64) return new Response(JSON.stringify({ error: "No image returned (OpenAI)" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      mime = "image/png";
    } else {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: finalPrompt }], modalities: ["image", "text"] }),
      });
      if (!resp.ok) {
        if (resp.status === 429) return new Response(JSON.stringify({ error: "Rate limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (resp.status === 402) return new Response(JSON.stringify({ error: "Out of credits" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const t = await resp.text();
        console.error("image gen error", resp.status, t);
        return new Response(JSON.stringify({ error: "Image generation failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const data = await resp.json();
      const imageUrl: string | undefined = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      const m = imageUrl?.match(/^data:([^;]+);base64,(.*)$/);
      if (!m) return new Response(JSON.stringify({ error: "No image returned" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      mime = m[1];
      bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    }

    const ext = mime.split("/")[1] ?? "png";

    // Pick bucket + path + post-write logic per target
    let bucket = "media";
    let path = `${projectId}/${category ?? "generated"}/${Date.now()}.${ext}`;
    if (target === "suspect-thumbnail" || target === "suspect-alt-thumbnail") {
      bucket = "suspects";
      path = `${projectId}/${targetId ?? "x"}-${target === "suspect-alt-thumbnail" ? "alt-" : ""}${Date.now()}.${ext}`;
    } else if (target === "project-cover") {
      bucket = "covers";
      path = `${projectId}/${Date.now()}.${ext}`;
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
        provider: useOpenAI ? "openai" : "lovable-ai",
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
    }

    await supa.from("prompts").insert({
      project_id: projectId,
      scope: target,
      target_id: targetId ?? asset?.id ?? null,
      original_prompt: prompt,
      final_prompt: finalPrompt,
      provider: useOpenAI ? "openai" : "lovable-ai",
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
