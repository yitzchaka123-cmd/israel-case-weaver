import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  PLAYBOOK_DEFAULTS,
  resolvePlaybook,
  renderSuspectCountsLine,
  renderHintsLine,
  renderEnvelopesLine,
  renderPhase1OrderSentence,
  renderCanonicalVocabBlock,
  renderRealismParagraphs,
  type Playbook,
  type CanonicalValue,
  type PhaseSetupStep,
} from "@/lib/assistant-playbook";
import { toast } from "sonner";
import {
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Plus,
  X,
  ArrowUp,
  ArrowDown,
  Eye,
  Save,
} from "lucide-react";

type Props = {
  // optional — none for now
};

export function AssistantPlaybookPanel({}: Props = {}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [playbook, setPlaybook] = useState<Playbook>(PLAYBOOK_DEFAULTS);
  const [open, setOpen] = useState<Record<string, boolean>>({ suspects: true });
  const [showPrompt, setShowPrompt] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const { data: stored } = useQuery({
    queryKey: ["assistant-playbook", user?.id],
    queryFn: async () => {
      if (!user) return {};
      const { data } = await supabase
        .from("profiles")
        .select("assistant_playbook")
        .eq("id", user.id)
        .maybeSingle();
      return ((data as { assistant_playbook?: unknown } | null)?.assistant_playbook ?? {}) as unknown;
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (stored !== undefined) setPlaybook(resolvePlaybook(stored));
  }, [stored]);

  const persist = async (next: Playbook) => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ assistant_playbook: next as never } as never)
      .eq("id", user.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      qc.invalidateQueries({ queryKey: ["assistant-playbook", user.id] });
      toast.success("Playbook saved");
    }
  };

  const update = <K extends keyof Playbook>(key: K, value: Playbook[K]) => {
    setPlaybook((p) => ({ ...p, [key]: value }));
  };

  const reset = (key: keyof Playbook) => {
    setPlaybook((p) => ({ ...p, [key]: PLAYBOOK_DEFAULTS[key] }));
  };

  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const togglePrompt = (id: string) => setShowPrompt((o) => ({ ...o, [id]: !o[id] }));

  return (
    <div className="space-y-3">
      {/* 1. Suspect counts */}
      <Card
        id="suspects"
        title="Suspect counts by difficulty"
        hint="Used as a guideline when the assistant proposes how many suspects fit each game."
        open={open.suspects}
        onToggle={() => toggle("suspects")}
        onReset={() => reset("suspect_counts")}
        showPrompt={showPrompt.suspects}
        onTogglePrompt={() => togglePrompt("suspects")}
        promptText={renderSuspectCountsLine(playbook)}
      >
        <div className="space-y-3">
          {(["easy", "medium", "hard"] as const).map((diff) => (
            <div key={diff} className="flex items-center gap-3">
              <div className="w-20 text-sm capitalize">{diff}</div>
              <NumInput
                value={playbook.suspect_counts[diff].min}
                onChange={(v) =>
                  update("suspect_counts", {
                    ...playbook.suspect_counts,
                    [diff]: { ...playbook.suspect_counts[diff], min: v },
                  })
                }
              />
              <span className="text-muted-foreground text-sm">to</span>
              <NumInput
                value={playbook.suspect_counts[diff].max}
                onChange={(v) =>
                  update("suspect_counts", {
                    ...playbook.suspect_counts,
                    [diff]: { ...playbook.suspect_counts[diff], max: v },
                  })
                }
              />
              <span className="text-xs text-muted-foreground">
                default {PLAYBOOK_DEFAULTS.suspect_counts[diff].min}–
                {PLAYBOOK_DEFAULTS.suspect_counts[diff].max}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* 2. Hints */}
      <Card
        id="hints"
        title="Hints per stage"
        hint="How many graduated hints the assistant writes for each story stage, and the labels for each rung of the ladder."
        open={open.hints}
        onToggle={() => toggle("hints")}
        onReset={() => reset("hints")}
        showPrompt={showPrompt.hints}
        onTogglePrompt={() => togglePrompt("hints")}
        promptText={renderHintsLine(playbook)}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Label className="w-32">Hints per stage</Label>
            <NumInput
              value={playbook.hints.per_stage}
              onChange={(v) => {
                const labels = [...playbook.hints.ladder_labels];
                while (labels.length < v) labels.push(`level ${labels.length + 1}`);
                while (labels.length > v) labels.pop();
                update("hints", { per_stage: v, ladder_labels: labels });
              }}
            />
            <span className="text-xs text-muted-foreground">default {PLAYBOOK_DEFAULTS.hints.per_stage}</span>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Ladder labels (vague → giveaway)</Label>
            {playbook.hints.ladder_labels.map((lab, i) => (
              <Input
                key={i}
                value={lab}
                onChange={(e) => {
                  const next = [...playbook.hints.ladder_labels];
                  next[i] = e.target.value;
                  update("hints", { ...playbook.hints, ladder_labels: next });
                }}
                placeholder={`Label ${i + 1}`}
                className="h-8 text-sm"
              />
            ))}
          </div>
        </div>
      </Card>

      {/* 3. Envelopes */}
      <Card
        id="envelopes"
        title="Envelopes"
        hint="How many envelopes ship in the box and what each one is named. The closing Hebrew line gets stamped at the end of every envelope."
        open={open.envelopes}
        onToggle={() => toggle("envelopes")}
        onReset={() => reset("envelopes")}
        showPrompt={showPrompt.envelopes}
        onTogglePrompt={() => togglePrompt("envelopes")}
        promptText={renderEnvelopesLine(playbook)}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Label className="w-32">Envelope count</Label>
            <NumInput
              value={playbook.envelopes.count}
              onChange={(v) => {
                const labels = [...playbook.envelopes.labels];
                while (labels.length < v) labels.push(String(labels.length));
                while (labels.length > v) labels.pop();
                update("envelopes", { ...playbook.envelopes, count: v, labels });
              }}
            />
            <span className="text-xs text-muted-foreground">default {PLAYBOOK_DEFAULTS.envelopes.count}</span>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Labels (in order)</Label>
            {playbook.envelopes.labels.map((lab, i) => (
              <Input
                key={i}
                value={lab}
                onChange={(e) => {
                  const next = [...playbook.envelopes.labels];
                  next[i] = e.target.value;
                  update("envelopes", { ...playbook.envelopes, labels: next });
                }}
                className="h-8 text-sm"
              />
            ))}
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Closing line (Hebrew, RTL)</Label>
            <Textarea
              dir="rtl"
              rows={2}
              value={playbook.envelopes.closing_line_he}
              onChange={(e) => update("envelopes", { ...playbook.envelopes, closing_line_he: e.target.value })}
              className="text-sm"
            />
          </div>
        </div>
      </Card>

      {/* 4. Phase 1 setup order */}
      <Card
        id="phase1"
        title="Phase 1 setup order"
        hint="The ordered checklist the assistant runs through when starting a new case. Toggle steps off to skip them, or reorder them."
        open={open.phase1}
        onToggle={() => toggle("phase1")}
        onReset={() => reset("phase1_setup")}
        showPrompt={showPrompt.phase1}
        onTogglePrompt={() => togglePrompt("phase1")}
        promptText={renderPhase1OrderSentence(playbook)}
      >
        <div className="space-y-3">
          <div className="space-y-2">
            {playbook.phase1_setup.order.map((step, i) => (
              <div key={step.key} className="flex items-center gap-2 rounded-md border bg-surface px-2 py-1.5">
                <div className="flex flex-col">
                  <button
                    className="h-4 w-5 inline-flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
                    disabled={i === 0}
                    onClick={() => {
                      const next = [...playbook.phase1_setup.order];
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      update("phase1_setup", { ...playbook.phase1_setup, order: next });
                    }}
                  >
                    <ArrowUp className="h-3 w-3" />
                  </button>
                  <button
                    className="h-4 w-5 inline-flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
                    disabled={i === playbook.phase1_setup.order.length - 1}
                    onClick={() => {
                      const next = [...playbook.phase1_setup.order];
                      [next[i + 1], next[i]] = [next[i], next[i + 1]];
                      update("phase1_setup", { ...playbook.phase1_setup, order: next });
                    }}
                  >
                    <ArrowDown className="h-3 w-3" />
                  </button>
                </div>
                <div className="flex-1 text-sm">
                  <span className="text-muted-foreground text-[10px] mr-2">{i + 1}.</span>
                  {step.label}
                </div>
                <Switch
                  checked={step.enabled}
                  onCheckedChange={(checked) => {
                    const next = playbook.phase1_setup.order.map((s, idx) =>
                      idx === i ? { ...s, enabled: checked } : s,
                    );
                    update("phase1_setup", { ...playbook.phase1_setup, order: next });
                  }}
                />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 pt-1">
            <Label className="w-40">Title options to propose</Label>
            <NumInput
              value={playbook.phase1_setup.title_options_count}
              onChange={(v) => update("phase1_setup", { ...playbook.phase1_setup, title_options_count: v })}
            />
            <span className="text-xs text-muted-foreground">default {PLAYBOOK_DEFAULTS.phase1_setup.title_options_count}</span>
          </div>
        </div>
      </Card>

      {/* 5. Canonical vocab */}
      <Card
        id="vocab"
        title="Canonical vocabulary"
        hint="The closed lists the assistant must map any user input to. Synonyms (Hebrew or English) make the mapping smarter."
        open={open.vocab}
        onToggle={() => toggle("vocab")}
        onReset={() => reset("vocab")}
        showPrompt={showPrompt.vocab}
        onTogglePrompt={() => togglePrompt("vocab")}
        promptText={renderCanonicalVocabBlock(playbook)}
      >
        <div className="space-y-5">
          {(["mystery_type", "genre", "difficulty"] as const).map((field) => (
            <VocabEditor
              key={field}
              label={field.replace("_", " ")}
              values={playbook.vocab[field]}
              onChange={(next) => update("vocab", { ...playbook.vocab, [field]: next })}
            />
          ))}
        </div>
      </Card>

      {/* 6. Realism floor */}
      <Card
        id="realism"
        title="Realism floor"
        hint="Minimum number of concrete details the assistant must add to every document brief, split between real-world and creative props."
        open={open.realism}
        onToggle={() => toggle("realism")}
        onReset={() => reset("realism")}
        showPrompt={showPrompt.realism}
        onTogglePrompt={() => togglePrompt("realism")}
        promptText={renderRealismParagraphs(playbook).split("\n\n")[0]}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Label className="w-56">Real-world docs (min details)</Label>
            <NumInput
              value={playbook.realism.realworld_min_details}
              onChange={(v) => update("realism", { ...playbook.realism, realworld_min_details: v })}
            />
            <span className="text-xs text-muted-foreground">default {PLAYBOOK_DEFAULTS.realism.realworld_min_details}</span>
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-56">Creative props (min)</Label>
            <NumInput
              value={playbook.realism.creative_min_details}
              onChange={(v) => update("realism", { ...playbook.realism, creative_min_details: v })}
            />
            <span className="text-xs text-muted-foreground">default {PLAYBOOK_DEFAULTS.realism.creative_min_details}</span>
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-56">Creative props (max)</Label>
            <NumInput
              value={playbook.realism.creative_max_details}
              onChange={(v) => update("realism", { ...playbook.realism, creative_max_details: v })}
            />
            <span className="text-xs text-muted-foreground">default {PLAYBOOK_DEFAULTS.realism.creative_max_details}</span>
          </div>
        </div>
      </Card>

      {/* 7. Doc generation */}
      <Card
        id="docgen"
        title="Document generation default"
        hint="When you start writing documents in Phase 4, this controls whether the assistant asks every time or just goes."
        open={open.docgen}
        onToggle={() => toggle("docgen")}
        onReset={() => reset("doc_generation")}
        showPrompt={showPrompt.docgen}
        onTogglePrompt={() => togglePrompt("docgen")}
        promptText={`Doc-generation default: ${playbook.doc_generation.default_mode}${playbook.doc_generation.ask_each_new_project ? " (still ask in each new project)" : " (apply silently to new projects)"}`}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(["unset", "drafts", "auto", "ask"] as const).map((m) => (
              <button
                key={m}
                onClick={() => update("doc_generation", { ...playbook.doc_generation, default_mode: m })}
                className={[
                  "px-3 py-1.5 text-xs font-medium rounded-md border transition-colors",
                  playbook.doc_generation.default_mode === m
                    ? "border-accent bg-accent/10 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {m === "unset" ? "Ask each project" : m}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 pt-1">
            <Switch
              checked={playbook.doc_generation.ask_each_new_project}
              onCheckedChange={(checked) =>
                update("doc_generation", { ...playbook.doc_generation, ask_each_new_project: checked })
              }
            />
            <Label className="text-xs text-muted-foreground">
              Always ask in each new project (overrides the default mode for the first Phase 4 entry)
            </Label>
          </div>
        </div>
      </Card>

      <div className="flex justify-end pt-2 sticky bottom-0 bg-card -mx-6 px-6 py-3 border-t">
        <Button onClick={() => persist(playbook)} disabled={saving}>
          <Save className="h-4 w-4 mr-1.5" /> {saving ? "Saving..." : "Save playbook"}
        </Button>
      </div>
    </div>
  );
}

function NumInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <Input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value || 0))}
      className="h-8 w-20 text-sm"
    />
  );
}

function Card({
  title,
  hint,
  children,
  open,
  onToggle,
  onReset,
  showPrompt,
  onTogglePrompt,
  promptText,
}: {
  id: string;
  title: string;
  hint: string;
  children: React.ReactNode;
  open?: boolean;
  onToggle: () => void;
  onReset: () => void;
  showPrompt?: boolean;
  onTogglePrompt: () => void;
  promptText: string;
}) {
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors text-left"
      >
        <div className="min-w-0">
          <div className="font-medium text-sm">{title}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t">
          {children}
          <div className="flex items-center justify-between pt-2 border-t">
            <button
              onClick={onTogglePrompt}
              className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <Eye className="h-3 w-3" /> {showPrompt ? "Hide" : "Show"} prompt fragment
            </button>
            <button
              onClick={onReset}
              className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <RotateCcw className="h-3 w-3" /> Reset to default
            </button>
          </div>
          {showPrompt && (
            <pre className="rounded-md border bg-muted/40 px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap font-mono text-foreground/90 max-h-60 overflow-auto">
              {promptText}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function VocabEditor({
  label,
  values,
  onChange,
}: {
  label: string;
  values: CanonicalValue[];
  onChange: (next: CanonicalValue[]) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="capitalize text-xs font-medium">{label}</Label>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-xs"
          onClick={() => onChange([...values, { value: "", synonyms: [] }])}
        >
          <Plus className="h-3 w-3 mr-1" /> Add
        </Button>
      </div>
      <div className="space-y-1.5">
        {values.map((v, i) => (
          <div key={i} className="flex items-start gap-2 rounded-md border bg-surface p-2">
            <div className="flex-1 space-y-1.5 min-w-0">
              <Input
                value={v.value}
                onChange={(e) => {
                  const next = [...values];
                  next[i] = { ...v, value: e.target.value };
                  onChange(next);
                }}
                placeholder="Canonical value"
                className="h-7 text-sm"
              />
              <Input
                value={v.synonyms.join(", ")}
                onChange={(e) => {
                  const next = [...values];
                  next[i] = {
                    ...v,
                    synonyms: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                  };
                  onChange(next);
                }}
                placeholder="Synonyms (comma-separated)"
                className="h-7 text-xs"
              />
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              onClick={() => onChange(values.filter((_, idx) => idx !== i))}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
