// Generate-cover-pair — fires ONE gpt-image-2 call with n=2 so the front and
// back covers come back as a style-shared pair. Saves the front to projects
// (cover_image_url) and the back as a media_assets row (category=marketing-back)
// so the existing bake pipelines pick both up automatically.
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

interface Body {
  projectId: string;
  combinedPrompt: string;
  referenceImageUrl?: string | null;
  referenceLabel?: string | null;
  /** Optional in-game scene URLs to attach as additional reference images. */
  inGameSceneUrls?: string[];
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

async function uploadImage(supa: ReturnType<typeof createClient>, bucket: string, path: string, b64: string): Promise<string | null> {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const { error } = await supa.storage.from(bucket).upload(path, bytes, {
    contentType: "image/jpeg", upsert: true,
  });
  if (error) {
    console.error(`upload to ${bucket}/${path} failed:`, error.message);
    return null;
  }
  const { data: pub } = supa.storage.from(bucket).getPublicUrl(path);
  return pub.publicUrl;
}

async function runPair(body: Body, userId: string | null, frontJobId: string, backJobId: string): Promise<void> {
  const supa = createClient(SUPABASE_URL, SERVICE);
  const startedAt = Date.now();
  const model = "gpt-image-2";
  const apiKey = OPENAI_API_KEY_IMAGE2 || OPENAI_API_KEY_PRIMARY;
  const promptExcerpt = body.referenceImageUrl
    ? `[brand-ref:${body.referenceImageUrl.slice(0, 80)}] ${body.combinedPrompt.slice(0, 4000)}`
    : body.combinedPrompt.slice(0, 4000);

  const failBoth = async (msg: string) => {
    await supa.from("image_generations").update({
      status: "error", error_message: msg, updated_at: new Date().toISOString(),
    } as any).in("id", [frontJobId, backJobId]);
    await logAiRun({
      userId, projectId: body.projectId, surface: "generate-cover-pair",
      requestedModel: model, status: "error", errorMessage: msg,
      latencyMs: Date.now() - startedAt, promptExcerpt,
    });
  };

  if (!apiKey) {
    await failBoth("OpenAI API key not configured (set OpenAi or OPENAI_IMAGE2_API_KEY)");
    return;
  }

  const reference = body.referenceImageUrl ? await fetchReferenceImage(body.referenceImageUrl) : null;
  const sceneUrls = (body.inGameSceneUrls ?? []).slice(0, 4);
  const sceneRefs = (await Promise.all(sceneUrls.map((u) => fetchReferenceImage(u)))).filter(Boolean) as Array<{ bytes: Uint8Array; mime: string }>;
  const size = "1024x1536";
  const quality = body.quality ?? "high";
  const useEdits = !!reference || sceneRefs.length > 0;

  let oResp: Response;
  try {
    if (useEdits) {
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", body.combinedPrompt);
      form.append("size", size);
      form.append("quality", quality);
      form.append("n", "2");
      form.append("output_format", "jpeg");
      form.append("output_compression", "90");
      const allRefs = [...(reference ? [reference] : []), ...sceneRefs];
      allRefs.forEach((ref, idx) => {
        form.append(
          "image[]",
          new Blob([ref.bytes], { type: ref.mime }),
          `ref-${idx}.${ref.mime.split("/")[1] ?? "png"}`,
        );
      });
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
          model, prompt: body.combinedPrompt, size, quality, n: 2,
          output_format: "jpeg", output_compression: 90,
        }),
      });
    }
  } catch (e) {
    await failBoth(e instanceof Error ? e.message : "OpenAI request failed");
    return;
  }

  if (!oResp.ok) {
    const t = await oResp.text();
    let detail = t;
    try { detail = JSON.parse(t)?.error?.message ?? t; } catch { /* keep raw */ }
    await failBoth(`OpenAI ${oResp.status}: ${detail.slice(0, 400)}`);
    return;
  }

  const oData = await oResp.json();
  const items = (oData.data ?? []) as Array<{ b64_json?: string }>;
  if (items.length < 2 || !items[0]?.b64_json || !items[1]?.b64_json) {
    await failBoth(`Expected 2 images from gpt-image-2, got ${items.length}`);
    return;
  }

  const ts = Date.now();
  const frontUrl = await uploadImage(supa, "covers", `${body.projectId}/${ts}-front.jpg`, items[0].b64_json!);
  const backUrl = await uploadImage(supa, "media", `${body.projectId}/marketing-back/${ts}-back.jpg`, items[1].b64_json!);

  if (!frontUrl || !backUrl) {
    await failBoth("Image upload failed");
    return;
  }

  // ---- Front: write to projects.cover_image_url (matches existing flow) ----
  const { data: priorProj } = await supa
    .from("projects").select("cover_prompt_history").eq("id", body.projectId).single();
  const priorHist = ((priorProj as any)?.cover_prompt_history ?? []) as any[];
  const historyEntry = {
    at: new Date().toISOString(),
    prompt: body.combinedPrompt.slice(0, 2000),
    effective_model: model,
    requested_model: model,
    fallback: "none",
    provider: "openai-direct",
    pair: "front",
  };
  await supa.from("projects").update({
    cover_image_url: frontUrl,
    cover_prompt: body.combinedPrompt,
    cover_effective_model: model,
    cover_fallback: "none",
    cover_prompt_history: [historyEntry, ...priorHist].slice(0, 20),
  } as any).eq("id", body.projectId);

  // History asset for cover (so the cover-history strip picks it up).
  await supa.from("media_assets").insert({
    project_id: body.projectId,
    category: "project-cover",
    title: "Front cover (paired)",
    url: frontUrl,
    prompt: body.combinedPrompt,
    provider: "openai-direct",
    model,
    effective_model: model,
    fallback: "none",
    mime_type: "image/jpeg",
    asset_type: "image",
    source_project_cover: true,
  } as any);

  // ---- Back: write a media_assets row (category=marketing-back) ----
  await supa.from("media_assets").insert({
    project_id: body.projectId,
    category: "marketing-back",
    title: "Back cover (paired)",
    url: backUrl,
    prompt: body.combinedPrompt,
    provider: "openai-direct",
    model,
    effective_model: model,
    fallback: "none",
    mime_type: "image/jpeg",
    asset_type: "image",
  } as any);

  // Mark both job rows done so the BatchProgress pill flips to complete.
  await supa.from("image_generations").update({
    status: "done", url: frontUrl, effective_model: model,
    fallback: "none", provider: "openai-direct",
    updated_at: new Date().toISOString(),
  } as any).eq("id", frontJobId);
  await supa.from("image_generations").update({
    status: "done", url: backUrl, effective_model: model,
    fallback: "none", provider: "openai-direct",
    updated_at: new Date().toISOString(),
  } as any).eq("id", backJobId);

  await logAiRun({
    userId, projectId: body.projectId, surface: "generate-cover-pair",
    requestedModel: model, effectiveModel: model, fallback: "none",
    status: "ok", latencyMs: Date.now() - startedAt, promptExcerpt,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const userId = await getUserIdFromAuth(req);
    const body = (await req.json()) as Body;
    if (!body.projectId || !body.combinedPrompt) {
      return new Response(JSON.stringify({ error: "projectId and combinedPrompt required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL, SERVICE);
    // Two pending rows so the BatchProgress pill shows "0/2 → 2/2" naturally.
    const { data: front, error: e1 } = await supa.from("image_generations").insert({
      project_id: body.projectId,
      prompt: body.combinedPrompt.slice(0, 4000),
      status: "pending",
      model: "gpt-image-2",
      quality: body.quality ?? "high",
      source_project_cover: true,
    } as any).select("id").single();
    const { data: back, error: e2 } = await supa.from("image_generations").insert({
      project_id: body.projectId,
      prompt: body.combinedPrompt.slice(0, 4000),
      status: "pending",
      model: "gpt-image-2",
      quality: body.quality ?? "high",
    } as any).select("id").single();

    if (e1 || e2 || !front || !back) {
      return new Response(JSON.stringify({ error: e1?.message ?? e2?.message ?? "Could not create job rows" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const work = runPair(body, userId, front.id as string, back.id as string);
    // deno-lint-ignore no-explicit-any
    const ER = (globalThis as any).EdgeRuntime;
    if (ER?.waitUntil) ER.waitUntil(work);
    else void work;

    return new Response(
      JSON.stringify({ frontJobId: front.id, backJobId: back.id, status: "pending" }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
