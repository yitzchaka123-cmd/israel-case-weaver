import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AutoSaveInput } from "@/components/AutoSave";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Plus, FileText, Trash2, Upload, Image as ImageIcon, Loader2, FileDown, Copy, RotateCcw, Wand2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import jsPDF from "jspdf";

import { ImageModelPicker, getStoredImageModel, getStoredImageQuality } from "@/components/ImageModelPicker";
import { AssistantOriginBadge } from "@/components/AssistantOriginBadge";
import { AiOriginBadge } from "@/components/AiOriginBadge";
import { DocumentPromptAssistant } from "@/components/DocumentPromptAssistant";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { InlineImagesPanel } from "./documents/InlineImagesPanel";

interface MediaHistoryRow {
  id: string;
  url: string | null;
  preview_url: string | null;
  model: string | null;
  effective_model: string | null;
  provider: string | null;
  document_format: string | null;
  created_at: string;
}

const DOC_TYPES = [
  "Memo", "Interrogation transcript", "Suspect profile", "Map", "Chat log",
  "Analyst report", "Surveillance log", "Receipt", "Evidence form",
  "Schedule", "Notice", "Printout", "Handwritten note", "Newspaper clipping",
  "Technical report", "Photo", "Other",
];
const PRINT_SIZES = ["A3", "A4", "A5", "A6", "Business card", "Custom"];
const STATUSES = ["draft", "in_progress", "review", "final"];

interface Doc {
  id: string;
  project_id: string;
  doc_number: number | null;
  title: string;
  doc_type: string | null;
  print_size: string | null;
  design_instructions: string | null;
  hebrew_content: string | null;
  status: string;
  generated_asset_url: string | null;
  generated_document_url?: string | null;
  generated_pdf_url?: string | null;
  document_format?: string | null;
  document_provider?: string | null;
  document_model?: string | null;
  document_skill_id?: string | null;
  document_preview_url?: string | null;
  uploaded_asset_url: string | null;
  active_version: string;
  envelope_number: number | null;
  created_by_message_id: string | null;
  inline_images_layout?: string | null;
  inline_images_caption?: string | null;
}

