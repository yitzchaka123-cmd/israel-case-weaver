// Per-image writer-model picker. Selects which planning LLM the
// `suggest-image-prompt` edge function uses to draft the image prompt.
// The choice is remembered per surface (cover / suspect / document / media)
// in localStorage so each context keeps its own default.
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect, useState } from "react";
import { useHiddenModels, filterModelOptions } from "@/lib/hidden-models";

// Grouped: header rows are non-selectable separators (value starts with "__hdr").
export const PROMPT_WRITER_MODELS = [
  { value: "__project", label: "Use project default" },
  { value: "__hdr-lovable", label: "— Lovable AI (workspace credits) —", header: true },
  { value: "gemini-3-pro", label: "Gemini 3.1 Pro (preview)" },
  { value: "gemini-3-flash", label: "Gemini 3 Flash (preview)" },
  { value: "gemini", label: "Gemini 2.5 Pro" },
  { value: "gemini-flash", label: "Gemini 2.5 Flash" },
  { value: "gemini-flash-lite", label: "Gemini 2.5 Flash Lite" },
  { value: "lovable", label: "Lovable default (Gemini 2.5 Flash)" },
  { value: "__hdr-direct", label: "— Your Google AI key (direct) —", header: true },
  { value: "gemini-direct-3-pro", label: "Gemini 3.1 Pro preview (direct)" },
  { value: "gemini-direct-3-flash", label: "Gemini 3 Flash preview (direct)" },
  { value: "gemini-direct-pro", label: "Gemini 2.5 Pro (direct)" },
  { value: "gemini-direct-flash", label: "Gemini 2.5 Flash (direct)" },
  { value: "gemini-direct-flash-lite", label: "Gemini 2.5 Flash Lite (direct)" },
  { value: "__hdr-openai", label: "— OpenAI —", header: true },
  { value: "openai-5.4", label: "OpenAI GPT-5.4 (newest)" },
  { value: "openai-5.2", label: "OpenAI GPT-5.2" },
  { value: "openai", label: "OpenAI GPT-5" },
  { value: "openai-mini", label: "OpenAI GPT-5 mini" },
  { value: "__hdr-claude", label: "— Anthropic —", header: true },
  { value: "claude", label: "Claude Sonnet 4.5" },
  { value: "claude-opus", label: "Claude Opus 4.5" },
  { value: "claude-haiku", label: "Claude Haiku 4.5" },
] as const;

const STORAGE_PREFIX = "promptWriter:";

export function getStoredWriterModel(surface: string): string {
  if (typeof window === "undefined") return "__project";
  return window.localStorage.getItem(STORAGE_PREFIX + surface) ?? "__project";
}

interface Props {
  surface: string; // "cover" | "suspect" | "document" | "media"
  className?: string;
}

export function PromptWriterModelPicker({ surface, className }: Props) {
  const [value, setValue] = useState<string>("__project");
  const { hidden } = useHiddenModels();
  const visibleModels = filterModelOptions(PROMPT_WRITER_MODELS, hidden, value);

  useEffect(() => {
    setValue(getStoredWriterModel(surface));
  }, [surface]);

  const handleChange = (v: string) => {
    setValue(v);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_PREFIX + surface, v);
    }
  };

  return (
    <Select value={value} onValueChange={handleChange}>
      <SelectTrigger className={`h-7 text-[11px] w-[220px] ${className ?? ""}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {visibleModels.map((m) => {
          if ((m as { header?: boolean }).header) {
            return (
              <div
                key={m.value}
                className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {m.label}
              </div>
            );
          }
          return (
            <SelectItem key={m.value} value={m.value} className="text-xs">
              {m.label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
