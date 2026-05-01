import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHiddenModels, filterModelOptions } from "@/lib/hidden-models";

export const IMAGE_MODELS = [
  { value: "chatgpt-image-2", label: "ChatGPT Image 2 (gpt-image-2) — latest" },
  { value: "chatgpt-image", label: "ChatGPT Image 1 (gpt-image-1)" },
  { value: "nano-banana-pro", label: "Nano Banana Pro — top quality (Gemini)" },
  { value: "nano-banana-2", label: "Nano Banana 2 — fast (Gemini)" },
  { value: "nano-banana", label: "Nano Banana — classic (Gemini)" },
] as const;

export type ImageModelKey = typeof IMAGE_MODELS[number]["value"];
export type ImageQuality = "low" | "medium" | "high";

const STORAGE_PREFIX = "imgModel:";
const QUALITY_PREFIX = "imgQuality:";

export function getStoredImageModel(surface: string, fallback: ImageModelKey): ImageModelKey {
  if (typeof window === "undefined") return fallback;
  const v = window.localStorage.getItem(STORAGE_PREFIX + surface);
  if (surface === "envelope" && (v === "chatgpt-image" || v === "chatgpt-image-2")) return fallback;
  if (v && IMAGE_MODELS.some((m) => m.value === v)) return v as ImageModelKey;
  return fallback;
}

export function getStoredImageQuality(surface: string, fallback: ImageQuality = "high"): ImageQuality {
  if (typeof window === "undefined") return fallback;
  const v = window.localStorage.getItem(QUALITY_PREFIX + surface);
  if (v === "low" || v === "medium" || v === "high") return v;
  return fallback;
}

const QUALITIES: { value: ImageQuality; label: string }[] = [
  { value: "low", label: "Low — fastest" },
  { value: "medium", label: "Medium — recommended" },
  { value: "high", label: "High — slow (up to 2 min)" },
];

interface Props {
  surface: string; // "suspect" | "cover" | "media" | "document"
  defaultModel: ImageModelKey;
  className?: string;
  size?: "sm" | "md";
}

/**
 * Per-surface image model picker. Choice is remembered in localStorage so each
 * surface (suspects vs cover vs media vs documents) keeps its own default.
 * For OpenAI models, also exposes a Quality picker (latency vs fidelity tradeoff).
 */
export function ImageModelPicker({ surface, defaultModel, className, size = "sm" }: Props) {
  const [value, setValue] = useState<ImageModelKey>(defaultModel);
  const [quality, setQuality] = useState<ImageQuality>("high");
  const [geminiKeyPresent, setGeminiKeyPresent] = useState<boolean | null>(null);
  const { hidden } = useHiddenModels();
  const visibleModels = filterModelOptions(IMAGE_MODELS, hidden, value);

  useEffect(() => {
    setValue(getStoredImageModel(surface, defaultModel));
    setQuality(getStoredImageQuality(surface, "high"));
  }, [surface, defaultModel]);

  // One lightweight ping to detect whether the user's GEMINI_API_KEY is configured.
  // The result is cached on window so multiple pickers don't all re-fetch.
  useEffect(() => {
    const cached = (window as { __geminiKeyPresent?: boolean }).__geminiKeyPresent;
    if (typeof cached === "boolean") {
      setGeminiKeyPresent(cached);
      return;
    }
    let cancelled = false;
    supabase.functions
      .invoke("api-key-manager", { body: { action: "list" } })
      .then(({ data }) => {
        if (cancelled) return;
        const entry = (data?.keys ?? []).find((k: { name: string }) => k.name === "GEMINI_API_KEY");
        const present = !!entry?.present;
        (window as { __geminiKeyPresent?: boolean }).__geminiKeyPresent = present;
        setGeminiKeyPresent(present);
      })
      .catch(() => { /* silent — caption just stays generic */ });
    return () => { cancelled = true; };
  }, []);

  const handleChange = (v: string) => {
    setValue(v as ImageModelKey);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_PREFIX + surface, v);
    }
  };

  const handleQualityChange = (v: string) => {
    setQuality(v as ImageQuality);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(QUALITY_PREFIX + surface, v);
    }
  };

  const isOpenAI = value === "chatgpt-image-2" || value === "chatgpt-image";
  const isNanoBanana = value.startsWith("nano-banana");
  const triggerCls = size === "sm" ? "h-8 text-xs" : "h-9 text-sm";

  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Select value={value} onValueChange={handleChange}>
        <SelectTrigger className={`${triggerCls} w-full`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {visibleModels.map((m) => (
            <SelectItem key={m.value} value={m.value} className="text-xs">
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {isNanoBanana && (
        <p className="text-[10px] text-muted-foreground leading-tight">
          {geminiKeyPresent
            ? "Currently routed via your Google key (free of Lovable credits)."
            : "Routed via Lovable AI Gateway. Connect your GEMINI_API_KEY in Settings to bypass."}
        </p>
      )}

      {isOpenAI && (
        <>
          <Select value={quality} onValueChange={handleQualityChange}>
            <SelectTrigger className={`${triggerCls} w-full`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUALITIES.map((q) => (
                <SelectItem key={q.value} value={q.value} className="text-xs">
                  {q.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {quality === "high" && (
            <p className="text-[10px] text-muted-foreground leading-tight">
              ⚠️ High quality can take up to 2 min and may time out on very long prompts.
            </p>
          )}
        </>
      )}
    </div>
  );
}