export function DocumentsSection({ projectId }: { projectId: string }) {
  const [selected, setSelected] = useState<string | null>(null);

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("logic_approved_at, solution_summary, game_language").eq("id", projectId).single();
      if (error) throw error;
      return data;
    },
  });

  const { data, refetch } = useQuery({
    queryKey: ["documents", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Doc[];
    },
  });

  const addDoc = async () => {
    const docNum = Math.floor(Math.random() * 900) + 100;
    const { error } = await supabase.from("documents").insert({
      project_id: projectId,
      doc_number: docNum,
      title: `Document ${docNum}`,
    });
    if (error) toast.error(error.message);
    else refetch();
  };

  // ---- Bulk generation ---------------------------------------------------
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkMode, setBulkMode] = useState<"draft" | "image" | "document" | "both">("both");
  const [bulkScope, setBulkScope] = useState<"all_remaining" | "ids">("all_remaining");
  const [bulkFormat, setBulkFormat] = useState<"pdf" | "docx" | "pptx" | "xlsx">("pdf");
  const [bulkConcurrency, setBulkConcurrency] = useState<number>(3);
  const [bulkSkipExisting, setBulkSkipExisting] = useState<boolean>(true);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  // Pre-flight count: how many docs in scope already have generated content
  // for the chosen mode. Used to warn the user before they accidentally redo
  // (and re-spend credits on) work that's already done.
  const alreadyGeneratedCount = (() => {
    if (!data) return 0;
    const docs = data.filter((d) => (d.doc_number ?? 0) > 0); // skip Doc 0
    return docs.filter((d) => {
      if (bulkMode === "draft") return !!(d.hebrew_content && d.hebrew_content.trim().length > 0);
      if (bulkMode === "image") return !!d.generated_asset_url;
      if (bulkMode === "document") return !!(d.generated_document_url || d.generated_pdf_url);
      // both
      return !!d.generated_asset_url && !!(d.generated_document_url || d.generated_pdf_url);
    }).length;
  })();
  const totalEligible = (data?.filter((d) => (d.doc_number ?? 0) > 0 && d.status !== "final").length) ?? 0;

  const { data: activeJob, refetch: refetchJob } = useQuery({
    queryKey: ["bulk-job", projectId, activeJobId],
    queryFn: async () => {
      if (activeJobId) {
        const { data } = await supabase.from("bulk_generation_jobs").select("*").eq("id", activeJobId).maybeSingle();
        return data as never;
      }
      const { data } = await supabase.from("bulk_generation_jobs").select("*").eq("project_id", projectId).order("started_at", { ascending: false }).limit(1).maybeSingle();
      return data as never;
    },
    refetchInterval: activeJobId ? 2500 : 5000,
  }) as { data: { id: string; status: string; total: number; completed: number; failed: number; current_doc_title: string | null; mode: string; document_format: string | null; scope: string; document_ids: string[]; error: string | null; started_at: string; finished_at: string | null; last_heartbeat_at: string | null; cancel_requested: boolean | null } | null; refetch: () => void };

  // A "running" job whose heartbeat is older than 4 min is a ghost — the
  // worker died. We surface this in the UI so the user can force-stop it
  // and resume the remaining docs instead of staring at an infinite spinner.
  const STALE_MS = 4 * 60_000;
  const heartbeatAgeMs = activeJob?.last_heartbeat_at ? Date.now() - new Date(activeJob.last_heartbeat_at).getTime() : 0;
  const isStale = !!activeJob && activeJob.status === "running" && heartbeatAgeMs > STALE_MS;

  const forceStopJob = async () => {
    if (!activeJob) return;
    if (!confirm("Force-stop this bulk run? Documents already generated will keep their content.")) return;
    await supabase.from("bulk_generation_jobs").update({
      status: "failed",
      cancel_requested: true,
      finished_at: new Date().toISOString(),
      error: "force-stopped from UI (stale worker)",
      current_doc_id: null,
      current_doc_title: null,
    }).eq("id", activeJob.id);
    refetchJob();
    toast.success("Bulk run stopped. You can now start a new run or resume the remaining documents.");
  };

  const resumeRemaining = async () => {
    if (!activeJob) return;
    await launchBulk({
      mode: (activeJob.mode === "draft" || activeJob.mode === "image" || activeJob.mode === "document" || activeJob.mode === "both") ? activeJob.mode : "both",
      scope: "all_remaining",
      format: (activeJob.document_format as typeof bulkFormat) ?? bulkFormat,
      logChat: `Resume the remaining ${activeJob.mode === "draft" ? "drafts" : "documents"} from the previous bulk run that stopped at ${activeJob.completed}/${activeJob.total}. Skip docs that already finished.`,
    });
  };

  useEffect(() => {
    const ch = supabase
      .channel(`bulk-jobs-${projectId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "bulk_generation_jobs", filter: `project_id=eq.${projectId}` }, () => {
        refetchJob();
        refetch();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [projectId, refetchJob, refetch]);

  const launchingRef = useRef(false);
  const launchBulk = async (overrides?: { mode?: typeof bulkMode; scope?: typeof bulkScope; format?: typeof bulkFormat; concurrency?: number; logChat?: string; skipExisting?: boolean }) => {
    // Guard against double-clicks creating multiple parallel jobs that fight
    // over the same docs and burn through provider quota.
    if (launchingRef.current) { toast.info("A bulk run is already starting…"); return; }
    // Also block if a fresh job is already running for this project. If a
    // "running" row exists but the worker hasn't beat in 4 min, it's a ghost
    // — auto-close it so the user is never blocked by a crashed run.
    const { data: existing } = await supabase
      .from("bulk_generation_jobs")
      .select("id, last_heartbeat_at")
      .eq("project_id", projectId)
      .eq("status", "running");
    const STALE_MS_GUARD = 4 * 60_000;
    const stale = (existing ?? []).filter((j: { last_heartbeat_at: string | null }) => Date.now() - new Date(j.last_heartbeat_at ?? 0).getTime() > STALE_MS_GUARD);
    const fresh = (existing ?? []).filter((j: { last_heartbeat_at: string | null }) => Date.now() - new Date(j.last_heartbeat_at ?? 0).getTime() <= STALE_MS_GUARD);
    if (stale.length > 0) {
      await supabase.from("bulk_generation_jobs").update({
        status: "failed",
        cancel_requested: true,
        finished_at: new Date().toISOString(),
        error: "auto-closed: stale (no heartbeat) on next-run kickoff",
      }).in("id", stale.map((j: { id: string }) => j.id));
    }
    if (fresh.length > 0) {
      toast.error("A bulk run is already in progress for this project. Wait for it to finish before starting another.");
      launchingRef.current = false;
      return;
    }
    launchingRef.current = true;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const effectiveMode = overrides?.mode ?? bulkMode;
      const effectiveSkipExisting = overrides?.skipExisting ?? bulkSkipExisting;
      const payload = {
        projectId,
        scope: overrides?.scope ?? bulkScope,
        mode: effectiveMode,
        documentFormat: overrides?.format ?? bulkFormat,
        concurrency: overrides?.concurrency ?? bulkConcurrency,
        skipExisting: effectiveSkipExisting,
      };
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bulk-generate-documents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify(payload),
      });
      const json = await resp.json().catch(() => ({} as { jobId?: string; total?: number; error?: string; message?: string }));
      if (!resp.ok) { toast.error(json.error ?? `Bulk start failed (${resp.status})`); return; }
      if (!json.jobId) {
        if (effectiveMode === "draft" && effectiveSkipExisting) {
          toast.info("All documents already have drafts — pick \"Overwrite all\" to redo them.");
        } else {
          toast.info(json.message ?? "No matching documents.");
        }
        return;
      }
      setActiveJobId(json.jobId);
      setBulkOpen(false);
      if (overrides?.logChat) {
        try {
          await supabase.from("chat_messages").insert({
            project_id: projectId,
            role: "user",
            content: overrides.logChat,
          });
        } catch (_e) { /* non-fatal */ }
      }
      toast.success(`${overrides?.mode === "draft" ? "Drafting" : "Bulk run"} started — ${json.total} document${json.total === 1 ? "" : "s"} in queue.`);
    } finally {
      // Release the lock after a short delay so a second click during the
      // network round-trip is still blocked, but the user can retry later.
      setTimeout(() => { launchingRef.current = false; }, 3000);
    }
  };

  const startDraftAll = async () => {
    if (!confirm("Draft text content for all remaining documents? Existing drafts will be regenerated.")) return;
    await launchBulk({
      mode: "draft",
      scope: "all_remaining",
      concurrency: 2,
      logChat: "I just hit Draft all on the Documents tab. You'll see per-doc updates in the bell as each draft lands; once it's done, please acknowledge and tell me whether to review or jump to generating images + PDFs for the whole set.",
    });
  };

  const sel = data?.find((d) => d.id === selected) ?? null;
  // A stale "running" job means the worker died — don't disable the action
  // buttons because of it (the next launch will auto-sweep it).
  const jobRunning = activeJob?.status === "running" && !isStale;
  const jobPct = activeJob ? Math.round((((activeJob.completed ?? 0) + (activeJob.failed ?? 0)) / Math.max(1, activeJob.total)) * 100) : 0;
  const showFinishedBanner = !!activeJob?.finished_at && Date.now() - new Date(activeJob.finished_at).getTime() < 30_000;
  const stoppedEarly = !!activeJob && activeJob.status !== "running" && activeJob.completed + activeJob.failed < activeJob.total;

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-10 py-8">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h2 className="font-display text-3xl flex items-center gap-3">
          Documents
          {jobRunning && (
            <span
              className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-success"
              title={`Live — ${activeJob?.mode === "draft" ? "drafting" : "generating"} in progress`}
            >
              <span className="relative inline-flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-80" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success ring-2 ring-success/40 shadow-[0_0_8px_rgba(34,197,94,0.7)]" />
              </span>
              Live
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={startDraftAll}
            disabled={jobRunning || !data?.length}
            className="gap-2"
            title="Draft Hebrew text content for every remaining document"
          >
            {jobRunning && activeJob?.mode === "draft" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            Draft all
          </Button>
          <Button
            variant="outline"
            onClick={() => setBulkOpen(true)}
            disabled={jobRunning || !data?.length}
            className="gap-2"
            title="Generate text + image + file for many documents in one run"
          >
            {jobRunning && activeJob?.mode !== "draft" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            Generate all
          </Button>
          <Button onClick={addDoc} className="gap-2"><Plus className="h-4 w-4" /> New document</Button>
        </div>
      </div>

      {isStale && activeJob && (
        <div className="mb-6 rounded-xl border border-destructive bg-destructive/10 px-4 py-3 shadow-soft">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium text-destructive">Bulk run looks stuck</span>
              <span className="text-muted-foreground">
                · last update {Math.round(heartbeatAgeMs / 60_000)}m ago · {(activeJob.completed ?? 0) + (activeJob.failed ?? 0)} / {activeJob.total} done
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={forceStopJob}>Force stop</Button>
              <Button size="sm" onClick={async () => { await forceStopJob(); await resumeRemaining(); }}>Resume remaining</Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">The background worker stopped sending updates. Force-stop to unlock, then resume to pick up where it left off (already-generated docs will be skipped).</p>
        </div>
      )}

      {activeJob && (jobRunning || showFinishedBanner) && (
        <div className="mb-6 rounded-xl border bg-card px-4 py-3 shadow-soft">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2 text-sm">
              {jobRunning ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <FileText className="h-4 w-4 text-success" />}
              <span className="font-medium">
                {jobRunning ? "Bulk generation in progress" : activeJob.status === "completed" ? "Bulk generation complete" : "Bulk generation finished with errors"}
              </span>
              <span className="text-muted-foreground">
                · {(activeJob.completed ?? 0) + (activeJob.failed ?? 0)} / {activeJob.total} ({jobPct}%)
              </span>
              {activeJob.failed > 0 && <span className="text-destructive">· {activeJob.failed} failed</span>}
            </div>
            <div className="flex items-center gap-2">
              {!jobRunning && stoppedEarly && (
                <Button size="sm" variant="outline" onClick={resumeRemaining}>Resume remaining</Button>
              )}
              {!jobRunning && (
                <button onClick={() => setActiveJobId(null)} className="p-1 rounded hover:bg-muted" aria-label="Dismiss">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${activeJob.failed > 0 && !jobRunning ? "bg-destructive" : "bg-primary"}`}
              style={{ width: `${jobPct}%` }}
            />
          </div>
          {activeJob.current_doc_title && jobRunning && (
            <p className="text-xs text-muted-foreground mt-2 truncate">Working on: {activeJob.current_doc_title}</p>
          )}
          {activeJob.error && !jobRunning && (() => {
            const err = activeJob.error.toLowerCase();
            const billing = err.includes("billing hard limit") || err.includes("quota") || err.includes("insufficient_quota");
            const rate = err.includes("rate limit") || err.includes("429");
            return (
              <div className="mt-2 space-y-1">
                {billing && (
                  <p className="text-xs font-medium text-destructive">⚠ OpenAI billing limit reached — top up your image-provider account, then retry. No credits were charged for the failed docs.</p>
                )}
                {rate && !billing && (
                  <p className="text-xs font-medium text-warning">⚠ Image provider rate-limited the run. Wait a minute and retry — the worker already auto-retried 3×.</p>
                )}
                <p className="text-xs text-destructive line-clamp-2">{activeJob.error}</p>
              </div>
            );
          })()}
        </div>
      )}

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Generate all documents</DialogTitle></DialogHeader>
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground text-xs">
              The assistant will work through your documents one batch at a time and update each row as it goes. Documents already marked <em>final</em> are skipped.
            </p>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">What to generate</Label>
              <Select value={bulkMode} onValueChange={(v) => setBulkMode(v as typeof bulkMode)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft text only</SelectItem>
                  <SelectItem value="image">Image only</SelectItem>
                  <SelectItem value="document">Final document file only</SelectItem>
                  <SelectItem value="both">Image + document file</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(bulkMode === "document" || bulkMode === "both") && (
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">File format</Label>
                <Select value={bulkFormat} onValueChange={(v) => setBulkFormat(v as typeof bulkFormat)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pdf">PDF</SelectItem>
                    <SelectItem value="docx">DOCX</SelectItem>
                    <SelectItem value="pptx">PPTX</SelectItem>
                    <SelectItem value="xlsx">XLSX</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Concurrency</Label>
              <Select value={String(bulkConcurrency)} onValueChange={(v) => setBulkConcurrency(Number(v))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 — slowest, gentlest on rate limits</SelectItem>
                  <SelectItem value="2">2</SelectItem>
                  <SelectItem value="3">3 — recommended</SelectItem>
                  <SelectItem value="5">5 — fastest, may hit credits/rate limits</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {alreadyGeneratedCount > 0 && (
              <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 space-y-2">
                <p className="text-xs font-medium text-warning-foreground">
                  ⚠ {alreadyGeneratedCount} of {totalEligible} document{totalEligible === 1 ? "" : "s"} already have {bulkMode === "draft" ? "drafted text" : bulkMode === "image" ? "a generated image" : bulkMode === "document" ? "a generated file" : "image + file"}.
                </p>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bulkSkipExisting}
                    onChange={(e) => setBulkSkipExisting(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="text-xs">
                    <strong>Skip docs that already have content</strong> (recommended — saves credits).
                    {!bulkSkipExisting && <span className="block text-destructive mt-0.5">All {alreadyGeneratedCount} existing items will be overwritten.</span>}
                  </span>
                </label>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setBulkOpen(false)}>Cancel</Button>
              <Button onClick={() => launchBulk()} className="gap-2"><Wand2 className="h-4 w-4" /> Start bulk run</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {!project?.logic_approved_at && (
        <div className="mb-6 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm flex items-start gap-3">
          <span className="text-warning text-lg leading-none mt-0.5">⚠</span>
          <div className="flex-1">
            <p className="font-medium">Logic flow not approved yet</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              You can still generate documents, but it's recommended to design and approve the case logic first on the <strong>Case Board → Logic Flow</strong> tab. That way every document fits a coherent solution.
            </p>
          </div>
        </div>
      )}
      {!data?.length ? (
        <div className="border-2 border-dashed rounded-2xl p-12 text-center">
          <FileText className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">No documents yet.</p>
        </div>
      ) : (
        <div className="bg-card border rounded-2xl overflow-hidden shadow-soft">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">#</th>
                <th className="text-left px-4 py-3">Title</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Type</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Size</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="px-4 py-3 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr
                  key={d.id}
                  onClick={() => setSelected(d.id)}
                  className="border-t cursor-pointer hover:bg-muted/40 transition-colors group"
                >
                  <td className="px-4 py-3 font-mono text-xs">{d.doc_number ?? "—"}</td>
                  <td className="px-4 py-3 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {d.title}
                      <AssistantOriginBadge messageId={d.created_by_message_id} label="" />
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">{d.doc_type ?? "—"}</td>
                  <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground">{d.print_size ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-md ${
                      d.status === "final" ? "bg-success/15 text-success" :
                      d.status === "review" ? "bg-warning/15 text-warning" :
                      "bg-muted text-muted-foreground"
                    }`}>
                      {d.status}
                    </span>
                  </td>
                  <td className="px-2 py-3">
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!confirm(`Delete "${d.title}"? This cannot be undone.`)) return;
                        const { error } = await supabase.from("documents").delete().eq("id", d.id);
                        if (error) toast.error(error.message);
                        else { toast.success("Document deleted"); refetch(); }
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                      aria-label="Delete document"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DocDialog
        key={sel?.id}
        doc={sel}
        gameLanguage={project?.game_language ?? "Hebrew"}
        onClose={() => { setSelected(null); refetch(); }}
      />
    </div>
  );
}

function DocDialog({ doc, gameLanguage, onClose }: { doc: Doc | null; gameLanguage: string; onClose: () => void }) {
  const [draft, setDraft] = useState<Doc | null>(doc);
  const [genText, setGenText] = useState(false);
  const [genImage, setGenImage] = useState(false);
  const [genDocument, setGenDocument] = useState(false);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [fileGeneration, setFileGeneration] = useState<"pdf" | "image" | "both">("image");
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const [historyPreview, setHistoryPreview] = useState<MediaHistoryRow | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: filePrompt } = useQuery({
    queryKey: ["document-file-prompt", doc?.id],
    queryFn: async () => {
      if (!doc) return null;
      const { data, error } = await supabase
        .from("prompts")
        .select("final_prompt, provider, model, created_at")
        .eq("target_id", doc.id)
        .eq("scope", "document_file")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as { final_prompt: string | null; provider: string | null; model: string | null; created_at: string } | null;
    },
    enabled: !!doc?.id,
  });

  const { data: latestDocumentAttempt } = useQuery({
    queryKey: ["document-file-attempt", doc?.id],
    queryFn: async () => {
      if (!doc) return null;
      const { data, error } = await supabase
        .from("media_assets")
        .select("status, error_message, provider, model, effective_model, skill_name, skill_source, document_format, mime_type, url, preview_url, created_at")
        .eq("source_document_id", doc.id)
        .eq("asset_type", "document")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as { status: string | null; error_message: string | null; provider: string | null; model: string | null; effective_model: string | null; skill_name: string | null; skill_source: string | null; document_format: string | null; mime_type: string | null; url: string | null; preview_url: string | null; created_at: string } | null;
    },
    enabled: !!doc?.id,
  });

  const { data: latestImageAttempt } = useQuery({
    queryKey: ["document-image-attempt", doc?.id],
    queryFn: async () => {
      if (!doc) return null;
      const { data, error } = await supabase
        .from("media_assets")
        .select("provider, model, effective_model, fallback, created_at")
        .eq("source_document_id", doc.id)
        .eq("asset_type", "image")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as { provider: string | null; model: string | null; effective_model: string | null; fallback: string | null; created_at: string } | null;
    },
    enabled: !!doc?.id,
  });

  const { data: imageHistory, refetch: refetchImageHistory } = useQuery({
    queryKey: ["document-image-history", doc?.id],
    queryFn: async () => {
      if (!doc) return [];
      const { data, error } = await supabase
        .from("media_assets")
        .select("id, url, preview_url, model, effective_model, provider, document_format, created_at")
        .eq("source_document_id", doc.id)
        .eq("asset_type", "image")
        .not("url", "is", null)
        .order("created_at", { ascending: false })
        .limit(24);
      if (error) throw error;
      return (data ?? []) as MediaHistoryRow[];
    },
    enabled: !!doc?.id,
  });

  const { data: documentHistory, refetch: refetchDocumentHistory } = useQuery({
    queryKey: ["document-file-history", doc?.id],
    queryFn: async () => {
      if (!doc) return [];
      const { data, error } = await supabase
        .from("media_assets")
        .select("id, url, preview_url, model, effective_model, provider, document_format, created_at")
        .eq("source_document_id", doc.id)
        .eq("asset_type", "document")
        .not("url", "is", null)
        .order("created_at", { ascending: false })
        .limit(24);
      if (error) throw error;
      return (data ?? []) as MediaHistoryRow[];
    },
    enabled: !!doc?.id,
  });

  // Poll a pending High-quality image generation job until it resolves.
  useEffect(() => {
    if (!pendingJobId) return;
    let cancelled = false;
    const tick = async () => {
      const { data: job } = await supabase
        .from("image_generations")
        .select("status, url, error_message, model, effective_model, provider")
        .eq("id", pendingJobId)
        .maybeSingle();
      if (cancelled || !job) return;
      if (job.status === "generated" && job.url) {
        setDraft((d) => d ? { ...d, generated_asset_url: job.url, active_version: "generated", status: "review" } : d);
        setPendingJobId(null);
        setGenImage(false);
        toast.success("High-quality image ready");
        refetchImageHistory();
      } else if (job.status === "failed") {
        setPendingJobId(null);
        setGenImage(false);
        toast.error(job.error_message ?? "High-quality image generation failed", { duration: 8000 });
      }
    };
    const interval = window.setInterval(tick, 4000);
    tick();
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [pendingJobId, refetchImageHistory]);

  useEffect(() => setDraft(doc), [doc?.id]);

  if (!doc || !draft) return null;

  const update = (patch: Partial<Doc>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      await supabase.from("documents").update({
        title: next.title, doc_type: next.doc_type, print_size: next.print_size,
        design_instructions: next.design_instructions, hebrew_content: next.hebrew_content,
        status: next.status, active_version: next.active_version, envelope_number: next.envelope_number,
      }).eq("id", next.id);
    }, 500);
  };

  const uploadReplacement = async (file: File) => {
    const path = `${doc.project_id}/${doc.id}-${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("documents").upload(path, file, { upsert: true });
    if (error) return toast.error(error.message);
    const { data } = supabase.storage.from("documents").getPublicUrl(path);
    await supabase.from("documents").update({ uploaded_asset_url: data.publicUrl, active_version: "uploaded" }).eq("id", doc.id);
    setDraft({ ...draft, uploaded_asset_url: data.publicUrl, active_version: "uploaded" });
    toast.success("Replacement uploaded");
  };

  const generate = async (mode: "text" | "image" | "document") => {
    const setter = mode === "text" ? setGenText : mode === "image" ? setGenImage : setGenDocument;
    setter(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-document`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          documentId: doc.id,
          mode,
          imageModelOverride: mode === "image" ? getStoredImageModel("document", "chatgpt-image") : undefined,
          quality: mode === "image" ? getStoredImageQuality("document", "high") : undefined,
          documentFormat: mode === "document" ? "pdf" : undefined,
        }),
      });

      // Try to parse JSON safely — when the worker is killed mid-response the
      // body can be malformed and would otherwise blow up the dialog.
      let payload: { error?: string; hebrew_content?: string; url?: string; documentUrl?: string; pending?: boolean; jobId?: string } = {};
      try {
        payload = await resp.json();
      } catch {
        payload = { error: "The server didn't return a valid response (it may have timed out). Try Medium quality, or switch to a Nano Banana model." };
      }

      if (!resp.ok) {
        if (resp.status === 429) toast.error("Rate limit — try again in a moment.");
        else if (resp.status === 402) toast.error("Out of AI credits.");
        else if (resp.status === 504) toast.error(payload.error ?? "Generation timed out.", { duration: 8000 });
        else toast.error(payload.error ?? "Generation failed", { duration: 8000 });
        return;
      }
      if (payload.pending && payload.jobId) {
        setPendingJobId(payload.jobId);
        toast.message("Generating high-quality image (up to 3 min)…", { duration: 6000 });
        return; // keep setter true; polling effect will clear it
      }
      if (mode === "text" && payload.hebrew_content) {
        setDraft((d) => d ? { ...d, hebrew_content: payload.hebrew_content!, status: "review" } : d);
      }
      if (mode === "image" && payload.url) {
        setDraft((d) => d ? { ...d, generated_asset_url: payload.url!, active_version: "generated", status: "review" } : d);
        refetchImageHistory();
      }
      if (mode === "document" && payload.documentUrl) {
        setDraft((d) => d ? { ...d, generated_document_url: payload.documentUrl!, document_format: "pdf", status: "review" } : d);
        refetchDocumentHistory();
      }
      toast.success(mode === "text" ? "Hebrew content generated" : mode === "image" ? "Document image generated" : "Document file generated");
    } catch (e) {
      console.error("generate-document call failed", e);
      toast.error(e instanceof Error ? e.message : "Generation failed", { duration: 8000 });
    } finally {
      if (!pendingJobId) setter(false);
    }
  };

  const generateSelectedFile = async () => {
    if (fileGeneration === "both") {
      await generate("document");
      await generate("image");
      return;
    }
    await generate(fileGeneration === "pdf" ? "document" : "image");
  };

  const copyFilePrompt = async () => {
    if (!filePrompt?.final_prompt) return;
    await navigator.clipboard.writeText(filePrompt.final_prompt);
    toast.success("Document prompt copied");
  };

  const remove = async () => {
    if (!confirm("Delete this document?")) return;
    await supabase.from("documents").delete().eq("id", doc.id);
    onClose();
  };

  // Legacy single-prompt drafter removed — DocumentPromptAssistant handles
  // structured Design + Content drafting now.


  const saveAsPdf = async () => {
    const url = draft.generated_asset_url;
    if (!url) return;
    toast.loading("Building PDF…", { id: "pdf" });
    try {
      const blob = await (await fetch(url)).blob();
      const dataUrl: string = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = rej;
        r.readAsDataURL(blob);
      });
      const img = new Image();
      img.src = dataUrl;
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });

      const sizeMap: Record<string, [number, number]> = {
        A3: [297, 420], A4: [210, 297], A5: [148, 210], A6: [105, 148],
        "Business card": [85, 55],
      };
      const [pw, ph] = sizeMap[draft.print_size ?? "A4"] ?? [210, 297];
      const orientation = pw > ph ? "landscape" : "portrait";
      const pdf = new jsPDF({ orientation, unit: "mm", format: [pw, ph] });

      // Fit image with letterboxing
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const ratio = Math.min(pageW / img.width, pageH / img.height);
      const w = img.width * ratio;
      const h = img.height * ratio;
      const x = (pageW - w) / 2;
      const y = (pageH - h) / 2;
      pdf.addImage(dataUrl, "PNG", x, y, w, h);
      const safeName = (draft.title || "document").replace(/[^\p{L}\p{N}_\- ]+/gu, "_");
      pdf.save(`${safeName}.pdf`);

      // Also auto-save into the Final asset document slot (only when empty)
      // so users get a real PDF in the asset stack without an extra click.
      if (!draft.generated_document_url && !draft.generated_pdf_url) {
        try {
          const pdfBlob = pdf.output("blob");
          const path = `${doc.project_id}/${doc.id}-${Date.now()}-client.pdf`;
          const up = await supabase.storage.from("documents").upload(path, pdfBlob, { upsert: true, contentType: "application/pdf" });
          if (!up.error) {
            const { data: pub } = supabase.storage.from("documents").getPublicUrl(path);
            await supabase.from("documents").update({
              generated_pdf_url: pub.publicUrl,
              document_format: "pdf",
              document_provider: "client-jspdf",
              document_model: "jsPDF from image",
            }).eq("id", doc.id);
            await supabase.from("media_assets").insert({
              project_id: doc.project_id,
              source_document_id: doc.id,
              asset_type: "document",
              category: "document",
              document_format: "pdf",
              generation_mode: "client_image_to_pdf",
              provider: "client-jspdf",
              model: "jsPDF from image",
              url: pub.publicUrl,
              status: "generated",
              title: draft.title,
            });
            setDraft((d) => d ? { ...d, generated_pdf_url: pub.publicUrl, document_format: "pdf", document_provider: "client-jspdf", document_model: "jsPDF from image" } : d);
            refetchDocumentHistory();
            toast.success("PDF saved locally + added as Final asset document", { id: "pdf" });
            return;
          }
        } catch (uploadErr) {
          console.warn("Auto-upload of client PDF failed", uploadErr);
        }
      }
      toast.success("PDF saved", { id: "pdf" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF failed", { id: "pdf" });
    }
  };

  const restoreImageFromHistory = async (item: MediaHistoryRow) => {
    if (!item.url) return;
    await supabase.from("documents").update({
      generated_asset_url: item.url,
      active_version: "generated",
    }).eq("id", doc.id);
    setDraft((d) => d ? { ...d, generated_asset_url: item.url!, active_version: "generated" } : d);
    toast.success("Image restored as Final asset image");
  };

  const restoreDocumentFromHistory = async (item: MediaHistoryRow) => {
    if (!item.url) return;
    await supabase.from("documents").update({
      generated_document_url: item.url,
      document_format: item.document_format ?? "pdf",
      document_provider: item.provider ?? null,
      document_model: item.model ?? null,
    }).eq("id", doc.id);
    setDraft((d) => d ? { ...d, generated_document_url: item.url!, document_format: item.document_format ?? "pdf", document_provider: item.provider ?? null, document_model: item.model ?? null } : d);
    toast.success("Document restored as Final asset document");
  };

  return (
    <>
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl flex items-center gap-2 flex-wrap">
            Document <span className="text-muted-foreground font-mono text-lg">#{draft.doc_number}</span>
            <AssistantOriginBadge messageId={draft.created_by_message_id} />
          </DialogTitle>
        </DialogHeader>
        <div className="grid md:grid-cols-2 gap-4 max-h-[78vh] overflow-y-auto pr-2">
          <FieldBlock label="Title">
            <AutoSaveInput value={draft.title} onSave={(v) => update({ title: v })} />
          </FieldBlock>
          <FieldBlock label="Type">
            <Select value={draft.doc_type ?? ""} onValueChange={(v) => update({ doc_type: v })}>
              <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
              <SelectContent>{DOC_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </FieldBlock>
          <FieldBlock label="Print size">
            <Select value={draft.print_size ?? ""} onValueChange={(v) => update({ print_size: v })}>
              <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
              <SelectContent>{PRINT_SIZES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </FieldBlock>
          <FieldBlock label="Status">
            <Select value={draft.status} onValueChange={(v) => update({ status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
            </Select>
          </FieldBlock>
          <div className="md:col-span-2">
            <DocumentPromptAssistant
              projectId={doc.project_id}
              target={{ kind: "document", documentId: doc.id }}
              design={draft.design_instructions ?? ""}
              content={draft.hebrew_content ?? ""}
              onChange={({ design, content }) => update({ design_instructions: design, hebrew_content: content })}
              gameLanguage={gameLanguage}
              mode="inline"
            />
          </div>
          <div className="md:col-span-2">
            <FieldBlock label="File generation">
              <div className="flex flex-wrap items-center gap-2" dir="ltr">
                <ToggleGroup
                  type="single"
                  value={fileGeneration}
                  onValueChange={(value) => value && setFileGeneration(value as "pdf" | "image" | "both")}
                  className="justify-start"
                >
                  <ToggleGroupItem value="pdf" size="sm" className="h-8 text-xs">PDF</ToggleGroupItem>
                  <ToggleGroupItem value="image" size="sm" className="h-8 text-xs">Image</ToggleGroupItem>
                  <ToggleGroupItem value="both" size="sm" className="h-8 text-xs">PDF + image</ToggleGroupItem>
                </ToggleGroup>
                {(fileGeneration === "image" || fileGeneration === "both") && (
                  <ImageModelPicker surface="document" defaultModel="chatgpt-image" className="min-w-[220px]" />
                )}
                <Button size="sm" variant="outline" className="gap-2" onClick={generateSelectedFile} disabled={genImage || genDocument}>
                  {genImage || genDocument ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
                  Generate {fileGeneration === "both" ? "PDF + image" : fileGeneration}
                </Button>
              </div>
            </FieldBlock>
          </div>
          {/* Pending high-quality job placeholder */}
          {pendingJobId && (
            <div className="md:col-span-2 rounded-lg border border-accent/40 bg-accent/5 p-4 flex items-center gap-3">
              <Loader2 className="h-4 w-4 animate-spin text-accent" />
              <div className="text-sm">
                <p className="font-medium">Generating high-quality image…</p>
                <p className="text-xs text-muted-foreground">This can take up to 3 minutes. You can keep working — we'll update the image when it's ready.</p>
              </div>
            </div>
          )}

          {/* Final asset image */}
          <div className="md:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Final asset image</Label>
              {draft.generated_asset_url && (
                <Button size="sm" variant="outline" className="gap-2" onClick={saveAsPdf}>
                  <FileDown className="h-3.5 w-3.5" /> Save as PDF
                </Button>
              )}
            </div>
            {draft.generated_asset_url ? (
              <button type="button" onClick={() => setImagePreviewOpen(true)} className="group relative block w-full rounded-lg border bg-muted overflow-hidden">
                <img src={draft.generated_asset_url} alt="Generated document image" className="w-full max-h-96 object-contain" />
                <AiOriginBadge
                  info={{ requested: latestImageAttempt?.model ?? draft.document_model, effective: latestImageAttempt?.effective_model ?? latestImageAttempt?.model ?? draft.document_model, provider: latestImageAttempt?.provider ?? draft.document_provider, fallback: latestImageAttempt?.fallback ?? "none" }}
                  hoverOnly
                />
              </button>
            ) : (
              <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-xs text-muted-foreground">
                Empty — no image generated yet.
              </div>
            )}
            {imageHistory && imageHistory.length > 1 && (
              <HistoryStrip
                label="History"
                items={imageHistory}
                activeUrl={draft.generated_asset_url}
                onPreview={(item) => setHistoryPreview(item)}
                onRestore={restoreImageFromHistory}
                kind="image"
              />
            )}
          </div>

          {/* Final asset document */}
          <div className="md:col-span-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Final asset document</Label>
            {(draft.generated_document_url || draft.generated_pdf_url) ? (
              <div className="mt-2 rounded-lg border bg-muted/30 p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm truncate">{(draft.document_format ?? "file").toUpperCase()} • {draft.document_model ?? draft.document_provider ?? "Selected model"}</p>
                  </div>
                  <a href={draft.generated_document_url ?? draft.generated_pdf_url ?? "#"} target="_blank" rel="noreferrer" className="text-sm text-accent underline shrink-0">Open file</a>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {draft.document_format && <Badge variant="outline" className="text-[10px]">{draft.document_format.toUpperCase()}</Badge>}
                  {draft.document_provider && <Badge variant="outline" className="text-[10px]">{draft.document_provider}</Badge>}
                  {draft.document_model && <Badge variant="secondary" className="text-[10px]">{draft.document_model}</Badge>}
                  {draft.document_skill_id && <Badge variant="outline" className="text-[10px]">Skill {draft.document_skill_id}</Badge>}
                </div>
                {latestDocumentAttempt?.preview_url && <img src={latestDocumentAttempt.preview_url} alt="Document preview" className="max-h-56 w-full rounded-md border bg-background object-contain" />}
              </div>
            ) : (
              <div className="mt-2 rounded-lg border border-dashed bg-muted/30 p-6 text-center text-xs text-muted-foreground">
                Empty — no document generated yet.
              </div>
            )}
            {documentHistory && documentHistory.length > 0 && (
              <HistoryStrip
                label="History"
                items={documentHistory}
                activeUrl={draft.generated_document_url ?? draft.generated_pdf_url ?? null}
                onPreview={(item) => item.url && window.open(item.url, "_blank")}
                onRestore={restoreDocumentFromHistory}
                kind="document"
              />
            )}
          </div>

          {latestDocumentAttempt?.status === "failed" && (
            <div className="md:col-span-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Label className="mr-auto text-xs uppercase tracking-wider text-destructive font-medium">Latest document-file attempt failed</Label>
                {latestDocumentAttempt.document_format && <Badge variant="outline" className="text-[10px]">{latestDocumentAttempt.document_format.toUpperCase()}</Badge>}
                {latestDocumentAttempt.provider && <Badge variant="outline" className="text-[10px]">{latestDocumentAttempt.provider}</Badge>}
                {latestDocumentAttempt.skill_name && <Badge variant="secondary" className="text-[10px]">{latestDocumentAttempt.skill_name}</Badge>}
              </div>
              <p className="text-xs text-destructive">{latestDocumentAttempt.error_message ?? "The selected model did not return a downloadable document file."}</p>
            </div>
          )}
          {filePrompt?.final_prompt && (
            <div className="md:col-span-2 rounded-lg border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">PDF/document generation prompt</Label>
                  <p className="text-[11px] text-muted-foreground">{filePrompt.provider ?? "provider"} · {filePrompt.model ?? "model"}</p>
                </div>
                <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 text-[11px]" onClick={copyFilePrompt}>
                  <Copy className="h-3 w-3" /> Copy
                </Button>
              </div>
              <p className="max-h-28 overflow-auto whitespace-pre-wrap rounded-md bg-background/60 p-2 text-[11px] leading-relaxed text-muted-foreground">{filePrompt.final_prompt}</p>
            </div>
          )}

          {/* Inline images embedded inside the document */}
          <div className="md:col-span-2 border-t pt-4">
            <InlineImagesPanel
              documentId={draft.id}
              projectId={draft.project_id}
              layout={draft.inline_images_layout ?? "bottom-grid-2col"}
              caption={draft.inline_images_caption ?? ""}
              onLayoutChange={(v) => update({ inline_images_layout: v })}
              onCaptionChange={(v) => update({ inline_images_caption: v })}
            />
          </div>

          {/* Final asset selector + uploaded file */}
          <div className="md:col-span-2 border-t pt-4 space-y-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Final asset for export</Label>
            <RadioGroup
              value={draft.active_version}
              onValueChange={(v) => update({ active_version: v })}
              className="grid grid-cols-1 sm:grid-cols-3 gap-2"
            >
              <FinalAssetOption value="generated" label="Generated image" disabled={!draft.generated_asset_url} current={draft.active_version} />
              <FinalAssetOption value="generated_document" label="Generated document file" disabled={!draft.generated_document_url && !draft.generated_pdf_url} current={draft.active_version} />
              <FinalAssetOption value="uploaded" label="Uploaded file" disabled={!draft.uploaded_asset_url} current={draft.active_version} />
            </RadioGroup>
            <div className="flex gap-2 items-center">
              <input ref={fileInput} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && uploadReplacement(e.target.files[0])} />
              <Button variant="outline" className="gap-2" onClick={() => fileInput.current?.click()}>
                <Upload className="h-4 w-4" /> Upload final file
              </Button>
              {draft.uploaded_asset_url && (
                <a href={draft.uploaded_asset_url} target="_blank" rel="noreferrer" className="text-sm text-accent underline">
                  View uploaded file
                </a>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">Exports ({"Documents only"}, full zip, etc.) use the asset selected above. Uploaded files always take precedence over generated ones when picked.</p>
          </div>
        </div>
        <div className="flex justify-end pt-4 border-t">
          <Button variant="ghost" size="sm" className="text-destructive gap-2" onClick={remove}>
            <Trash2 className="h-3.5 w-3.5" /> Delete document
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    {draft.generated_asset_url && (
      <Dialog open={imagePreviewOpen} onOpenChange={setImagePreviewOpen}>
        <DialogContent className="max-w-5xl p-4">
          <div className="relative rounded-lg bg-muted overflow-hidden border">
            <img src={draft.generated_asset_url} alt="Generated document image preview" className="max-h-[82vh] w-full object-contain" />
            <AiOriginBadge
              info={{ requested: latestImageAttempt?.model ?? draft.document_model, effective: latestImageAttempt?.effective_model ?? latestImageAttempt?.model ?? draft.document_model, provider: latestImageAttempt?.provider ?? draft.document_provider, fallback: latestImageAttempt?.fallback ?? "none" }}
            />
          </div>
        </DialogContent>
      </Dialog>
    )}
    {historyPreview?.url && (
      <Dialog open={!!historyPreview} onOpenChange={(o) => !o && setHistoryPreview(null)}>
        <DialogContent className="max-w-5xl p-4">
          <div className="relative rounded-lg bg-muted overflow-hidden border">
            <img src={historyPreview.url} alt="History preview" className="max-h-[78vh] w-full object-contain" />
            <AiOriginBadge
              info={{ requested: historyPreview.model, effective: historyPreview.effective_model ?? historyPreview.model, provider: historyPreview.provider, fallback: "none" }}
            />
          </div>
          <div className="flex justify-end pt-2">
            <Button size="sm" className="gap-2" onClick={() => { restoreImageFromHistory(historyPreview); setHistoryPreview(null); }}>
              <RotateCcw className="h-3.5 w-3.5" /> Restore as Final asset image
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    )}
    </>
  );
}

function HistoryStrip({
  label,
  items,
  activeUrl,
  onPreview,
  onRestore,
  kind,
}: {
  label: string;
  items: MediaHistoryRow[];
  activeUrl: string | null;
  onPreview: (item: MediaHistoryRow) => void;
  onRestore: (item: MediaHistoryRow) => void | Promise<void>;
  kind: "image" | "document";
}) {
  return (
    <div className="mt-3 space-y-1.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</p>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {items.map((item) => {
          const isActive = item.url === activeUrl;
          return (
            <div key={item.id} className={`relative shrink-0 rounded-md border ${isActive ? "border-accent ring-2 ring-accent/40" : "border-border"} bg-muted overflow-hidden`}>
              <button
                type="button"
                onClick={() => onPreview(item)}
                className="block w-20 h-20"
                title={item.model ?? "Open"}
              >
                {kind === "image" && item.url ? (
                  <img src={item.preview_url ?? item.url} alt="History thumbnail" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-[10px] text-muted-foreground">
                    <FileText className="h-5 w-5 mb-1" />
                    {(item.document_format ?? "FILE").toUpperCase()}
                  </div>
                )}
              </button>
              {!isActive && (
                <button
                  type="button"
                  onClick={() => onRestore(item)}
                  className="absolute bottom-0 inset-x-0 bg-background/85 hover:bg-background text-[9px] uppercase tracking-wider py-0.5 text-center transition-colors"
                  title="Restore as final asset"
                >
                  Restore
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FinalAssetOption({ value, label, disabled, current }: { value: string; label: string; disabled: boolean; current: string }) {
  return (
    <label className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer ${disabled ? "opacity-50 cursor-not-allowed" : current === value ? "border-accent bg-accent/5" : "hover:bg-muted/50"}`}>
      <RadioGroupItem value={value} disabled={disabled} />
      <span>{label}</span>
    </label>
  );
}

function FieldBlock({ label, children, dir }: { label: string; children: React.ReactNode; dir?: string }) {
  return (
    <div className="space-y-1.5" dir={dir}>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{label}</Label>
      {children}
    </div>
  );
}
