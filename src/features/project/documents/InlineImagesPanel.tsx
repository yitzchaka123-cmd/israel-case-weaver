import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2, Sparkles, Loader2, Star, Upload, RotateCcw, Wand2, Palette } from "lucide-react";
import { toast } from "sonner";
import { useState, useRef } from "react";
import { getStoredWriterModel } from "@/components/PromptWriterModelPicker";
import { ImageHistoryStrip, type ImageHistoryRow } from "@/components/ImageHistoryStrip";

interface UrlHistoryEntry {
  at: string;
  url: string;
  model?: string | null;
}

interface InlineImage {
  id: string;
  document_id: string;
  project_id: string;
  position: number;
  slot_label: string;
  prompt: string | null;
  url: string | null;
  uploaded_url: string | null;
  active_version: string;
  is_anchor: boolean;
  anchor_image_id: string | null;
  anchor_reference_url: string | null;
  group_key: string | null;
  status: string;
  error_message: string | null;
  provider: string | null;
  effective_model: string | null;
  url_history: UrlHistoryEntry[] | null;
}

const LAYOUTS = [
  { value: "bottom-grid-2col", label: "Bottom — 2-col grid" },
  { value: "bottom-grid-3col", label: "Bottom — 3-col grid" },
  { value: "inline-after-text", label: "Inline after text" },
  { value: "gallery", label: "Full-width gallery" },
];

