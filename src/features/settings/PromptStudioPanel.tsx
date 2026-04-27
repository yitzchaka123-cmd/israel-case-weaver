// Prompt Studio — central editor for the global Master Prompt + per-surface
// system-prompt overrides. Reads/writes the system_prompts table and lets the
// user pick HOW the master prompt is injected (prefix, suffix, user header,
// or full replace). Every edge function that opted into resolveSystemPrompt
// will pick up changes on the next call.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type InjectionMode = "system_prefix" | "system_suffix" | "user_header" | "replace";

interface PromptRow {
  id: string;
  surface: string;
  body: string;
  injection_mode: InjectionMode;
  version: number;
  is_active: boolean;
  updated_at: string;
}

// Catalog of known surfaces, grouped. Edge functions pass these strings to
// resolveSystemPrompt({ surface }). Keep this in sync with the surface
// strings in supabase/functions/**.
const SURFACES: Array<{ group: string; items: Array<{ id: string; label: string; desc: string }> }> = [
  {
    group: "Assistant",
    items: [
      { id: "assistant-chat", label: "Project assistant chat", desc: "The main in-project chat assistant (interview, planning, edits)." },
    ],
  },
  {
    group: "Logic & canvas",
    items: [
      { id: "generate-logic-flow:fresh", label: "Logic flow — fresh", desc: "First time generating a logic flow with no approved summary." },
      { id: "generate-logic-flow:from-approved", label: "Logic flow — from approved summary", desc: "Decomposing the user's approved solution into nodes/edges." },
      { id: "explain-canvas-node", label: "Explain canvas node", desc: "Per-node explanations on the canvas." },
    ],
  },
  {
    group: "Documents",
    items: [
      { id: "generate-document:text", label: "Document body (in-world evidence)", desc: "Writes the body text of a single document." },
      { id: "generate-document:doc0", label: "Doc 0 (contents inventory)", desc: "Writes the player-facing inventory list." },
    ],
  },
  {
    group: "Envelopes",
    items: [
      { id: "generate-envelopes", label: "Envelope generator", desc: "Batch-generates label / task / opening trigger / design instructions for every envelope." },
    ],
  },
  {
    group: "Marketing & media",
    items: [
      { id: "generate-marketing-copy", label: "Marketing / packaging copy", desc: "Front + back box copy, taglines, feature bullets, etc." },
      { id: "generate-storyboard:script", label: "Storyboard — script (shots)", desc: "Generates the full shot list for a trailer." },
      { id: "generate-storyboard:prompt", label: "Storyboard — per-shot video prompt", desc: "Sora / Kling prompts for one shot." },
    ],
  },
  {
    group: "Image-prompt writer",
    items: [
      { id: "suggest-image-prompt:structured-doc", label: "Image prompts — structured documents", desc: "Multi-section image briefs for documents." },
      { id: "suggest-image-prompt:inline-image", label: "Image prompts — inline document slots", desc: "Drives the per-slot create-prompt and final-prompt." },
      { id: "suggest-image-prompt:legacy", label: "Image prompts — legacy single prompt", desc: "Single-image prompt writer used by covers, suspects, hints." },
    ],
  },
];

const MODE_LABELS: Record<InjectionMode, string> = {
  system_prefix: "Prepend to every system prompt (default)",
  system_suffix: "Append to every system prompt",
  user_header: "Inject as a header on the user message",
  replace: "Replace the surface prompt entirely (advanced)",
};

