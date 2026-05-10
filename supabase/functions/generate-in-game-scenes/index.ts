// generate-in-game-scenes — fires ONE gpt-image-2 call with n=4 so the four
// in-game scene panels come back as a style-shared batch. The brand reference
// image (if any) is attached so all four images inherit the publisher's
// palette/lighting/illustration technique. Each result is saved as a
// `media_assets` row with category='in-game-scene', title=scene label.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { logAiRun } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, prefer",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY_PRIMARY = Deno.env.get("OpenAi") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_API_KEY_IMAGE2 = Deno.env.get("OPENAI_IMAGE2_API_KEY") ?? "";

interface Scene { label: string; prompt: string }
interface Body {
  projectId: string;
  scenes: Scene[];
  referenceImageUrl?: string | null;
  referenceLabel?: string | null;
  quality?: "low" | "medium" | "high";
}

async function fetchReferenceImage(url: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.byteLength > 8 * 1024 * 1024) return null;
    const mime = r.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
    return { bytes: buf, mime };
  } catch {
    return null;
  }
}

async function getUserIdFromAuth(req: Request): Promise<string | null> {
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return null;
    const supa = createClient(SUPABASE_URL, SERVICE);
    const { data } = await supa.auth.getUser(token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

async function uploadImage(supa: ReturnType<typeof createClient>, path: string, b64: string): Promise<string | null> {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const { error } = await supa.storage.from("media").upload(path, bytes, {
    contentType: "image/jpeg", upsert: true,
  });
  if (error) {
    console.error(`upload media/${path} failed:`, error.message);
    return null;
  }
  const { data: pub } = supa.storage.from("media").getPublicUrl(path);
  return pub.publicUrl;
}

function composeBatchPrompt(scenes: Scene[], publisher: string | null, hasRef: boolean): string {
  const refLine = hasRef
    ? `Match the SAME palette, lighting, illustration technique and paper finish as the attached REFERENCE IMAGE (${publisher ? `publisher: ${publisher}` : "house style"}). Treat the reference as the world's color/lighting bible. Do NOT copy its scene.`
    : `All four images must share the SAME palette, lighting, and illustration technique${publisher ? ` (publisher: ${publisher})` : ""}.`;
  const list = scenes.map((s, i) =>
    `IMAGE ${i + 1} — ${s.label || `Scene ${i + 1}`}\n${(s.prompt || "").trim() || "(no extra direction)"}`,
  ).join("\n\n");
  return `You are producing a FOUR-IMAGE BATCH of in-game scenes for the SAME boxed murder-mystery game.

CRITICAL — WORLD CONTINUITY:
${refLine}
All four scenes must look like glimpses INSIDE the same case world: shared color palette, shared lighting mood, shared illustration technique. They will sit on the back of the same physical box together.

Each image: square-ish, print-ready, NO on-image text, NO logos, NO UI overlays.

================================
${list}
================================

Return FOUR images in order. Image 1 = scene 1, Image 2 = scene 2, Image 3 = scene 3, Image 4 = scene 4.`;
}

async function runBatch(body: Body, userId: string | null, jobIds: string[]): Promise<void> {
  const supa = createClient(SUPABASE_URL, SERVICE);
  const startedAt = Date.now();
  const model = "gpt-image-2";
  const apiKey = OPENAI_API_KEY_IMAGE2 || OPENAI_API_KEY_PRIMARY;
  const combinedPrompt = composeBatchPrompt(body.scenes, body.referenceLabel ?? null, !!body.referenceImageUrl);
  const promptExcerpt = (body.referenceImageUrl ? `[brand-ref:${body.referenceImageUrl.slice(0, 80)}] ` : "") + combinedPrompt.slice(0, 4000);

  const failAll = async (msg: string) => {
    if (jobIds.length) {
      await supa.from("image_generations").update({
        status: "error", error_message: msg, updated_at: new Date().toISOString(),
      } as any).in("id", jobIds);
    }
    await logAiRun({
      userId, projectId: body.projectId, surface: "generate-in-game-scenes",
      requestedModel: model, status: "error", errorMessage: msg,
      latencyMs: Date.now() - startedAt, promptExcerpt,
    });
  };

  if (!apiKey) return failAll("OpenAI API key not configured (set OpenAi or OPENAI_IMAGE2_API_KEY)");
  if (body.scenes.length !== 4) return failAll(`Need exactly 4 scenes, got ${body.scenes.length}`);

  const reference = body.referenceImageUrl ? await fetchReferenceImage(body.referenceImageUrl) : null;
  const size = "1024x1024";
  const quality = body.quality ?? "high";

  let oResp: Response;
  try {
    if (reference) {
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", combinedPrompt);
      form.append("size", size);
      form.append("quality", quality);
      form.append("n", "4");
      form.append("output_format", "jpeg");
      form.append("output_compression", "90");
      form.append(
        "image",
        new Blob([reference.bytes], { type: reference.mime }),
        `reference.${reference.mime.split("/")[1] ?? "png"}`,
      );
      oResp = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
    } else {
      oResp = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model, prompt: combinedPrompt, size, quality, n: 4,
          output_format: "jpeg", output_compression: 90,
        }),
      });
    }
  } catch (e) {
    return failAll(e instanceof Error ? e.message : "OpenAI request failed");
  }

  if (!oResp.ok) {
    const t = await oResp.text();
    let detail = t;
    try { detail = JSON.parse(t)?.error?.message ?? t; } catch { /* keep raw */ }
    return failAll(`OpenAI ${oResp.status}: ${detail.slice(0, 400)}`);
  }

  const oData = await oResp.json();
  const items = (oData.data ?? []) as Array<{ b64_json?: string }>;
  if (items.length < 4 || items.some((it) => !it?.b64_json)) {
    return failAll(`Expected 4 images, got ${items.length}`);
  }

  // Replace the previous "active set" of 4 in-game-scene rows so the latest is canonical.
  await supa.from("media_assets").delete()
    .eq("project_id", body.projectId).eq("category", "in-game-scene");

  const ts = Date.now();
  for (let i = 0; i < 4; i++) {
    const url = await uploadImage(supa, `${body.projectId}/in-game-scenes/${ts}-${i + 1}.jpg`, items[i].b64_json!);
    if (!url) {
      await supa.from("image_generations").update({
        status: "error", error_message: "upload failed", updated_at: new Date().toISOString(),
      } as any).eq("id", jobIds[i]);
      continue;
    }
    await supa.from("media_assets").insert({
      project_id: body.projectId,
      category: "in-game-scene",
      title: body.scenes[i].label || `Scene ${i + 1}`,
      url,
      prompt: body.scenes[i].prompt,
      provider: "openai-direct",
      model, effective_model: model, fallback: "none",
      mime_type: "image/jpeg",
      asset_type: "image",
    } as any);
    await supa.from("image_generations").update({
      status: "done", url, effective_model: model,
      fallback: "none", provider: "openai-direct",
      updated_at: new Date().toISOString(),
    } as any).eq("id", jobIds[i]);
  }

  await logAiRun({
    userId, projectId: body.projectId, surface: "generate-in-game-scenes",
    requestedModel: model, effectiveModel: model, fallback: "none",
    status: "ok", latencyMs: Date.now() - startedAt, promptExcerpt,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const userId = await getUserIdFromAuth(req);
    const body = (await req.json()) as Body;
    if (!body.projectId || !Array.isArray(body.scenes) || body.scenes.length !== 4) {
      return new Response(JSON.stringify({ error: "projectId and exactly 4 scenes required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL, SERVICE);
    const jobIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const { data, error } = await supa.from("image_generations").insert({
        project_id: body.projectId,
        prompt: body.scenes[i].prompt?.slice(0, 4000) ?? "",
        status: "pending",
        model: "gpt-image-2",
        quality: body.quality ?? "high",
      } as any).select("id").single();
      if (error || !data) {
        return new Response(JSON.stringify({ error: error?.message ?? "Could not create job rows" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      jobIds.push(data.id as string);
    }

    const work = runBatch(body, userId, jobIds);
    // deno-lint-ignore no-explicit-any
    const ER = (globalThis as any).EdgeRuntime;
    if (ER?.waitUntil) ER.waitUntil(work);
    else void work;

    return new Response(
      JSON.stringify({ jobIds, status: "pending" }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
