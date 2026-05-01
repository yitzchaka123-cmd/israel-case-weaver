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
  renderIdentityBlock,
  renderContentRulesBlock,
  renderDesignSkeletonLine,
  renderDocModeButtonsBlock,
  renderLogicGateRefusal,
  renderCatalogsBlock,
  renderLanguagesBlock,
  renderUniversalDocumentsBlock,
  renderPhaseEnumComment,
  renderExplanationLengthLine,
  type Playbook,
  type CanonicalValue,
  type DesignSkeletonSection,
  type PhaseDefinition,
  type UniversalDocumentDefinition,
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
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Envelope design brief template
            </Label>
            <p className="text-[11px] text-muted-foreground -mt-1">
              Used as the seed when "Draft prompt" is clicked on an envelope row. The model
              customises it per envelope (label, task, era, genre) before generating the mock-up.
            </p>
            <Textarea
              rows={10}
              value={playbook.envelopes.design_brief_template}
              onChange={(e) =>
                update("envelopes", { ...playbook.envelopes, design_brief_template: e.target.value })
              }
              className="text-xs font-mono leading-relaxed"
              placeholder="GOAL · OUTPUT FORMAT · VISUAL STYLE · LAYOUT · TYPOGRAPHY · AUTHENTICITY"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Envelope task body template (A4 in-character letter)
            </Label>
            <p className="text-[11px] text-muted-foreground -mt-1">
              The voice + structure rules the model follows when writing the printed insert
              that goes inside each envelope. Detective hand-off, vague-but-clear task,
              never references specific docs or clues.
            </p>
            <Textarea
              rows={14}
              value={playbook.envelopes.task_voice_template}
              onChange={(e) =>
                update("envelopes", { ...playbook.envelopes, task_voice_template: e.target.value })
              }
              className="text-xs font-mono leading-relaxed"
              placeholder="LENGTH · VOICE · REQUIRED STRUCTURE · ANTI-SPOILER RULE"
            />
          </div>
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
          <p className="text-xs text-muted-foreground">
            The default setup includes Game language. Older saved playbooks will automatically get this step added back.
          </p>
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
          <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground leading-relaxed">
            Selected document models must get the first honest chance to create downloadable files. Failures are saved as failed assets, prompts are saved to prompts/run logs/media metadata, and Claude can use enabled Skills for chat, documents, marketing, analysis, and media planning.
          </div>
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
          <div className="grid gap-2 sm:grid-cols-2">
            <ToggleRow label="Ask selected model to create the file directly first" checked={playbook.doc_generation.direct_file_first} onChange={(checked) => update("doc_generation", { ...playbook.doc_generation, direct_file_first: checked })} />
            <ToggleRow label="No silent cross-model fallback for document files" checked={playbook.doc_generation.strict_model_ownership} onChange={(checked) => update("doc_generation", { ...playbook.doc_generation, strict_model_ownership: checked })} />
            <ToggleRow label="Save PDF/document prompts in logs and assets" checked={playbook.doc_generation.save_file_prompts} onChange={(checked) => update("doc_generation", { ...playbook.doc_generation, save_file_prompts: checked })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Default output type</Label>
            <div className="flex flex-wrap gap-2">
              {(["ask", "image", "document", "both"] as const).map((value) => (
                <Button key={value} type="button" variant={playbook.doc_generation.output_type_default === value ? "default" : "outline"} size="sm" className="h-7 capitalize" onClick={() => update("doc_generation", { ...playbook.doc_generation, output_type_default: value })}>
                  {value}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* 8. AI explanations */}
      <Card
        id="explanations"
        title="AI explanation length"
        hint="Controls how short the AI explanation should be on Logic Flow and Final nodes."
        open={open.explanations}
        onToggle={() => toggle("explanations")}
        onReset={() => reset("explanations")}
        showPrompt={showPrompt.explanations}
        onTogglePrompt={() => togglePrompt("explanations")}
        promptText={renderExplanationLengthLine(playbook)}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Label className="w-44">Short paragraphs</Label>
            <NumInput
              value={playbook.explanations.paragraphs}
              onChange={(v) => update("explanations", { ...playbook.explanations, paragraphs: v })}
            />
            <span className="text-xs text-muted-foreground">default {PLAYBOOK_DEFAULTS.explanations.paragraphs}</span>
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-44">Max words total</Label>
            <NumInput
              value={playbook.explanations.max_words}
              onChange={(v) => update("explanations", { ...playbook.explanations, max_words: v })}
            />
            <span className="text-xs text-muted-foreground">default {PLAYBOOK_DEFAULTS.explanations.max_words}</span>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <Switch
              checked={playbook.explanations.include_suggestion}
              onCheckedChange={(checked) =>
                update("explanations", { ...playbook.explanations, include_suggestion: checked })
              }
            />
            <Label className="text-xs text-muted-foreground">Include a strengthening suggestion when useful</Label>
          </div>
        </div>
      </Card>

      {/* 8. Identity & voice */}
      <Card
        id="identity"
        title="Identity & voice"
        hint="The high-level voice/style header injected at the top of every system prompt."
        open={open.identity}
        onToggle={() => toggle("identity")}
        onReset={() => reset("identity")}
        showPrompt={showPrompt.identity}
        onTogglePrompt={() => togglePrompt("identity")}
        promptText={renderIdentityBlock(playbook)}
      >
        <div className="space-y-3">
          {([
            ["planning_language", "Planning language"],
            ["final_content_language", "Final in-game content language"],
            ["brand_voice", "Brand voice"],
            ["setting_flavor", "Setting flavor"],
          ] as const).map(([k, label]) => (
            <div key={k} className="space-y-1">
              <Label className="text-xs">{label}</Label>
              <Textarea
                rows={k === "brand_voice" || k === "setting_flavor" ? 2 : 1}
                value={playbook.identity[k]}
                onChange={(e) => update("identity", { ...playbook.identity, [k]: e.target.value })}
                className="text-sm"
              />
              <div className="text-[10px] text-muted-foreground truncate">
                default: {PLAYBOOK_DEFAULTS.identity[k]}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* 9. Content rules */}
      <Card
        id="contentrules"
        title="Content rules"
        hint="Strict do-not-do bullets the assistant must obey. Rendered verbatim under CONTENT RULES."
        open={open.contentrules}
        onToggle={() => toggle("contentrules")}
        onReset={() => reset("content_rules")}
        showPrompt={showPrompt.contentrules}
        onTogglePrompt={() => togglePrompt("contentrules")}
        promptText={renderContentRulesBlock(playbook)}
      >
        <StringListEditor
          values={playbook.content_rules}
          onChange={(next) => update("content_rules", next)}
          placeholder="One rule per line, e.g. No real politicians by name."
          multiline
        />
      </Card>

      {/* 10. Design skeleton */}
      <Card
        id="skeleton"
        title="Document design-instructions skeleton"
        hint="The ordered sections every add_document call must produce. Toggle, rename, reorder, or add new ones."
        open={open.skeleton}
        onToggle={() => toggle("skeleton")}
        onReset={() => reset("design_skeleton")}
        showPrompt={showPrompt.skeleton}
        onTogglePrompt={() => togglePrompt("skeleton")}
        promptText={renderDesignSkeletonLine(playbook)}
      >
        <SectionListEditor
          values={playbook.design_skeleton}
          onChange={(next) => update("design_skeleton", next)}
        />
      </Card>

      {/* 11. Doc-mode copy */}
      <Card
        id="docmodecopy"
        title="Doc-generation mode labels & gate copy"
        hint="The 3 button labels shown on first Phase 4 entry, plus the refusal text the assistant says when the Logic Flow isn't approved."
        open={open.docmodecopy}
        onToggle={() => toggle("docmodecopy")}
        onReset={() => reset("doc_mode_copy")}
        showPrompt={showPrompt.docmodecopy}
        onTogglePrompt={() => togglePrompt("docmodecopy")}
        promptText={`${renderDocModeButtonsBlock(playbook)}\n\nLogic-flow refusal:\n${renderLogicGateRefusal(playbook)}`}
      >
        <div className="space-y-3">
          {([
            ["drafts_label", "Drafts button"],
            ["auto_label", "Full-auto button"],
            ["ask_label", "Ask-each-time button"],
          ] as const).map(([k, label]) => (
            <div key={k} className="space-y-1">
              <Label className="text-xs">{label}</Label>
              <Input
                value={playbook.doc_mode_copy[k]}
                onChange={(e) => update("doc_mode_copy", { ...playbook.doc_mode_copy, [k]: e.target.value })}
                className="h-8 text-sm"
              />
            </div>
          ))}
          <div className="space-y-1">
            <Label className="text-xs">Logic-flow gate refusal message</Label>
            <Textarea
              rows={3}
              value={playbook.doc_mode_copy.logic_gate_refusal}
              onChange={(e) =>
                update("doc_mode_copy", { ...playbook.doc_mode_copy, logic_gate_refusal: e.target.value })
              }
              className="text-sm"
            />
          </div>
        </div>
      </Card>

      {/* 12. Catalogs */}
      <Card
        id="catalogs"
        title="Document catalogs"
        hint="Reference lists of print sizes and document types the assistant picks from when proposing documents."
        open={open.catalogs}
        onToggle={() => toggle("catalogs")}
        onReset={() => reset("catalogs")}
        showPrompt={showPrompt.catalogs}
        onTogglePrompt={() => togglePrompt("catalogs")}
        promptText={renderCatalogsBlock(playbook)}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs font-medium">Print sizes</Label>
            <StringListEditor
              values={playbook.catalogs.print_sizes}
              onChange={(next) => update("catalogs", { ...playbook.catalogs, print_sizes: next })}
              placeholder="e.g. A4"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-medium">Document types</Label>
            <StringListEditor
              values={playbook.catalogs.document_types}
              onChange={(next) => update("catalogs", { ...playbook.catalogs, document_types: next })}
              placeholder="e.g. memo"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-medium">Unusual / creative-prop document types</Label>
            <p className="text-xs text-muted-foreground">
              Tactile, surprising, hand-made props (maps, ciphers, polaroids, matchbooks, etc.). The
              assistant treats these as creative props, not bureaucratic paperwork — they trigger the
              creative-realism floor instead of the 20-detail photo-realism floor.
            </p>
            <StringListEditor
              values={playbook.catalogs.unusual_document_types}
              onChange={(next) =>
                update("catalogs", { ...playbook.catalogs, unusual_document_types: next })
              }
              placeholder="e.g. hand-drawn map"
            />
          </div>
        </div>
      </Card>

      {/* 13. Universal documents */}
      <Card
        id="universal"
        title="Universal documents"
        hint="Project-wide documents that every game should include, especially Doc 0 / box contents."
        open={open.universal}
        onToggle={() => toggle("universal")}
        onReset={() => reset("universal_documents")}
        showPrompt={showPrompt.universal}
        onTogglePrompt={() => togglePrompt("universal")}
        promptText={renderUniversalDocumentsBlock(playbook)}
      >
        <div className="space-y-3">
          <ToggleRow label="Enable Doc 0 contents inventory" checked={playbook.universal_documents.doc0_enabled} onChange={(checked) => update("universal_documents", { ...playbook.universal_documents, doc0_enabled: checked })} />
          <UniversalDocsEditor
            values={playbook.universal_documents.docs}
            onChange={(docs) => update("universal_documents", { ...playbook.universal_documents, docs })}
          />
        </div>
      </Card>

      {/* 14. Languages */}
      <Card
        id="languages"
        title="Game languages"
        hint="Languages the assistant can offer as per-case final in-game content options during setup."
        open={open.languages}
        onToggle={() => toggle("languages")}
        onReset={() => reset("languages")}
        showPrompt={showPrompt.languages}
        onTogglePrompt={() => togglePrompt("languages")}
        promptText={renderLanguagesBlock(playbook)}
      >
        <StringListEditor
          values={playbook.languages.options}
          onChange={(next) => update("languages", { options: next })}
          placeholder="e.g. Italian"
        />
      </Card>

      {/* 15. Phase definitions */}
      <Card
        id="phases"
        title="Phase definitions"
        hint="The ordered phases the project moves through. Renaming a key won't migrate existing projects — they keep their old phase string until you edit them."
        open={open.phases}
        onToggle={() => toggle("phases")}
        onReset={() => reset("phases")}
        showPrompt={showPrompt.phases}
        onTogglePrompt={() => togglePrompt("phases")}
        promptText={renderPhaseEnumComment(playbook)}
      >
        <PhaseListEditor
          values={playbook.phases}
          onChange={(next) => update("phases", next)}
        />
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

function StringListEditor({
  values,
  onChange,
  placeholder,
  multiline,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      {values.map((v, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="flex flex-col">
            <button
              className="h-4 w-5 inline-flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
              disabled={i === 0}
              onClick={() => {
                const next = [...values];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                onChange(next);
              }}
            >
              <ArrowUp className="h-3 w-3" />
            </button>
            <button
              className="h-4 w-5 inline-flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
              disabled={i === values.length - 1}
              onClick={() => {
                const next = [...values];
                [next[i + 1], next[i]] = [next[i], next[i + 1]];
                onChange(next);
              }}
            >
              <ArrowDown className="h-3 w-3" />
            </button>
          </div>
          {multiline ? (
            <Textarea
              rows={2}
              value={v}
              onChange={(e) => {
                const next = [...values];
                next[i] = e.target.value;
                onChange(next);
              }}
              placeholder={placeholder}
              className="text-sm flex-1"
            />
          ) : (
            <Input
              value={v}
              onChange={(e) => {
                const next = [...values];
                next[i] = e.target.value;
                onChange(next);
              }}
              placeholder={placeholder}
              className="h-8 text-sm flex-1"
            />
          )}
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
      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onChange([...values, ""])}>
        <Plus className="h-3 w-3 mr-1" /> Add
      </Button>
    </div>
  );
}

function SectionListEditor({
  values,
  onChange,
}: {
  values: DesignSkeletonSection[];
  onChange: (next: DesignSkeletonSection[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      {values.map((s, i) => (
        <div key={s.key + i} className="flex items-start gap-2 rounded-md border bg-surface p-2">
          <div className="flex flex-col">
            <button
              className="h-4 w-5 inline-flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
              disabled={i === 0}
              onClick={() => {
                const next = [...values];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                onChange(next);
              }}
            >
              <ArrowUp className="h-3 w-3" />
            </button>
            <button
              className="h-4 w-5 inline-flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
              disabled={i === values.length - 1}
              onClick={() => {
                const next = [...values];
                [next[i + 1], next[i]] = [next[i], next[i + 1]];
                onChange(next);
              }}
            >
              <ArrowDown className="h-3 w-3" />
            </button>
          </div>
          <div className="flex-1 space-y-1 min-w-0">
            <Input
              value={s.name}
              onChange={(e) => {
                const next = [...values];
                next[i] = { ...s, name: e.target.value };
                onChange(next);
              }}
              placeholder="SECTION NAME"
              className="h-7 text-sm font-medium"
            />
            <Input
              value={s.note}
              onChange={(e) => {
                const next = [...values];
                next[i] = { ...s, note: e.target.value };
                onChange(next);
              }}
              placeholder="One-line guidance (optional)"
              className="h-7 text-xs"
            />
          </div>
          <Switch
            checked={s.enabled}
            onCheckedChange={(checked) => {
              const next = [...values];
              next[i] = { ...s, enabled: checked };
              onChange(next);
            }}
          />
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
      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-xs"
        onClick={() =>
          onChange([
            ...values,
            { key: `section_${values.length + 1}`, name: "NEW SECTION", note: "", enabled: true },
          ])
        }
      >
        <Plus className="h-3 w-3 mr-1" /> Add section
      </Button>
    </div>
  );
}

function UniversalDocsEditor({ values, onChange }: { values: UniversalDocumentDefinition[]; onChange: (next: UniversalDocumentDefinition[]) => void }) {
  return (
    <div className="space-y-2">
      {values.map((doc, i) => (
        <div key={doc.key + i} className="space-y-2 rounded-md border bg-surface p-2">
          <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
            <span className="font-mono">{doc.key}</span>
            <span>Doc 0 is generated from the Final Flow, not guessed from the case summary.</span>
          </div>
          <div className="flex items-center gap-2">
            <Input value={doc.title_template} onChange={(e) => { const next = [...values]; next[i] = { ...doc, title_template: e.target.value }; onChange(next); }} className="h-8 text-sm font-medium" placeholder="Title template" />
            <Switch checked={doc.enabled} onCheckedChange={(checked) => { const next = [...values]; next[i] = { ...doc, enabled: checked }; onChange(next); }} />
          </div>
          <Textarea value={doc.purpose} onChange={(e) => { const next = [...values]; next[i] = { ...doc, purpose: e.target.value }; onChange(next); }} rows={3} className="text-xs" placeholder="Purpose / rules" />
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Doc type</Label>
              <Input value={doc.doc_type} onChange={(e) => { const next = [...values]; next[i] = { ...doc, doc_type: e.target.value }; onChange(next); }} className="h-8 text-xs" placeholder="Doc type" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Print size</Label>
              <Input value={doc.print_size} onChange={(e) => { const next = [...values]; next[i] = { ...doc, print_size: e.target.value }; onChange(next); }} className="h-8 text-xs" placeholder="Print size" />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <select value={doc.list_scope} onChange={(e) => { const next = [...values]; next[i] = { ...doc, list_scope: e.target.value === "generated" ? "generated" : "planned" }; onChange(next); }} className="h-8 rounded-md border bg-background px-2 text-xs">
              <option value="planned">planned</option>
              <option value="generated">generated</option>
            </select>
          </div>
        </div>
      ))}
    </div>
  );
}

function PhaseListEditor({
  values,
  onChange,
}: {
  values: PhaseDefinition[];
  onChange: (next: PhaseDefinition[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      {values.map((p, i) => (
        <div key={p.key + i} className="flex items-start gap-2 rounded-md border bg-surface p-2">
          <div className="flex flex-col">
            <button
              className="h-4 w-5 inline-flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
              disabled={i === 0}
              onClick={() => {
                const next = [...values];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                onChange(next);
              }}
            >
              <ArrowUp className="h-3 w-3" />
            </button>
            <button
              className="h-4 w-5 inline-flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
              disabled={i === values.length - 1}
              onClick={() => {
                const next = [...values];
                [next[i + 1], next[i]] = [next[i], next[i + 1]];
                onChange(next);
              }}
            >
              <ArrowDown className="h-3 w-3" />
            </button>
          </div>
          <div className="flex-1 space-y-1 min-w-0">
            <div className="flex gap-2">
              <Input
                value={p.key}
                onChange={(e) => {
                  const next = [...values];
                  next[i] = { ...p, key: e.target.value.toLowerCase().replace(/[^a-z_]/g, "").slice(0, 32) };
                  onChange(next);
                }}
                placeholder="key"
                className="h-7 text-xs font-mono w-32"
              />
              <Input
                value={p.label}
                onChange={(e) => {
                  const next = [...values];
                  next[i] = { ...p, label: e.target.value };
                  onChange(next);
                }}
                placeholder="Label"
                className="h-7 text-sm font-medium flex-1"
              />
            </div>
            <Input
              value={p.description}
              onChange={(e) => {
                const next = [...values];
                next[i] = { ...p, description: e.target.value };
                onChange(next);
              }}
              placeholder="One-line description"
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
      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-xs"
        onClick={() =>
          onChange([
            ...values,
            { key: `phase_${values.length + 1}`, label: "New phase", description: "" },
          ])
        }
      >
        <Plus className="h-3 w-3 mr-1" /> Add phase
      </Button>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border bg-surface p-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

