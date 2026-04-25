// "Visible models" settings panel — lets the user hide individual AI engines /
// models from picker dropdowns across the app, so they don't have to scroll
// through dozens of options every time they pick a model. The backend, API
// keys and routing are NOT touched — only the UI dropdowns are filtered.
import { useMemo } from "react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Eye, EyeOff, RotateCcw, Search } from "lucide-react";
import { useHiddenModels } from "@/lib/hidden-models";
import { IMAGE_MODELS } from "@/components/ImageModelPicker";
import { PROMPT_WRITER_MODELS } from "@/components/PromptWriterModelPicker";
import { LOGIC_FLOW_MODELS } from "@/features/project/CanvasSection";

type Row = { value: string; label: string };
type Group = { id: string; title: string; desc: string; rows: Row[] };

// Strips header/separator entries (value starts with "__") from a model list.
function selectable<T extends { value: string; label: string; header?: boolean }>(list: readonly T[]): Row[] {
  return list
    .filter((m) => !m.header && !m.value.startsWith("__"))
    .map((m) => ({ value: m.value, label: m.label }));
}

// Mirrors the chat-model list from AssistantSection. Kept in sync manually so
// this panel has zero runtime dependency on the heavy AssistantSection module.
const CHAT_MODELS: Row[] = [
  { value: "lovable", label: "Gemini 3.1 Pro (Lovable default)" },
  { value: "gemini-3-flash", label: "Gemini 3 Flash (preview)" },
  { value: "gemini", label: "Gemini 2.5 Pro" },
  { value: "gemini-flash", label: "Gemini 2.5 Flash" },
  { value: "gemini-flash-lite", label: "Gemini 2.5 Flash Lite" },
  { value: "gemini-direct-3-pro", label: "Gemini 3.1 Pro preview (direct)" },
  { value: "gemini-direct-3-flash", label: "Gemini 3 Flash preview (direct)" },
  { value: "gemini-direct-pro", label: "Gemini 2.5 Pro (direct)" },
  { value: "gemini-direct-flash", label: "Gemini 2.5 Flash (direct)" },
  { value: "gemini-direct-flash-lite", label: "Gemini 2.5 Flash Lite (direct)" },
  { value: "openai-5.4", label: "ChatGPT 5.4 (newest)" },
  { value: "openai-5.2", label: "ChatGPT 5.2" },
  { value: "openai", label: "ChatGPT 5" },
  { value: "openai-mini", label: "ChatGPT 5 mini" },
  { value: "openai-nano", label: "ChatGPT 5 nano" },
  { value: "claude", label: "Claude Sonnet 4.5" },
  { value: "claude-opus", label: "Claude Opus 4.5" },
  { value: "claude-haiku", label: "Claude Haiku 4.5" },
];

export function VisibleModelsPanel() {
  const { hidden, toggle, clear } = useHiddenModels();
  const [filter, setFilter] = useState("");

  // Build groups by surface. We intentionally show the same model under
  // multiple groups when it appears in multiple pickers, so the user can
  // reason in terms of "where will this model show up".
  const groups: Group[] = useMemo(
    () => [
      {
        id: "chat",
        title: "Assistant chat",
        desc: "Models offered in the project assistant's model picker.",
        rows: CHAT_MODELS,
      },
      {
        id: "prompt-writer",
        title: "Prompt writer",
        desc: 'Models offered next to the "✨ Generate prompt" buttons (cover, suspects, media, envelopes, documents).',
        rows: selectable(PROMPT_WRITER_MODELS),
      },
      {
        id: "image",
        title: "Image generation",
        desc: "Models in the image picker shown next to each image-generating surface.",
        rows: selectable(IMAGE_MODELS),
      },
      {
        id: "logic-flow",
        title: "Logic Flow generator",
        desc: 'Models offered in the canvas "Generate logic flow" picker.',
        rows: selectable(LOGIC_FLOW_MODELS),
      },
    ],
    [],
  );

  const q = filter.trim().toLowerCase();
  const matches = (r: Row) =>
    !q || r.label.toLowerCase().includes(q) || r.value.toLowerCase().includes(q);

  const totalHidden = hidden.size;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="text-xs text-muted-foreground max-w-xl leading-relaxed">
          Switch a model off to hide it from the dropdowns — the engine stays connected, your API keys are untouched, and any current selection of that model keeps working. Turn it back on whenever you want.
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter models…"
              className="h-8 pl-7 text-xs w-[200px]"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-8"
            onClick={clear}
            disabled={totalHidden === 0}
            title="Show all models again"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
        </div>
      </div>

      {totalHidden > 0 && (
        <div className="text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">{totalHidden}</span> model{totalHidden === 1 ? "" : "s"} currently hidden across the app.
        </div>
      )}

      <div className="space-y-6">
        {groups.map((g) => {
          const visibleRows = g.rows.filter(matches);
          if (visibleRows.length === 0) return null;
          const hiddenInGroup = visibleRows.filter((r) => hidden.has(r.value)).length;
          return (
            <div key={g.id} className="rounded-xl border bg-card/40">
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b bg-muted/40 rounded-t-xl">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{g.title}</div>
                  <div className="text-[11px] text-muted-foreground leading-snug">{g.desc}</div>
                </div>
                <div className="text-[10px] font-medium text-muted-foreground shrink-0">
                  {visibleRows.length - hiddenInGroup}/{visibleRows.length} visible
                </div>
              </div>
              <ul className="divide-y">
                {visibleRows.map((r) => {
                  const isHidden = hidden.has(r.value);
                  return (
                    <li
                      key={`${g.id}:${r.value}`}
                      className="flex items-center justify-between gap-3 px-4 py-2.5"
                    >
                      <div className="min-w-0 flex items-center gap-2">
                        {isHidden ? (
                          <EyeOff className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        ) : (
                          <Eye className="h-3.5 w-3.5 text-foreground/60 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className={`text-sm truncate ${isHidden ? "text-muted-foreground line-through" : ""}`}>
                            {r.label}
                          </div>
                          <div className="text-[10px] font-mono text-muted-foreground/70 truncate">{r.value}</div>
                        </div>
                      </div>
                      <Switch
                        checked={!isHidden}
                        onCheckedChange={() => toggle(r.value)}
                        aria-label={isHidden ? `Show ${r.label}` : `Hide ${r.label}`}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