export function PromptStudioPanel() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["system_prompts", user?.id],
    queryFn: async (): Promise<PromptRow[]> => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("system_prompts")
        .select("id, surface, body, injection_mode, version, is_active, updated_at")
        .eq("owner_id", user.id);
      if (error) throw error;
      return (data ?? []) as PromptRow[];
    },
    enabled: !!user,
  });

  const bySurface = useMemo(() => {
    const m = new Map<string, PromptRow>();
    for (const r of rows) if (r.is_active) m.set(r.surface, r);
    return m;
  }, [rows]);

  const masterRow = bySurface.get("master");
  const [masterBody, setMasterBody] = useState("");
  const [masterMode, setMasterMode] = useState<InjectionMode>("system_prefix");

  useEffect(() => {
    setMasterBody(masterRow?.body ?? "");
    setMasterMode(masterRow?.injection_mode ?? "system_prefix");
  }, [masterRow?.id, masterRow?.body, masterRow?.injection_mode]);

  const upsert = async (surface: string, body: string, injection_mode: InjectionMode) => {
    if (!user) return;
    const existing = bySurface.get(surface);
    if (existing) {
      const { error } = await supabase
        .from("system_prompts")
        .update({ body, injection_mode, version: existing.version + 1, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("system_prompts").insert({
        owner_id: user.id,
        surface,
        body,
        injection_mode,
        version: 1,
        is_active: true,
        created_by: user.id,
      });
      if (error) return toast.error(error.message);
    }
    toast.success("Saved");
    qc.invalidateQueries({ queryKey: ["system_prompts", user.id] });
  };

  const reset = async (surface: string) => {
    const existing = bySurface.get(surface);
    if (!existing) return;
    const { error } = await supabase.from("system_prompts").delete().eq("id", existing.id);
    if (error) return toast.error(error.message);
    toast.success("Reset to default");
    qc.invalidateQueries({ queryKey: ["system_prompts", user?.id] });
  };

  if (!user) return null;
  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-8">
      {/* MASTER PROMPT */}
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="font-display text-lg">Master prompt</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Injected into <strong>every</strong> AI call across the workspace (assistant chat, documents,
              envelopes, marketing, storyboards, canvas explanations, image-prompt writer). Use this to
              set global voice, do/don't rules, brand language, or hard constraints.
            </p>
          </div>
          {masterRow && (
            <Badge variant="secondary" className="shrink-0">v{masterRow.version}</Badge>
          )}
        </div>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">How to inject</Label>
            <Select value={masterMode} onValueChange={(v) => setMasterMode(v as InjectionMode)}>
              <SelectTrigger className="h-9 text-xs mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(MODE_LABELS) as InjectionMode[]).map((m) => (
                  <SelectItem key={m} value={m} className="text-xs">{MODE_LABELS[m]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Master prompt body</Label>
            <Textarea
              rows={10}
              value={masterBody}
              onChange={(e) => setMasterBody(e.target.value)}
              placeholder={`e.g.\n• Always write in plain, confident English.\n• Never invent facts that aren't in the case brief.\n• Voice: noir, dry, slightly amused.\n• Avoid emoji and AI-art tropes.`}
              className="font-mono text-xs leading-relaxed mt-1.5"
            />
          </div>

          <div className="flex items-center gap-2 justify-end">
            {masterRow && (
              <Button variant="ghost" size="sm" onClick={() => reset("master")}>Clear master prompt</Button>
            )}
            <Button size="sm" onClick={() => upsert("master", masterBody, masterMode)}>
              Save master prompt
            </Button>
          </div>
        </div>
      </div>

      {/* PER-SURFACE OVERRIDES */}
      <div className="rounded-xl border bg-card p-5">
        <h3 className="font-display text-lg mb-1">Per-surface overrides</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Each surface ships with a hardcoded default prompt. Leave a surface empty to use the default.
          Anything you put here <strong>replaces</strong> just that surface's body — the master prompt
          above still wraps it according to the injection mode.
        </p>

        <Accordion type="multiple" className="w-full">
          {SURFACES.map((group) =>
            group.items.map((s) => {
              const row = bySurface.get(s.id);
              return (
                <SurfaceItem
                  key={s.id}
                  surface={s.id}
                  groupLabel={group.group}
                  label={s.label}
                  desc={s.desc}
                  row={row}
                  onSave={(body) => upsert(s.id, body, "system_prefix")}
                  onReset={() => reset(s.id)}
                />
              );
            }),
          )}
        </Accordion>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Changes apply on the next AI call — there's no deploy step. Every generation is stamped with
        the master + surface prompt versions in the AI activity log so you can correlate output
        quality with prompt edits.
      </p>
    </div>
  );
}

function SurfaceItem({
  surface, groupLabel, label, desc, row, onSave, onReset,
}: {
  surface: string;
  groupLabel: string;
  label: string;
  desc: string;
  row: PromptRow | undefined;
  onSave: (body: string) => void | Promise<void>;
  onReset: () => void | Promise<void>;
}) {
  const [body, setBody] = useState("");
  useEffect(() => { setBody(row?.body ?? ""); }, [row?.id, row?.body]);
  const hasOverride = !!row && row.body.trim().length > 0;

  return (
    <AccordionItem value={surface}>
      <AccordionTrigger className="text-sm">
        <div className="flex items-center gap-2 min-w-0 text-left">
          <Badge variant={hasOverride ? "default" : "outline"} className="text-[10px] shrink-0">
            {groupLabel}
          </Badge>
          <span className="truncate">{label}</span>
          {hasOverride && row && (
            <span className="text-[10px] text-muted-foreground shrink-0">v{row.version}</span>
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <p className="text-xs text-muted-foreground mb-2">{desc}</p>
        <p className="text-[11px] text-muted-foreground mb-2">
          Surface key: <code className="bg-muted px-1 rounded">{surface}</code>
        </p>
        <Textarea
          rows={8}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Empty = use the hardcoded default for this surface."
          className="font-mono text-xs leading-relaxed"
        />
        <div className="flex items-center gap-2 justify-end mt-2">
          {hasOverride && (
            <Button variant="ghost" size="sm" onClick={onReset}>Reset to default</Button>
          )}
          <Button size="sm" onClick={() => onSave(body)}>Save</Button>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
