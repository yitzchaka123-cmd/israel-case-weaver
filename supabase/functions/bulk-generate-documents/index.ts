// Bulk document generation orchestrator.
//
// Walks a list of documents and calls the existing `generate-document` edge
// function once per (doc, requested-output) tuple, with a small concurrency
// window (defaults to SERIAL = 1 so the user sees one shot at a time).
// Writes live progress to `bulk_generation_jobs` so the UI can show
// "12 / 40 · current: …" with realtime updates, AND emits one
// `project_notifications` row per doc as it finishes (with a thumbnail when
// an image was produced) so the bell shows live per-doc updates.
//
// Modes:
//   "draft"        → mode=text only (writes hebrew_content, no image/file)
//                    → notifications are emitted WITHOUT thumbnails.
//   "image"        → mode=image only
//   "document"     → mode=document only (PDF/DOCX/etc)
//   "both"         → image + document (notifications get the image thumbnail)
//   "image_to_pdf" → wraps each doc's existing generated_asset_url image
//                    into a one-page PDF via the same Claude pipeline.
//
// Scopes:
//   "all_remaining"  → every doc whose status != 'final' (and not Doc 0)
//   "from_doc_number"→ filter by doc_number >= fromDocNumber (and optional cap)
//   "ids"            → exact list of document_ids
//
// Optional `waitForJobId`: if set, the worker waits (poll up to 20 min) for
// that prior job to finish before starting. This lets the assistant chain a
// "draft pass → generate pass" without blocking its own turn.
//
// On 429 / 402 errors the worker pauses 30s and retries up to 2 times before
// marking that doc as failed and moving on.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Mode = "draft" | "image" | "document" | "both" | "image_to_pdf";
type Scope = "all_remaining" | "from_doc_number" | "ids";

interface BulkRequest {
  projectId: string;
  scope: Scope;
  mode: Mode;
  documentFormat?: "pdf" | "docx" | "pptx" | "xlsx";
  fromDocNumber?: number;
  untilDocNumber?: number;
  documentIds?: string[];
  concurrency?: number;
  waitForJobId?: string | null;
  /**
   * When true (default), docs that already have content for the chosen mode
   * are skipped:
   *   - draft     → skip if hebrew_content is non-empty
   *   - image     → skip if generated_asset_url is set
   *   - document  → skip if generated_document_url or generated_pdf_url is set
   *   - both      → skip if BOTH image and file exist
   * When false, every doc in scope is regenerated (overwrite).
   */
  skipExisting?: boolean;
  /**
   * When true, after the run finishes the worker inserts a
   * "bulk_generation_done" notification with a starter_prompt so the
   * assistant follow-up flow kicks in. Default true.
   */
  notifyOnComplete?: boolean;
}

const MAX_CONCURRENCY = 5;

