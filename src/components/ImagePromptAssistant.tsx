// Image-only Prompt Assistant — same UX as DocumentPromptAssistant but with
// a single "Design" field (no project-language Content half) for surfaces
// that produce pure images: covers, suspects, hint sheets, media library.
//
// Tab 1 — "Instructions": free-text steering ("moody close-up of the locket",
//   "1970s polaroid", "no text"). Component-state only, not persisted.
// Tab 2 — "Final prompt": the assembled image prompt. Editable. This is what
//   the parent persists to its row and feeds to the image generator.
//
// One action: "Create prompt". Clears the Final prompt immediately, then fills
// it in once the assistant returns. No "Generate automatically" or "Revise".
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Sparkles, Wand2, Palette, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { PromptWriterModelPicker, getStoredWriterModel } from "./PromptWriterModelPicker";

export type ImagePromptSurface = "cover" | "suspect" | "hint" | "media";

interface Props {
  projectId: string;
  surface: ImagePromptSurface;
  /** Maps to the suggest-image-prompt `category` (e.g. "cover", "external", "hint-sheet"). */
  category: string;
  /** Optional steering hint passed as project-side context for the assistant. */
  hint?: string;
  /** Currently persisted prompt — pre-fills Tab 2. */
  prompt: string;
  /** Called when the Final prompt changes (user edit OR Create-prompt result). */
  onChange: (next: string) => void;
  /** Stable id of the target row (used so Tab 1 resets when switching items). */
  targetId?: string;
  mode?: "inline" | "archive";
  className?: string;
}

export function ImagePromptAssistant({
  projectId,
  surface,
  category,
  hint,
  prompt,
  onChange,
  targetId,
  mode = "inline",
  className,
}: Props) {
  const [tab, setTab] = useState<"instructions" | "final">("instructions");
  const [instructions, setInstructions] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [open, setOpen] = useState(mode === "inline");

  useEffect(() => { setInstructions(""); }, [targetId]);

  const callAssistant = async (): Promise<string | null> => {
    if (!projectId) {
      toast.error("Project not loaded yet — try again in a moment");
      return null;
    }
    const { data: { session } } = await supabase.auth.getSession();
    const writerModel = getStoredWriterModel(surface === "hint" ? "hint" : surface === "suspect" ? "suspect" : surface === "cover" ? "cover" : "media");
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/suggest-image-prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({
        projectId,
        category,
        hint: [hint, instructions.trim()].filter(Boolean).join(" — ") || undefined,
        currentPrompt: prompt.trim() || undefined,
        writerModel: writerModel === "__project" ? undefined : writerModel,
        userId: session?.user?.id,
      }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      toast.error(json.error ?? "Couldn't draft the prompt");
      return null;
    }
    return typeof json.prompt === "string" ? json.prompt : (typeof json.design_instructions === "string" ? json.design_instructions : null);
  };

  const handleGeneratePrompt = async () => {
    setDrafting(true);
    // Clear immediately so the user sees the slate wipe and a stale prompt
    // doesn't linger next to a brand-new instruction if the call fails.
    onChange("");
    setTab("final");
    try {
      const result = await callAssistant();
      if (!result) return;
      onChange(result);
      toast.success("Prompt created — review or edit before generating the image");
    } finally {
      setDrafting(false);
    }
  };

  const writerSurface = surface === "hint" ? "hint" : surface === "suspect" ? "suspect" : surface === "cover" ? "cover" : "media";

  const body = (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" />
          Prompt assistant
        </Label>
        <div className="flex items-center gap-1.5 flex-wrap">
          <PromptWriterModelPicker surface={writerSurface as "suspect" | "cover" | "media" | "hint"} />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-[11px]"
            onClick={handleGeneratePrompt}
            disabled={drafting}
            title="Create a fresh image prompt using your instructions and the project context."
          >
            {drafting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Create prompt
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "instructions" | "final")}>
        <TabsList className="h-8">
          <TabsTrigger value="instructions" className="text-[11px] gap-1.5">
            <Wand2 className="h-3 w-3" /> Instructions
          </TabsTrigger>
          <TabsTrigger value="final" className="text-[11px] gap-1.5">
            <Palette className="h-3 w-3" /> Final prompt
          </TabsTrigger>
        </TabsList>

        <TabsContent value="instructions" className="mt-2 space-y-1">
          <p className="text-[11px] text-muted-foreground">
            Free-text steering for THIS image. Examples: <em>"moody close-up"</em>, <em>"polaroid look"</em>, <em>"no text overlay"</em>, <em>"rainy alleyway, neon"</em>. Empty is fine — the assistant will use project context alone.
          </p>
          <Textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Type any specific guidance for this image, or leave empty and click Create prompt."
            rows={5}
            className="text-xs leading-relaxed"
          />
        </TabsContent>

        <TabsContent value="final" className="mt-2 space-y-1">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5 mb-1">
            <Palette className="h-3 w-3" /> Image prompt (English)
          </Label>
          <Textarea
            value={prompt}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Click Create prompt to fill, or write your own image prompt here."
            rows={10}
            className="font-mono text-xs leading-relaxed"
            dir="ltr"
          />
        </TabsContent>
      </Tabs>
    </div>
  );

  if (mode === "inline") {
    return <div className={`space-y-1 ${className ?? ""}`}>{body}</div>;
  }

  return (
    <div className={`border rounded-xl bg-muted/30 ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground font-medium hover:text-foreground transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" />
          Prompt assistant
        </span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-3 pb-3">{body}</div>}
    </div>
  );
}
