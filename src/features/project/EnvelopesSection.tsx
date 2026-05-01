// Envelopes — full design/generation surface (mirrors Documents and Suspects).
// Each envelope row carries label/task (player-facing Hebrew copy), linked
// documents, internal notes, and a separate design brief that drives the
// envelope cover mock-up via generate-image. The "Brief me" / "Generate all"
// global actions tie the assistant + bulk-AI generation together.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Mail,
  Sparkles,
  Wand2,
  Loader2,
  HelpCircle,
  ExternalLink,
  ImagePlus,
  FileText,
  ChevronDown,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AssistantOriginBadge } from "@/components/AssistantOriginBadge";
import { AiOriginBadge } from "@/components/AiOriginBadge";
import { DownloadButton } from "@/components/DownloadButton";
import {
  ImageModelPicker,
  getStoredImageModel,
  getStoredImageQuality,
} from "@/components/ImageModelPicker";

import { useProjectNotifications } from "./notifications/useProjectNotifications";
import { notifyEnvelopesDrafted } from "./notifications/triggers";
import { resolvePlaybook } from "@/lib/assistant-playbook";
import { DocumentPromptAssistant } from "@/components/DocumentPromptAssistant";
import { useBackgroundImageJob } from "@/features/project/useBackgroundImageJob";
import { GenerationTimer } from "@/features/project/GenerationTimer";
import { useImageBatchProgress } from "@/features/project/useImageBatchProgress";
import { InlineBatchStrip } from "@/features/project/InlineBatchStrip";
import { runWithConcurrency } from "@/lib/run-with-concurrency";

interface Envelope {
  id: string;
  project_id: string;
  number: number;
  label: string | null;
  task: string | null;
  notes: string | null;
  status: string;
  design_instructions: string | null;
  cover_image_url: string | null;
  linked_document_ids: string[] | null;
  linked_node_ids: string[] | null;
  created_by_message_id: string | null;
  cover_effective_model?: string | null;
  cover_fallback?: string | null;
}

interface DocOption {
  id: string;
  doc_number: number | null;
  title: string;
  envelope_number: number | null;
}

const STATUSES = ["draft", "in_progress", "review", "final"] as const;
const FOOTNOTE_HE =
  "פתחו את המעטפה הבאה רק אם אתם בטוחים שביצעתם את המשימה הקודמת כראוי.";

const STATUS_TIP =
  "Production status — used by the Production Dashboard to count progress, NOT by the player.\n" +
  "• Draft = not started\n" +
  "• In progress = being written\n" +
  "• Review = AI just produced something, check it\n" +
  "• Final = locked in for print";

