// Image generation via Lovable AI Gateway (Nano Banana / Gemini image models)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { projectId, category, prompt, title, targetId, scope } = await req.json();
    if (!projectId || !prompt) {
      return new Response(JSON.stringify({ error: "projectId and prompt required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL, SERVICE);

    const model = "google/gemini-2.5-flash-image";
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
      }),
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
    if (!imageUrl) {
      console.error("No image in response", JSON.stringify(data).slice(0, 400));
      return new Response(JSON.stringify({ error: "No image returned" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // imageUrl is a data URL like data:image/png;base64,...
    const match = imageUrl.match(/^data:([^;]+);base64,(.*)$/);
    if (!match) {
      return new Response(JSON.stringify({ error: "Unexpected image format" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const mime = match[1];
    const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
    const ext = mime.split("/")[1] ?? "png";
    const path = `${projectId}/${category ?? "generated"}/${Date.now()}.${ext}`;

    const { error: upErr } = await supa.storage.from("media").upload(path, bytes, {
      contentType: mime,
      upsert: true,
    });
    if (upErr) {
      console.error("upload error", upErr);
      return new Response(JSON.stringify({ error: upErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: pub } = supa.storage.from("media").getPublicUrl(path);

    // Store media record
    const { data: asset, error: insErr } = await supa.from("media_assets").insert({
      project_id: projectId,
      category: category ?? "external",
      title: title ?? null,
      url: pub.publicUrl,
      prompt,
      provider: "lovable-ai",
      model,
      mime_type: mime,
    }).select().single();
    if (insErr) {
      return new Response(JSON.stringify({ error: insErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Also store prompt history
    await supa.from("prompts").insert({
      project_id: projectId,
      scope: scope ?? "media",
      target_id: targetId ?? asset.id,
      original_prompt: prompt,
      final_prompt: prompt,
      provider: "lovable-ai",
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
