// Reusable inline prompt panel used everywhere we generate an image
// (cover, suspect, document, media). Provides:
//   - editable Textarea (the prompt that will/did make the image)
//   - "Generate prompt" button (calls suggest-image-prompt)
//   - Per-image writer-model dropdown
//   - "Generate image" button (calls the parent-supplied generator)
//
// Two visual modes:
//   `mode="inline"`  — always-open form used when generating fresh
//   `mode="archive"` — collapsible "View prompt" panel shown under an
//                      already-generated image so users can inspect / edit
//                      the prompt that produced it and regenerate.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Sparkles, Wand2, FileText, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { PromptWriterModelPicker, getStoredWriterModel } from "./PromptWriterModelPicker";

interface Props {
  projectId: string;
  surface: "cover" | "suspect" | "document" | "media" | "hint";
  category?: string;       // for media tabs (cover/back/news/promo/external)
  initialPrompt?: string;  // existing prompt (archive mode) or empty (inline)
  onGenerate: (prompt: string) => Promise<void> | void;
  generating: boolean;
  /** "inline" = form, always visible. "archive" = collapsible. */
  mode?: "inline" | "archive";
  /** Optional steering hint passed only when generating prompt. */
  hint?: string;
  className?: string;
}

export function PromptPanel({
  projectId,
  surface,
  category,
  initialPrompt,
  onGenerate,
  generating,
  mode = "inline",
  hint,
  className,
}: Props) {
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [open, setOpen] = useState(mode === "inline");
  const [drafting, setDrafting] = useState(false);

  useEffect(() => { setPrompt(initialPrompt ?? ""); }, [initialPrompt]);

  const writePrompt = async () => {
    if (!projectId) {
      toast.error("Project not loaded yet — try again in a moment");
      return;
    }
    setDrafting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const writerModel = getStoredWriterModel(surface);
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/suggest-image-prompt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          projectId,
          category: category ?? surface,
          hint: hint?.trim() || undefined,
          currentPrompt: prompt.trim() || undefined,
          writerModel: writerModel === "__project" ? undefined : writerModel,
          userId: session?.user?.id,
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        toast.error(json.error ?? "Couldn't draft a prompt");
        return;
      }
      setPrompt(json.prompt);
      toast.success("Prompt drafted — review or edit before generating");
    } finally {
      setDrafting(false);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return toast.error("Write or draft a prompt first");
    await onGenerate(prompt);
  };

  const body = (
    <>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
          <FileText className="h-3 w-3" /> Image prompt
        </Label>
        <div className="flex items-center gap-1.5">
          <PromptWriterModelPicker surface={surface} />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-[11px]"
            onClick={writePrompt}
            disabled={drafting}
          >
            {drafting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {prompt.trim() ? "Revise prompt" : "Generate prompt"}
          </Button>
        </div>
      </div>
      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Click Generate prompt for an AI draft based on your case, or write your own."
        rows={mode === "archive" ? 6 : 5}
        className="font-mono text-xs leading-relaxed mt-1.5"
      />
      <div className="flex justify-end pt-2">
        <Button size="sm" className="gap-2" onClick={handleGenerate} disabled={generating || !prompt.trim()}>
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          {mode === "archive" ? "Regenerate image with this prompt" : "Generate image"}
        </Button>
      </div>
    </>
  );

  if (mode === "inline") {
    return <div className={`space-y-1 ${className ?? ""}`}>{body}</div>;
  }

  // Archive mode: collapsible
  return (
    <div className={`border rounded-xl bg-muted/30 ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground font-medium hover:text-foreground transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <FileText className="h-3 w-3" />
          {prompt.trim() ? "View / edit prompt" : "No prompt — write one"}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-3 pb-3 space-y-1">{body}</div>}
    </div>
  );
}