export function EnvelopesSection({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<number, Partial<Envelope>>>({});
  const [generatingAll, setGeneratingAll] = useState(false);
  const [generatingAllCovers, setGeneratingAllCovers] = useState(false);
  const coverBatch = useImageBatchProgress(projectId);
  const { create: createNotification } = useProjectNotifications(projectId);

  // Owner playbook → drives envelope count + briefing prompt (count, labels,
  // closing-line rule). Falls back to defaults if not set.
  const { data: playbookRaw } = useQuery({
    queryKey: ["owner-playbook"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return {};
      const { data } = await supabase
        .from("profiles")
        .select("assistant_playbook")
        .eq("id", user.id)
        .maybeSingle();
      return ((data as { assistant_playbook?: unknown } | null)?.assistant_playbook ?? {}) as unknown;
    },
  });
  const playbook = useMemo(() => resolvePlaybook(playbookRaw), [playbookRaw]);
  const slots = useMemo(
    () =>
      Array.from({ length: playbook.envelopes.count }, (_, i) => ({
        n: i,
        label: playbook.envelopes.labels[i] ?? `Envelope ${i}`,
      })),
    [playbook],
  );

  const { data } = useQuery({
    queryKey: ["envelopes", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("envelopes")
        .select("*")
        .eq("project_id", projectId)
        .order("number");
      if (error) throw error;
      return data as Envelope[];
    },
  });

  const { data: project } = useQuery({
    queryKey: ["project-language", projectId],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("game_language, title").eq("id", projectId).maybeSingle();
      return data;
    },
  });
  const gameLanguage = project?.game_language ?? "Hebrew";
  const projectTitle = project?.title ?? "";

  const { data: docs = [] } = useQuery({
    queryKey: ["envelope-doc-options", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("id, doc_number, title, envelope_number")
        .eq("project_id", projectId)
        .order("doc_number", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as DocOption[];
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel(`envelopes-${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "envelopes", filter: `project_id=eq.${projectId}` },
        () => qc.invalidateQueries({ queryKey: ["envelopes", projectId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [projectId, qc]);

  // Fire the "envelopes_drafted" notification ONCE when every slot has both a
  // task and a design brief (transition false → true).
  const allDraftedPrev = useRef<boolean>(false);
  useEffect(() => {
    if (!data || data.length < slots.length) return;
    const allDrafted = slots.every((s) => {
      const env = data.find((e) => e.number === s.n);
      return (
        env &&
        (env.task ?? "").trim().length > 0 &&
        (env.design_instructions ?? "").trim().length > 0
      );
    });
    if (allDrafted && !allDraftedPrev.current) {
      createNotification(notifyEnvelopesDrafted());
    }
    allDraftedPrev.current = allDrafted;
  }, [data, slots, createNotification]);

  const getEnvelope = (n: number): Envelope | undefined =>
    data?.find((e) => e.number === n);

  const upsert = async (n: number, patch: Partial<Envelope>) => {
    setDraft((d) => ({ ...d, [n]: { ...d[n], ...patch } }));
    const existing = getEnvelope(n);
    if (existing) {
      await supabase.from("envelopes").update(patch).eq("id", existing.id);
    } else {
      await supabase.from("envelopes").insert({
        project_id: projectId,
        number: n,
        status: "draft",
        ...patch,
      });
    }
    qc.invalidateQueries({ queryKey: ["envelopes", projectId] });
  };

  const briefMe = () => {
    const labels = playbook.envelopes.labels.slice(0, playbook.envelopes.count).join(", ");
    const prompt =
      `Walk me through the ${playbook.envelopes.count}-envelope flow from the playbook (${labels}). ` +
      `Remember: envelopes are SEALED TASK GATES — they do NOT contain documents. All evidence lives loose in the box from the start. ` +
      `For each envelope, explain (a) the task / instruction the player reads when they open it, (b) which loose-pile clues the player should already be holding when they reach that beat, and (c) the ` +
      `closing-line rule ("${playbook.envelopes.closing_line_he}"). Then ask me which envelope ` +
      `you should help me draft first.`;
    window.dispatchEvent(new CustomEvent("mystudio:navigate", { detail: { tab: "assistant" } }));
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("mystudio:assistant-prompt", { detail: { projectId, prompt } }),
      );
    }, 50);
  };

  const generateAll = async () => {
    if (generatingAll) return;
    if (data && data.some((e) => (e.label ?? "").trim() || (e.task ?? "").trim())) {
      if (!confirm("Replace all envelope drafts with AI-generated content?")) return;
    }
    setGeneratingAll(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-envelopes`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${
              session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
            }`,
          },
          body: JSON.stringify({ projectId }),
        },
      );
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        toast.error(json.error ?? "Couldn't generate envelopes");
        return;
      }
      toast.success(`Generated ${json.count ?? slots.length} envelopes`);
      qc.invalidateQueries({ queryKey: ["envelopes", projectId] });
    } finally {
      setGeneratingAll(false);
    }
  };

  const generateAllCovers = async () => {
    if (generatingAllCovers) return;
    const targets = (data ?? []).filter((e) => !e.cover_image_url && (e.design_instructions ?? "").trim());
    if (targets.length === 0) {
      toast.info("Every envelope already has a cover (or no design instructions yet — open one to draft).");
      return;
    }
    if (!confirm(`Generate ${targets.length} envelope cover${targets.length === 1 ? "" : "s"}?`)) return;
    setGeneratingAllCovers(true);
    try {
      const modelOverride = getStoredImageModel("envelope", "chatgpt-image");
      const quality = getStoredImageQuality("envelope", "high");
      const { data: { session } } = await supabase.auth.getSession();
      const auth = `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`;
      const settled = await runWithConcurrency(targets, 3, async (env) => {
        const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-image`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: auth },
          body: JSON.stringify({
            projectId, target: "envelope", targetId: env.id,
            mode: "background", prompt: (env.design_instructions ?? "").trim(),
            modelOverride, quality, aspect: "portrait", category: "envelope",
            title: `Envelope #${env.number} — ${env.label ?? ""}`,
          }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || !json.jobId) throw new Error(json.error ?? `Failed (${resp.status})`);
        return { jobId: json.jobId as string, label: `#${env.number} ${env.label ?? ""}`.trim() };
      });
      const slots = settled.map((r, i) => {
        if (r.status === "fulfilled") return { id: r.value.jobId, label: r.value.label };
        return { id: `kick-failed-${targets[i].id}`, label: `#${targets[i].number}`, kickFailed: true as const };
      });
      coverBatch.start(slots, "Generating envelope covers");
      const failures = settled.filter((r) => r.status === "rejected").length;
      toast.success(`Started ${settled.length - failures} of ${targets.length} cover${targets.length === 1 ? "" : "s"}${failures ? ` · ${failures} kickoff failed` : ""}`);
    } finally {
      setGeneratingAllCovers(false);
    }
  };

  return (
    <TooltipProvider>
      <div className="max-w-5xl mx-auto px-6 md:px-10 py-8 space-y-6">
        <div className="flex flex-wrap items-start gap-4 justify-between">
          <div>
            <h2 className="font-display text-3xl">Envelopes</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {playbook.envelopes.count} sealed task gates — opened only when the player reaches the matching beat.
              All evidence documents live loose in the box from the start; envelopes only hold a task or reveal.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={briefMe} aria-label="Brief me on envelopes">
                  <Sparkles className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Brief me on envelopes</TooltipContent>
            </Tooltip>
            <Button className="gap-2" onClick={generateAll} disabled={generatingAll}>
              {generatingAll ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
              Draft all envelopes
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={generateAllCovers}
              disabled={generatingAllCovers}
            >
              {generatingAllCovers ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ImagePlus className="h-4 w-4" />
              )}
              Generate all covers
            </Button>
          </div>
        </div>

        <InlineBatchStrip progress={coverBatch.progress} onDismiss={coverBatch.dismiss} />

        <div className="grid gap-4">
          {slots.map((slot) => {
            const env = getEnvelope(slot.n);
            const local = draft[slot.n] ?? {};
            const value = <K extends keyof Envelope>(k: K) =>
              (local[k] as Envelope[K] | undefined) ?? env?.[k] ?? ("" as unknown as Envelope[K]);

            return (
              <EnvelopeCard
                key={slot.n}
                slot={slot}
                env={env}
                value={value}
                onUpdate={(patch) => upsert(slot.n, patch)}
                docs={docs}
                projectId={projectId}
                playbookCount={playbook.envelopes.count}
                gameLanguage={gameLanguage}
                projectTitle={projectTitle}
              />
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}

function EnvelopeCard({
  slot,
  env,
  value,
  onUpdate,
  docs,
  projectId,
  playbookCount,
  gameLanguage,
  projectTitle,
}: {
  slot: { n: number; label: string };
  env: Envelope | undefined;
  value: <K extends keyof Envelope>(k: K) => Envelope[K];
  onUpdate: (patch: Partial<Envelope>) => Promise<void>;
  docs: DocOption[];
  projectId: string;
  playbookCount: number;
  gameLanguage: string;
  projectTitle: string;
}) {
  
  const coverJob = useBackgroundImageJob({
    projectId,
    target: "envelope",
    targetId: env?.id,
    onDone: async (url) => {
      await onUpdate({ status: "review", cover_image_url: url });
      toast.success("Envelope mock-up ready");
    },
    onError: (msg) => toast.error(msg, { duration: 15000 }),
  });

  const linkedIds = (value("linked_document_ids") as string[] | null) ?? [];
  const linkedSet = new Set(linkedIds);
  const linkedDocs = docs.filter((d) => linkedSet.has(d.id));

  const toggleDoc = async (docId: string, on: boolean) => {
    if (!env) {
      // Create the envelope row first so we have an id to link to.
      await onUpdate({ linked_document_ids: on ? [docId] : [] });
    } else {
      const next = on
        ? Array.from(new Set([...linkedIds, docId]))
        : linkedIds.filter((id) => id !== docId);
      await onUpdate({ linked_document_ids: next });
    }
    // Mirror onto documents.envelope_number so the existing Documents UI stays in sync.
    await supabase
      .from("documents")
      .update({ envelope_number: on ? slot.n : null })
      .eq("id", docId);
  };

  // Legacy single-prompt drafter removed — DocumentPromptAssistant handles
  // structured Design + Content drafting now.

  const generateImage = async () => {
    const prompt = (value("design_instructions") as string)?.trim();
    if (!prompt) {
      toast.error("Add design instructions first (or click ✨ Draft prompt)");
      return;
    }
    if (!env?.id) {
      toast.error("Save the envelope first");
      return;
    }
    const modelOverride = getStoredImageModel("envelope", "chatgpt-image");
    const quality = getStoredImageQuality("envelope", "high");
    try {
      await coverJob.start({
        prompt,
        modelOverride,
        quality,
        aspect: "portrait",
        category: "envelope",
        title: `Envelope #${slot.n} — ${slot.label}`,
      });
      toast.message("Generating in the background — you can close the tab.");
    } catch {
      // start() already showed an error toast
    }
  };

  const openInAssistant = () => {
    const prompt =
      `Help me write envelope #${slot.n} (${slot.label}). ` +
      `Current Hebrew label: "${(value("label") as string) || "(empty)"}". ` +
      `Current Hebrew task: "${(value("task") as string) || "(empty)"}". ` +
      `Brief me on the playbook rules for THIS envelope, then propose a Hebrew label, ` +
      `task, and design direction.`;
    window.dispatchEvent(new CustomEvent("mystudio:navigate", { detail: { tab: "assistant" } }));
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("mystudio:assistant-prompt", { detail: { projectId, prompt } }),
      );
    }, 50);
  };

  const cover = value("cover_image_url") as string;
  const status = (value("status") as string) || "draft";
  const createdByMsg = value("created_by_message_id") as string | null;

  return (
    <div className="rounded-2xl border bg-card shadow-soft overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b bg-surface/40">
        <div className="h-10 w-10 rounded-xl bg-gradient-brand text-white flex items-center justify-center shadow-glow">
          <Mail className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display text-lg leading-tight flex items-center gap-2">
            #{slot.n} — {slot.label}
            {createdByMsg && <AssistantOriginBadge messageId={createdByMsg} />}
          </div>
          <div className="text-xs text-muted-foreground">
            Envelope {slot.n + 1} of {playbookCount}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                aria-label="Status help"
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs whitespace-pre-line">
              {STATUS_TIP}
            </TooltipContent>
          </Tooltip>
          <Select value={status} onValueChange={(v) => onUpdate({ status: v })}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">
                  {s.replace("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {env && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm(`Reset envelope #${slot.n} (${slot.label})? This clears its label, task, design, cover image, and links. The slot itself stays.`)) return;
                    const { error } = await supabase.from("envelopes").delete().eq("id", env.id);
                    if (error) { toast.error(error.message); return; }
                    // Unlink any documents that pointed to this envelope number.
                    await supabase.from("documents").update({ envelope_number: null }).eq("envelope_number", slot.n).eq("project_id", projectId);
                    toast.success(`Envelope #${slot.n} reset`);
                  }}
                  className="p-2 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  aria-label="Reset envelope"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Reset / clear this envelope</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5 p-5">
        {/* LEFT — player-facing content */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              Label (Hebrew)
            </Label>
            <Input
              dir="rtl"
              className="text-right"
              value={value("label") as string}
              onChange={(e) => onUpdate({ label: e.target.value })}
              placeholder="למשל: מעטפה ראשונה"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                Task — A4 in-character letter
              </Label>
              <TaskWordCount text={(value("task") as string) ?? ""} />
            </div>
            <Textarea
              dir={["Hebrew", "Arabic", "Persian", "Urdu", "Yiddish"].includes(gameLanguage) ? "rtl" : "ltr"}
              rows={14}
              className="text-sm leading-relaxed font-serif"
              value={value("task") as string}
              onChange={(e) => onUpdate({ task: e.target.value })}
              placeholder="Detective — you've caught a case…&#10;&#10;Full A4 letter from the Case Officer to the Detective. Vague-but-clear task. Never name specific docs or clues."
            />
            <p className="text-[11px] text-muted-foreground">
              This text fills one A4 page printed inside the envelope. Use the preview on the right to print it.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              Opening trigger
            </Label>
            <Textarea
              rows={2}
              value={value("notes") as string}
              onChange={(e) => onUpdate({ notes: e.target.value })}
              placeholder="When does the player open this envelope? e.g. 'Open after you've narrowed it to two suspects.' All documents are already in the box — this envelope holds a task or reveal, not evidence."
            />
            <p className="text-[11px] text-muted-foreground">
              Sealed task gate. Players only open this when they reach the matching beat in the case.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              Documents physically sealed inside (rare) · {linkedDocs.length}
            </Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between font-normal">
                  <span className="truncate text-sm">
                    {linkedDocs.length === 0
                      ? "Empty (default — all documents live loose in the box from the start)"
                      : linkedDocs
                          .map((d) => `#${d.doc_number ?? "?"} ${d.title}`)
                          .join(", ")}
                  </span>
                  <ChevronDown className="h-4 w-4 opacity-60 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[320px] max-h-72 overflow-y-auto" align="start">
                <DropdownMenuLabel className="text-xs">
                  Rare — only set this if you are physically sealing a document inside this envelope (e.g. a late interrogation reveal)
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {docs.length === 0 && (
                  <div className="px-2 py-3 text-xs text-muted-foreground">
                    No documents in this project yet.
                  </div>
                )}
                {docs.map((d) => {
                  const checked = linkedSet.has(d.id);
                  const otherEnv =
                    !checked && d.envelope_number != null && d.envelope_number !== slot.n
                      ? d.envelope_number
                      : null;
                  return (
                    <DropdownMenuCheckboxItem
                      key={d.id}
                      checked={checked}
                      onCheckedChange={(v) => toggleDoc(d.id, !!v)}
                      className="text-xs gap-2"
                    >
                      <FileText className="h-3 w-3 text-muted-foreground" />
                      <span className="flex-1 truncate">
                        <span className="text-muted-foreground mr-1">
                          #{d.doc_number ?? "?"}
                        </span>
                        {d.title}
                      </span>
                      {otherEnv != null && (
                        <span className="text-[10px] text-warning ml-1">→ env #{otherEnv}</span>
                      )}
                    </DropdownMenuCheckboxItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            <p className="text-[11px] text-muted-foreground">
              Default: empty. All documents live loose in the box from the start — envelopes are sealed task gates, not document containers. Use this only for the rare creative drop (≈1 per game) where you are physically sealing a document inside this envelope.
            </p>
          </div>

          <div
            className="rounded-lg bg-muted/50 border border-dashed px-3 py-2 text-[11px] text-muted-foreground"
            dir="rtl"
          >
            {FOOTNOTE_HE}
          </div>
        </div>

        {/* RIGHT — design & generation */}
        <div className="space-y-4">
          <div className="flex items-center justify-end gap-2">
            <ImageModelPicker surface="envelope" defaultModel="chatgpt-image" />
          </div>

          <DocumentPromptAssistant
            projectId={projectId}
            target={{ kind: "envelope", envelopeId: env?.id ?? "" }}
            design={(value("design_instructions") as string) ?? ""}
            content={(value("task") as string) ?? ""}
            onChange={({ design, content }) => onUpdate({ design_instructions: design, task: content })}
            gameLanguage={gameLanguage}
            mode="inline"
          />

          <div className="flex flex-wrap gap-2">
            <Button className="gap-2" onClick={generateImage} disabled={coverJob.isPending || !env?.id}>
              {coverJob.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ImagePlus className="h-4 w-4" />
              )}
              Generate envelope mock-up
            </Button>
            <Button variant="ghost" className="gap-2" onClick={openInAssistant}>
              <ExternalLink className="h-4 w-4" /> Open in Assistant
            </Button>
          </div>

          {cover ? (
            <a
              href={cover}
              target="_blank"
              rel="noreferrer"
              className="block rounded-lg overflow-hidden border bg-muted/30 hover:border-foreground/30 transition-colors relative group"
            >
              <img
                src={cover}
                alt={`Envelope ${slot.n} cover`}
                className="w-full h-auto max-h-72 object-contain"
              />
              <AiOriginBadge
                info={{
                  requested: env?.cover_image_url ? "nano-banana" : null,
                  effective: env?.cover_effective_model ?? null,
                  fallback: env?.cover_fallback ?? null,
                }}
                hoverOnly
              />
              <span className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10" onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}>
                <DownloadButton url={cover} title={`envelope-${slot.n}-${slot.label ?? ''}`} />
              </span>
              {coverJob.isPending && (
                <GenerationTimer elapsedSec={coverJob.state.elapsedSec} label="Generating mock-up" />
              )}
            </a>
          ) : (
            <div className="rounded-lg border border-dashed bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
              No mock-up yet. Generate one to preview the printed envelope.
            </div>
          )}

          <A4InsertPreview
            text={(value("task") as string) ?? ""}
            envelopeNumber={slot.n}
            envelopeLabel={slot.label}
            projectTitle={projectTitle}
            gameLanguage={gameLanguage}
          />
        </div>
      </div>
    </div>
  );
}

function TaskWordCount({ text }: { text: string }) {
  const words = (text.trim().match(/\S+/g) ?? []).length;
  const target = 350;
  const max = 500;
  const status =
    words === 0
      ? "empty"
      : words < target
        ? "short"
        : words <= max
          ? "good"
          : "long";
  const color =
    status === "good"
      ? "text-emerald-500"
      : status === "long"
        ? "text-amber-500"
        : "text-muted-foreground";
  return (
    <span className={`text-[11px] tabular-nums ${color}`}>
      {words} / ~{target}–{max} words
    </span>
  );
}

function A4InsertPreview({
  text,
  envelopeNumber,
  envelopeLabel,
  projectTitle,
  gameLanguage,
}: {
  text: string;
  envelopeNumber: number;
  envelopeLabel: string;
  projectTitle: string;
  gameLanguage: string;
}) {
  const isRtl = ["Hebrew", "Arabic", "Persian", "Urdu", "Yiddish"].includes(gameLanguage);
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    const node = printRef.current;
    if (!node) return;
    const w = window.open("", "_blank", "width=900,height=1200");
    if (!w) {
      toast.error("Pop-up blocked — allow pop-ups to print this envelope insert.");
      return;
    }
    const dirAttr = isRtl ? "rtl" : "ltr";
    w.document.write(`<!doctype html>
<html dir="${dirAttr}" lang="${isRtl ? "he" : "en"}">
<head>
<meta charset="utf-8" />
<title>Envelope #${envelopeNumber} — ${envelopeLabel}</title>
<style>
  @page { size: A4; margin: 20mm; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Georgia', 'Times New Roman', serif;
    color: #111;
    background: #fff;
    line-height: 1.55;
    font-size: 12pt;
  }
  .letterhead {
    border-bottom: 1px solid #444;
    padding-bottom: 8mm;
    margin-bottom: 8mm;
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 9pt;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #555;
    display: flex;
    justify-content: space-between;
  }
  .body { white-space: pre-wrap; }
</style>
</head>
<body>
  <div class="letterhead">
    <span>${escapeHtml(projectTitle || "Case File")}</span>
    <span>Envelope #${envelopeNumber}${envelopeLabel ? " · " + escapeHtml(envelopeLabel) : ""}</span>
  </div>
  <div class="body">${escapeHtml(text || "")}</div>
  <script>window.addEventListener('load', () => { window.focus(); window.print(); });<\/script>
</body>
</html>`);
    w.document.close();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          A4 insert preview
        </Label>
        <Button size="sm" variant="outline" className="gap-2 h-8" onClick={handlePrint} disabled={!text.trim()}>
          <Printer className="h-3.5 w-3.5" /> Print A4
        </Button>
      </div>
      <div className="rounded-lg border bg-muted/20 p-3 overflow-hidden">
        <div
          ref={printRef}
          className="bg-white text-neutral-900 shadow-sm mx-auto"
          style={{
            width: "210mm",
            minHeight: "297mm",
            padding: "20mm",
            transform: "scale(0.42)",
            transformOrigin: "top left",
            marginBottom: "calc(297mm * -0.58)",
            marginRight: "calc(210mm * -0.58)",
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontSize: "12pt",
            lineHeight: 1.55,
          }}
          dir={isRtl ? "rtl" : "ltr"}
        >
          <div
            className="flex justify-between text-[9pt] uppercase tracking-widest text-neutral-500 border-b border-neutral-400 pb-2 mb-4"
            style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif" }}
          >
            <span>{projectTitle || "Case File"}</span>
            <span>
              Envelope #{envelopeNumber}
              {envelopeLabel ? " · " + envelopeLabel : ""}
            </span>
          </div>
          <div style={{ whiteSpace: "pre-wrap" }}>
            {text || (
              <span className="text-neutral-400 italic">
                The printed insert will appear here once you write the task.
              </span>
            )}
          </div>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Live preview of the A4 page that goes inside this envelope. Click <strong>Print A4</strong> to open a print dialog scaled exactly to A4.
      </p>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