async function callGenerateDocument(documentId: string, mode: "text" | "image" | "document" | "image_to_pdf", documentFormat: string, signal: AbortSignal) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/generate-document`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ documentId, mode, documentFormat }),
    signal,
  });
  let body: any = {};
  try { body = await r.json(); } catch { /* ignore */ }
  return { ok: r.ok, status: r.status, body };
}

async function generateOneDoc(supa: any, jobId: string, doc: { id: string; title: string }, mode: Mode, documentFormat: string): Promise<{ ok: boolean; error?: string }> {
  // Set current pointer
  await supa.from("bulk_generation_jobs").update({
    current_doc_id: doc.id,
    current_doc_title: doc.title,
  }).eq("id", jobId);

  const steps: ("text" | "image" | "document" | "image_to_pdf")[] =
    mode === "draft" ? ["text"] :
    mode === "image" ? ["image"] :
    mode === "document" ? ["document"] :
    mode === "image_to_pdf" ? ["image_to_pdf"] :
    /* both */ ["image", "document"];

  for (const step of steps) {
    let attempt = 0;
    while (true) {
      attempt++;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 180_000);
      try {
        const r = await callGenerateDocument(doc.id, step, documentFormat, ctrl.signal);
        clearTimeout(timer);
        if (r.ok) break;
        // Retry on rate limit / credits
        if ((r.status === 429 || r.status === 402) && attempt <= 3) {
          console.warn(`[bulk] ${step} for ${doc.id} hit ${r.status}, sleeping 30s (attempt ${attempt}/3)`);
          await new Promise((res) => setTimeout(res, 30_000));
          continue;
        }
        const err = (r.body?.error as string) ?? `HTTP ${r.status}`;
        return { ok: false, error: `${step}: ${err}` };
      } catch (e) {
        clearTimeout(timer);
        const aborted = (e as Error)?.name === "AbortError";
        if (aborted && attempt <= 2) continue;
        return { ok: false, error: `${step}: ${aborted ? "timeout" : (e as Error).message}` };
      }
    }
  }
  return { ok: true };
}

/** Insert a per-doc notification (success or failure). */
async function notifyPerDoc(
  supa: any,
  projectId: string,
  doc: { id: string; title: string; doc_number: number | null },
  mode: Mode,
  outcome: { ok: boolean; error?: string },
) {
  try {
    const numLabel = doc.doc_number !== null && doc.doc_number !== undefined ? `Doc ${doc.doc_number}` : "Doc";
    let previewUrl: string | null = null;
    if (outcome.ok && mode !== "draft") {
      // Pull the freshly generated thumbnail.
      const { data } = await supa
        .from("documents")
        .select("generated_asset_url, document_preview_url")
        .eq("id", doc.id)
        .single();
      previewUrl = (data?.document_preview_url as string | null) ?? (data?.generated_asset_url as string | null) ?? null;
    }
    const verb =
      mode === "draft" ? "Drafted"
      : mode === "image" ? "Image generated for"
      : mode === "document" ? "File generated for"
      : mode === "image_to_pdf" ? "PDF wrapped for"
      : "Generated";
    const title = outcome.ok
      ? `✓ ${numLabel} — ${doc.title}`
      : `⚠ ${numLabel} — ${doc.title} failed`;
    const body = outcome.ok
      ? `${verb} "${doc.title}".`
      : (outcome.error ?? "Generation failed").slice(0, 280);
    await supa.from("project_notifications").insert({
      project_id: projectId,
      kind: outcome.ok ? "bulk_doc_done" : "bulk_doc_failed",
      title,
      body,
      preview_image_url: previewUrl,
      created_by: "assistant",
      status: "unread",
    } as never);
  } catch (e) {
    console.warn("[bulk] per-doc notification failed", e);
  }
}

/** Wait for a prior job to reach a terminal state. Polls every 5s, max 20 min. */
async function waitForPriorJob(supa: any, priorJobId: string) {
  const start = Date.now();
  const deadline = start + 20 * 60_000;
  while (Date.now() < deadline) {
    const { data } = await supa
      .from("bulk_generation_jobs")
      .select("status")
      .eq("id", priorJobId)
      .maybeSingle();
    const s = (data as { status?: string } | null)?.status;
    if (!s) return; // gone — proceed
    if (s === "completed" || s === "failed") return;
    await new Promise((res) => setTimeout(res, 5_000));
  }
  console.warn(`[bulk] waitForJobId ${priorJobId} timed out — proceeding anyway`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const input = await req.json() as BulkRequest;
    const { projectId, scope, mode } = input;
    if (!projectId || !scope || !mode) {
      return new Response(JSON.stringify({ error: "projectId, scope, mode required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const documentFormat = input.documentFormat ?? "pdf";
    // Default to SERIAL (1) so the user sees one-shot-at-a-time progress that
    // matches the assistant's "I'll generate them one shot each" promise.
    const concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, input.concurrency ?? 1));
    const notifyOnComplete = input.notifyOnComplete !== false;

    const supa = createClient(SUPABASE_URL, SERVICE);

    // Resolve doc list.
    let q = supa.from("documents").select("id, title, doc_number, status, doc_type, hebrew_content, generated_asset_url, generated_document_url, generated_pdf_url").eq("project_id", projectId).order("doc_number", { ascending: true });
    let docs: { id: string; title: string; doc_number: number | null; status: string; doc_type: string | null; hebrew_content: string | null; generated_asset_url: string | null; generated_document_url: string | null; generated_pdf_url: string | null }[] = [];
    const skipExisting = input.skipExisting !== false; // default true
    if (scope === "ids") {
      const ids = (input.documentIds ?? []).filter(Boolean);
      if (ids.length === 0) return new Response(JSON.stringify({ error: "documentIds required for scope=ids" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data } = await q.in("id", ids);
      docs = (data ?? []) as never;
    } else {
      const { data } = await q;
      docs = (data ?? []) as never;
      if (scope === "from_doc_number") {
        const from = Number(input.fromDocNumber ?? 0);
        const until = input.untilDocNumber ? Number(input.untilDocNumber) : Infinity;
        docs = docs.filter((d) => (d.doc_number ?? 0) >= from && (d.doc_number ?? 0) <= until);
      }
      // Skip already-final docs for non-draft modes
      if (mode !== "draft") {
        docs = docs.filter((d) => d.status !== "final");
      }
    }

    // Honor skipExisting: drop docs that already have content for this mode.
    if (skipExisting) {
      docs = docs.filter((d) => {
        if (mode === "draft") return !(d.hebrew_content && d.hebrew_content.trim().length > 0);
        if (mode === "image") return !d.generated_asset_url;
        if (mode === "document") return !(d.generated_document_url || d.generated_pdf_url);
        if (mode === "image_to_pdf") return !!d.generated_asset_url; // needs an image
        // both
        return !(d.generated_asset_url && (d.generated_document_url || d.generated_pdf_url));
      });
    }

    if (docs.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: "No documents matched the scope.", jobId: null, total: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Create job row.
    const { data: job, error: jobErr } = await supa
      .from("bulk_generation_jobs")
      .insert({
        project_id: projectId,
        scope,
        mode,
        document_format: documentFormat,
        document_ids: docs.map((d) => d.id),
        total: docs.length,
        completed: 0,
        failed: 0,
        status: "running",
      } as never)
      .select("id")
      .single();
    if (jobErr || !job) {
      return new Response(JSON.stringify({ error: `Could not create job: ${jobErr?.message}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const jobId = (job as { id: string }).id;

    // Kick off the worker as a background task — return jobId immediately so
    // the UI can subscribe to realtime progress.
    const work = (async () => {
      // Optionally chain after a prior job (e.g. draft pass → generate pass).
      if (input.waitForJobId) {
        await waitForPriorJob(supa, input.waitForJobId);
      }

      const errors: { id: string; title: string; error: string }[] = [];
      // Simple concurrency window
      let cursor = 0;
      const runOne = async () => {
        while (true) {
          const i = cursor++;
          if (i >= docs.length) return;
          const d = docs[i];
          const res = await generateOneDoc(supa, jobId, d, mode, documentFormat);
          // Per-doc notification (with thumbnail when applicable)
          await notifyPerDoc(supa, projectId, d, mode, res);
          if (res.ok) {
            await supa.rpc("increment_bulk_completed", { p_job_id: jobId }).then(
              () => {},
              async () => {
                // Fallback to direct UPDATE if RPC doesn't exist.
                const { data: row } = await supa.from("bulk_generation_jobs").select("completed").eq("id", jobId).single();
                await supa.from("bulk_generation_jobs").update({ completed: ((row as any)?.completed ?? 0) + 1 }).eq("id", jobId);
              },
            );
          } else {
            errors.push({ id: d.id, title: d.title, error: res.error ?? "unknown" });
            const { data: row } = await supa.from("bulk_generation_jobs").select("failed").eq("id", jobId).single();
            await supa.from("bulk_generation_jobs").update({ failed: ((row as any)?.failed ?? 0) + 1 }).eq("id", jobId);
          }
        }
      };
      await Promise.all(Array.from({ length: concurrency }, () => runOne()));
      await supa.from("bulk_generation_jobs").update({
        status: errors.length === docs.length ? "failed" : "completed",
        finished_at: new Date().toISOString(),
        error: errors.length > 0 ? errors.slice(0, 10).map((e) => `${e.title}: ${e.error}`).join(" | ") : null,
        current_doc_id: null,
        current_doc_title: null,
      }).eq("id", jobId);

      // Final summary notification — used by the client to nudge the
      // assistant into acknowledging progress and proposing the next step.
      if (notifyOnComplete) {
        try {
          const succeeded = docs.length - errors.length;
          const modeLabel =
            mode === "draft" ? "drafting"
            : mode === "image" ? "image generation"
            : mode === "document" ? "file generation"
            : mode === "image_to_pdf" ? "PDF wrapping"
            : "generation";
          const starter = mode === "draft"
            ? `I just finished drafting ${succeeded}/${docs.length} documents in bulk. Briefly acknowledge what was drafted and tell me whether you recommend reviewing the drafts or moving straight to generating images + PDFs for all of them.`
            : `I just finished bulk ${modeLabel} on ${succeeded}/${docs.length} documents. Briefly acknowledge the result and propose the next step (review, fix any failures, move on to envelopes/hints/marketing — whatever fits the current phase).`;
          await supa.from("project_notifications").insert({
            project_id: projectId,
            kind: "bulk_generation_done",
            title: errors.length === 0
              ? `Bulk ${modeLabel} complete — ${docs.length} doc${docs.length === 1 ? "" : "s"}`
              : `Bulk ${modeLabel} finished with ${errors.length} failure${errors.length === 1 ? "" : "s"}`,
            body: `${succeeded} / ${docs.length} documents ${mode === "draft" ? "drafted" : "generated"} successfully.${errors.length > 0 ? ` Failed: ${errors.slice(0, 5).map((e) => e.title).join(", ")}` : ""}`,
            starter_prompt: starter,
            created_by: "assistant",
            status: "unread",
          } as never);
        } catch (_e) { /* notifications optional */ }
      }
    })();
    // Don't await — let it run as a background task.
    // @ts-ignore Deno worker waitUntil
    if (typeof (req as unknown as { waitUntil?: (p: Promise<unknown>) => void }).waitUntil === "function") {
      (req as unknown as { waitUntil: (p: Promise<unknown>) => void }).waitUntil(work);
    } else {
      // Fire and forget; Deno keeps the function alive briefly. For long jobs
      // we don't await on purpose so the HTTP call returns immediately.
      work.catch((e) => console.error("[bulk] worker fatal", e));
    }

    return new Response(
      JSON.stringify({ ok: true, jobId, total: docs.length, mode, documentFormat }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[bulk-generate-documents] fatal", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
