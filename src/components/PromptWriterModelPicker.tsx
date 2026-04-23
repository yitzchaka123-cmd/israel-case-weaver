// Per-image writer-model picker. Selects which planning LLM the
// `suggest-image-prompt` edge function uses to draft the image prompt.
// The choice is remembered per surface (cover / suspect / document / media)
// in localStorage so each context keeps its own default.
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect, useState } from "react";

export const PROMPT_WRITER_MODELS = [
  { value: "__project", label: "Use project default" },
  { value: "lovable", label: "Lovable AI (Gemini 2.5 Flash)" },
  { value: "gemini", label: "Gemini 2.5 Pro" },
  { value: "gemini-3-pro", label: "Gemini 3.1 Pro (preview)" },
  { value: "gemini-flash", label: "Gemini 2.5 Flash" },
  { value: "openai", label: "OpenAI GPT-5" },
  { value: "openai-5.4", label: "OpenAI GPT-5.4 (newest)" },
  { value: "openai-5.2", label: "OpenAI GPT-5.2" },
  { value: "openai-mini", label: "OpenAI GPT-5 mini" },
  { value: "claude", label: "Claude Sonnet 4.5" },
  { value: "claude-opus", label: "Claude Opus 4.5" },
  { value: "claude-haiku", label: "Claude Haiku 4.5" },
  { value: "gemini-direct-pro", label: "Gemini direct (Pro)" },
  { value: "gemini-direct-flash", label: "Gemini direct (Flash)" },
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
      <SelectTrigger className={`h-7 text-[11px] w-[200px] ${className ?? ""}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PROMPT_WRITER_MODELS.map((m) => (
          <SelectItem key={m.value} value={m.value} className="text-xs">
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