export function InlineImagesPanel({
  documentId,
  projectId,
  layout,
  caption,
  onLayoutChange,
  onCaptionChange,
}: {
  documentId: string;
  projectId: string;
  layout: string;
  caption: string;
  onLayoutChange: (v: string) => void;
  onCaptionChange: (v: string) => void;
}) {
  const { data: rows, refetch } = useQuery({
    queryKey: ["inline-images", documentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_inline_images")
        .select("*")
        .eq("document_id", documentId)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data ?? []) as InlineImage[];
    },
  });

  // Realtime: refetch when any slot changes (covers status flips during gen).
  useEffect(() => {
    const ch = supabase
      .channel(`inline-images-${documentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "document_inline_images", filter: `document_id=eq.${documentId}` },
        () => refetch())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [documentId, refetch]);

  const addSlot = async () => {
    const nextPos = (rows?.length ?? 0);
    const isFirst = nextPos === 0;
    const { error } = await supabase.from("document_inline_images").insert({
      document_id: documentId,
      project_id: projectId,
      position: nextPos,
      slot_label: `Image ${nextPos + 1}`,
      prompt: "",
      is_anchor: isFirst,
      status: "pending",
    } as never);
    if (error) toast.error(error.message);
    else refetch();
  };

  const slots = rows ?? [];
  const anchorId = slots.find((s) => s.is_anchor)?.id ?? null;

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Inline images</Label>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Embedded images rendered inside the final document (e.g. drone shots at the bottom of a surveillance report).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-8 rounded-md border bg-background px-2 text-xs"
            value={layout}
            onChange={(e) => onLayoutChange(e.target.value)}
          >
            {LAYOUTS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <Button size="sm" variant="outline" onClick={addSlot} className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Add slot</Button>
        </div>
      </div>

      <Input
        placeholder="Optional shared caption (rendered above the image grid)"
        value={caption}
        onChange={(e) => onCaptionChange(e.target.value)}
        className="h-8 text-xs"
      />

      {slots.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-xs text-muted-foreground">
          No inline images planned. The assistant adds these automatically when a document needs embedded visuals (e.g. a drone surveillance report). You can also add slots manually.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {slots.map((slot) => (
            <InlineSlotCard
              key={slot.id}
              slot={slot}
              isOnlyAnchor={anchorId === slot.id && slots.filter((s) => s.group_key === slot.group_key).length > 1}
              onChanged={refetch}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function InlineSlotCard({ slot, isOnlyAnchor, onChanged }: { slot: InlineImage; isOnlyAnchor: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [tab, setTab] = useState<"brief" | "final">("brief");
  const [instructions, setInstructions] = useState("");
  const [draftLabel, setDraftLabel] = useState(slot.slot_label);
  const [draftPrompt, setDraftPrompt] = useState(slot.prompt ?? "");
  const fileRef = useRef<HTMLInputElement>(null);

  const saveField = async (patch: Partial<InlineImage>) => {
    await supabase.from("document_inline_images").update(patch as never).eq("id", slot.id);
    onChanged();
  };

  const createPrompt = async () => {
    setDrafting(true);
    setTab("final");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const writerModel = getStoredWriterModel("inline-image");
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/suggest-image-prompt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          projectId: slot.project_id,
          category: "inline-image",
          inlineImageId: slot.id,
          userInstructions: instructions.trim() || undefined,
          currentPrompt: draftPrompt.trim() || undefined,
          writerModel: writerModel === "__project" ? undefined : writerModel,
          userId: session?.user?.id,
        }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(json.error ?? "Couldn't draft the prompt");
        return;
      }
      const next = typeof json.prompt === "string" ? json.prompt : "";
      if (next) {
        setDraftPrompt(next);
        await saveField({ prompt: next });
        toast.success(json.anchored ? "Prompt drafted (locked to anchor look)" : json.isAnchor ? "Anchor prompt drafted" : "Prompt drafted");
      }
    } finally {
      setDrafting(false);
    }
  };

  const generate = async () => {
    setBusy(true);
    try {
      // Save any pending draft first.
      if (draftLabel !== slot.slot_label || draftPrompt !== (slot.prompt ?? "")) {
        await saveField({ slot_label: draftLabel, prompt: draftPrompt });
      }
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-document-inline-image`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ inlineImageId: slot.id }),
      });
      const payload = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(payload.error ?? "Inline image generation failed", { duration: 8000 });
      } else {
        toast.success(payload.anchored ? "Variation of anchor generated" : "Image generated");
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    const path = `${slot.project_id}/inline-uploads/${slot.id}-${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("documents").upload(path, file, { upsert: true });
    if (error) return toast.error(error.message);
    const { data } = supabase.storage.from("documents").getPublicUrl(path);
    await saveField({ uploaded_url: data.publicUrl, active_version: "uploaded", status: "generated" });
    toast.success("Upload set as slot image");
  };

  const setAsAnchor = async () => {
    if (slot.is_anchor) return;
    // Demote current anchor in this group, promote this one.
    if (slot.group_key) {
      await supabase.from("document_inline_images").update({ is_anchor: false } as never)
        .eq("document_id", slot.document_id).eq("group_key", slot.group_key);
    }
    await supabase.from("document_inline_images").update({ is_anchor: true, anchor_image_id: null } as never).eq("id", slot.id);
    // Re-point siblings to the new anchor.
    if (slot.group_key) {
      await supabase.from("document_inline_images").update({ anchor_image_id: slot.id } as never)
        .eq("document_id", slot.document_id).eq("group_key", slot.group_key).neq("id", slot.id);
    }
    onChanged();
  };

  const remove = async () => {
    if (!confirm(`Delete slot "${slot.slot_label}"?`)) return;
    await supabase.from("document_inline_images").delete().eq("id", slot.id);
    onChanged();
  };

  const displayUrl = slot.active_version === "uploaded" ? slot.uploaded_url : slot.url;
  const isGenerating = slot.status === "generating" || busy;

  return (
    <div className={`rounded-lg border bg-background p-3 space-y-2 ${slot.is_anchor ? "ring-1 ring-accent/50" : ""}`}>
      <div className="aspect-square rounded-md border bg-muted overflow-hidden flex items-center justify-center">
        {displayUrl ? (
          <img src={displayUrl} alt={slot.slot_label} className="w-full h-full object-cover" />
        ) : isGenerating ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        ) : (
          <span className="text-[11px] text-muted-foreground">Empty</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {slot.is_anchor && <Badge variant="secondary" className="text-[10px] gap-1"><Star className="h-2.5 w-2.5" /> Anchor</Badge>}
        {slot.group_key && <Badge variant="outline" className="text-[10px]">{slot.group_key}</Badge>}
        {slot.status === "failed" && <Badge variant="destructive" className="text-[10px]">Failed</Badge>}
        {slot.effective_model && <Badge variant="outline" className="text-[10px]">{slot.effective_model.split("/").pop()}</Badge>}
      </div>
      <Input
        value={draftLabel}
        onChange={(e) => setDraftLabel(e.target.value)}
        onBlur={() => draftLabel !== slot.slot_label && saveField({ slot_label: draftLabel })}
        className="h-7 text-xs"
        placeholder="Slot label"
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as "brief" | "final")} className="w-full">
        <div className="flex items-center justify-between gap-2">
          <TabsList className="h-7">
            <TabsTrigger value="brief" className="text-[10px] gap-1 px-2 h-6">
              <Wand2 className="h-2.5 w-2.5" /> Reference Shot Brief
            </TabsTrigger>
            <TabsTrigger value="final" className="text-[10px] gap-1 px-2 h-6">
              <Palette className="h-2.5 w-2.5" /> Final Prompt
            </TabsTrigger>
          </TabsList>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 gap-1 text-[10px] px-2"
            onClick={createPrompt}
            disabled={drafting}
            title={slot.is_anchor || !slot.anchor_image_id
              ? "Draft a fresh anchor prompt — siblings will lock to it."
              : "Draft a sibling prompt locked to the anchor's look (only the framing varies)."}
          >
            {drafting ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Sparkles className="h-2.5 w-2.5" />}
            Create Prompt
          </Button>
        </div>
        <TabsContent value="brief" className="mt-2">
          <Textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={3}
            className="text-xs"
            placeholder={slot.is_anchor || !slot.anchor_image_id
              ? "Anchor brief — describe the look that all sibling shots will inherit (camera, lighting, palette). Empty is fine."
              : "Variation brief — describe ONLY how this shot's framing/angle differs from the anchor. Empty is fine."}
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            {slot.is_anchor
              ? "This is the anchor — its prompt locks the visual identity for sibling slots."
              : slot.anchor_image_id
                ? "Locked to anchor's camera, lighting, and palette — vary only framing."
                : "No anchor yet — this slot acts as its own reference."}
          </p>
        </TabsContent>
        <TabsContent value="final" className="mt-2">
          <Textarea
            value={draftPrompt}
            onChange={(e) => setDraftPrompt(e.target.value)}
            onBlur={() => draftPrompt !== (slot.prompt ?? "") && saveField({ prompt: draftPrompt })}
            rows={4}
            className="text-xs font-mono leading-relaxed"
            dir="ltr"
            placeholder="Click Create Prompt, or write the final image prompt here."
          />
        </TabsContent>
      </Tabs>

      {/* History reel — pick which generated image is the slot's "final".
          For anchor slots the original first-generated reference is pinned
          (and never lost), so siblings always lock to a stable look even
          when the user picks a different image as the displayed final. */}
      {(() => {
        const reel: ImageHistoryRow[] = [];
        const seen = new Set<string>();
        const push = (url: string | null, model: string | null, at: string, idSuffix: string) => {
          if (!url || seen.has(url)) return;
          seen.add(url);
          reel.push({
            id: `${slot.id}-${idSuffix}`,
            url,
            preview_url: url,
            model,
            effective_model: slot.effective_model,
            provider: slot.provider,
            fallback: null,
            created_at: at,
          });
        };
        // Currently active generated image (top of reel)
        push(slot.url, slot.effective_model, new Date().toISOString(), "current");
        // Anchor's pinned reference (always shown for anchor slots)
        if (slot.is_anchor && slot.anchor_reference_url) {
          push(slot.anchor_reference_url, slot.effective_model, new Date(0).toISOString(), "anchor-ref");
        }
        // Past generations from url_history
        (slot.url_history ?? []).forEach((h, i) => push(h.url, h.model ?? null, h.at, `hist-${i}`));

        if (reel.length === 0) return null;

        const onRestore = async (item: ImageHistoryRow) => {
          if (!item.url || item.url === slot.url) return;
          // Push the currently-active url back into history so nothing is lost.
          const currentInHist = (slot.url_history ?? []).some((h) => h.url === slot.url);
          const nextHistory: UrlHistoryEntry[] = (!currentInHist && slot.url)
            ? [{ at: new Date().toISOString(), url: slot.url, model: slot.effective_model ?? null }, ...(slot.url_history ?? [])].slice(0, 20)
            : (slot.url_history ?? []);
          await saveField({
            url: item.url,
            active_version: "generated",
            url_history: nextHistory,
          } as Partial<InlineImage>);
          toast.success("Set as final image for this slot");
        };

        return (
          <div className="space-y-1">
            <ImageHistoryStrip
              items={reel}
              currentUrl={slot.url}
              onRestore={onRestore}
              title={slot.is_anchor ? "Slot reel — anchor reference is pinned" : "Slot reel — pick the final image"}
            />
            {slot.is_anchor && slot.anchor_reference_url && (
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Star className="h-2.5 w-2.5" />
                Anchor reference is preserved — siblings always lock to it, even if you pick a different final image above.
              </p>
            )}
          </div>
        );
      })()}

      {slot.error_message && <p className="text-[10px] text-destructive">{slot.error_message}</p>}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="default" onClick={generate} disabled={isGenerating} className="gap-1.5 h-7 text-[11px]">
          {isGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {displayUrl ? "Regenerate" : "Generate"}
        </Button>
        {!slot.is_anchor && (
          <Button size="sm" variant="ghost" onClick={setAsAnchor} className="gap-1.5 h-7 text-[11px]" title="Make this the visual reference">
            <Star className="h-3 w-3" /> Set anchor
          </Button>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} className="gap-1.5 h-7 text-[11px]">
          <Upload className="h-3 w-3" /> Upload
        </Button>
        {slot.uploaded_url && slot.url && (
          <Button size="sm" variant="ghost" onClick={() => saveField({ active_version: slot.active_version === "uploaded" ? "generated" : "uploaded" })} className="gap-1.5 h-7 text-[11px]">
            <RotateCcw className="h-3 w-3" /> Use {slot.active_version === "uploaded" ? "generated" : "uploaded"}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={remove} className="gap-1.5 h-7 text-[11px] text-destructive ml-auto" disabled={isOnlyAnchor}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
