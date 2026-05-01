// 2-tab prompt assistant for Documents and Envelopes.
// Tab 1 — "Instructions": free-text steering the user types ("make it very
//   detailed", "add a coffee stain", "keep it under 200 words").
// Tab 2 — "Final prompt": the assembled output, split into Design (English)
//   and Content (project language). Both editable. This is what actually
//   gets persisted to the row + fed to image / file generators.
//
// One action button:
//   • Create prompt — fills Tab 2, no generation. User reviews.
//
// Other surfaces (cover, suspect, media, hint) keep using PromptPanel.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Sparkles, Wand2, Palette, FileText, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { PromptWriterModelPicker, getStoredWriterModel } from "./PromptWriterModelPicker";

export type AssistantTarget =
  | { kind: "document"; documentId: string }
  | { kind: "envelope"; envelopeId: string };

interface Props {
  projectId: string;
  target: AssistantTarget;
  /** Current persisted design + content (pre-fills Tab 2). */
  design: string;
  content: string;
  /** Persist edits to Tab 2 fields. Called immediately on user edit. */
  onChange: (next: { design: string; content: string }) => void;
  /** Language of the content half (Hebrew / English / etc.) for labels + dir. */
  gameLanguage?: string;
  /** Collapsed by default in archive mode. Inline = always open. */
  mode?: "inline" | "archive";
  className?: string;
}

export function DocumentPromptAssistant({
  projectId,
  target,
  design,
  content,
  onChange,
  gameLanguage = "Hebrew",
  mode = "inline",
  className,
}: Props) {
  const [tab, setTab] = useState<"instructions" | "final">("instructions");
  const [instructions, setInstructions] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [open, setOpen] = useState(mode === "inline");

  const isRtl = /^(hebrew|arabic|persian|farsi|urdu|yiddish)$/i.test(gameLanguage);

  // When the panel re-opens or the target changes, keep instructions stable
  // (component-state only — not persisted, per plan). Tab 2 fields come from
  // the parent as `design` / `content` props.
  useEffect(() => { setInstructions(""); }, [target.kind === "document" ? target.documentId : target.envelopeId]);

  const callAssistant = async (): Promise<{ design: string; content: string } | null> => {
    if (!projectId) {
      toast.error("Project not loaded yet — try again in a moment");
      return null;
    }
    const { data: { session } } = await supabase.auth.getSession();
    const writerModel = getStoredWriterModel(target.kind === "envelope" ? "document" : "document");
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/suggest-image-prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({
        projectId,
        category: target.kind === "envelope" ? "envelope-structured" : "document-structured",
        documentId: target.kind === "document" ? target.documentId : undefined,
        envelopeId: target.kind === "envelope" ? target.envelopeId : undefined,
        userInstructions: instructions.trim() || undefined,
        currentDesign: design.trim() || undefined,
        currentContent: content.trim() || undefined,
        writerModel: writerModel === "__project" ? undefined : writerModel,
        userId: session?.user?.id,
      }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      toast.error(json.error ?? "Couldn't draft the prompt");
      return null;
    }
    return {
      design: typeof json.design_instructions === "string" ? json.design_instructions : "",
      content: typeof json.content === "string" ? json.content : "",
    };
  };

  const handleGeneratePrompt = async () => {
    setDrafting(true);
    // Clear the saved Final prompt immediately — user sees the wipe, and
    // a stale prompt won't linger next to a brand-new instruction if the
    // assistant call fails. New content fills in when the call returns.
    onChange({ design: "", content: "" });
    setTab("final");
    try {
      const result = await callAssistant();
      if (!result) return;
      onChange({ design: result.design, content: result.content });
      toast.success("Prompt created — review or edit before file generation");
    } finally {
      setDrafting(false);
    }
  };

  const body = (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" />
          Prompt assistant
        </Label>
        <div className="flex items-center gap-1.5 flex-wrap">
          <PromptWriterModelPicker surface="document" />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-[11px]"
            onClick={handleGeneratePrompt}
            disabled={drafting}
            title="Create Design + Content in the Final prompt tab using the instructions."
          >
            {drafting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Draft
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "instructions" | "final")}>
        <TabsList className="h-8">
          <TabsTrigger value="instructions" className="text-[11px] gap-1.5">
            <Wand2 className="h-3 w-3" /> Instructions
          </TabsTrigger>
          <TabsTrigger value="final" className="text-[11px] gap-1.5">
            <FileText className="h-3 w-3" /> Final prompt
          </TabsTrigger>
        </TabsList>

        <TabsContent value="instructions" className="mt-2 space-y-1">
          <p className="text-[11px] text-muted-foreground">
            Free-text steering for THIS {target.kind}. Examples: <em>"make it very detailed"</em>, <em>"add a coffee stain"</em>, <em>"keep content under 200 words"</em>, <em>"emphasize the timestamp on page 2"</em>. Empty is fine — the assistant will use project context alone.
          </p>
          <Textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Type any specific guidance for this document, or leave empty and click Create prompt."
            rows={5}
            className="text-xs leading-relaxed"
          />
        </TabsContent>

        <TabsContent value="final" className="mt-2 space-y-3">
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5 mb-1">
              <Palette className="h-3 w-3" /> Design instructions (English)
            </Label>
            <Textarea
              value={design}
              onChange={(e) => onChange({ design: e.target.value, content })}
              placeholder="Generate prompt to fill, or write your own design brief here."
              rows={12}
              className="font-mono text-xs leading-relaxed"
              dir="ltr"
            />
          </div>
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5 mb-1">
              <FileText className="h-3 w-3" /> Content ({gameLanguage})
            </Label>
            <Textarea
              value={content}
              onChange={(e) => onChange({ design, content: e.target.value })}
              placeholder={`Generate prompt to fill, or paste the exact ${gameLanguage} text here.`}
              rows={10}
              className="text-sm leading-relaxed"
              dir={isRtl ? "rtl" : "ltr"}
            />
          </div>
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
