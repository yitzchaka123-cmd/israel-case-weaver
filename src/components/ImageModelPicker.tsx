import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect, useState } from "react";

export const IMAGE_MODELS = [
  { value: "chatgpt-image", label: "ChatGPT Image (gpt-image-1)" },
  { value: "nano-banana-2", label: "Nano Banana 2 — fast" },
  { value: "nano-banana-pro", label: "Nano Banana Pro — top quality" },
  { value: "nano-banana", label: "Nano Banana (classic)" },
] as const;

export type ImageModelKey = typeof IMAGE_MODELS[number]["value"];

const STORAGE_PREFIX = "imgModel:";

export function getStoredImageModel(surface: string, fallback: ImageModelKey): ImageModelKey {
  if (typeof window === "undefined") return fallback;
  const v = window.localStorage.getItem(STORAGE_PREFIX + surface);
  if (v && IMAGE_MODELS.some((m) => m.value === v)) return v as ImageModelKey;
  return fallback;
}

interface Props {
  surface: string; // "suspect" | "cover" | "media" | "document"
  defaultModel: ImageModelKey;
  className?: string;
  size?: "sm" | "md";
}

/**
 * Per-surface image model picker. Choice is remembered in localStorage so each
 * surface (suspects vs cover vs media vs documents) keeps its own default.
 */
export function ImageModelPicker({ surface, defaultModel, className, size = "sm" }: Props) {
  const [value, setValue] = useState<ImageModelKey>(defaultModel);

  useEffect(() => {
    setValue(getStoredImageModel(surface, defaultModel));
  }, [surface, defaultModel]);

  const handleChange = (v: string) => {
    setValue(v as ImageModelKey);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_PREFIX + surface, v);
    }
  };

  return (
    <Select value={value} onValueChange={handleChange}>
      <SelectTrigger className={`${size === "sm" ? "h-8 text-xs" : "h-9 text-sm"} w-[230px] ${className ?? ""}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {IMAGE_MODELS.map((m) => (
          <SelectItem key={m.value} value={m.value} className="text-xs">
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
