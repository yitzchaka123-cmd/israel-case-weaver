export const DISPLAY_BACKGROUNDS = [
  { value: "bubblegum", label: "Bubblegum", desc: "Bright mesh with playful dots", previewClass: "bg-preview-bubblegum" },
  { value: "paper", label: "Paper", desc: "Warm studio paper grid", previewClass: "bg-preview-paper" },
  { value: "noir", label: "Noir", desc: "Deep cinematic workspace", previewClass: "bg-preview-noir" },
  { value: "blueprint", label: "Blueprint", desc: "Cool planning-grid surface", previewClass: "bg-preview-blueprint" },
  { value: "aurora", label: "Aurora", desc: "Soft color-wash backdrop", previewClass: "bg-preview-aurora" },
] as const;

export type DisplayBackground = (typeof DISPLAY_BACKGROUNDS)[number]["value"];

export const DEFAULT_DISPLAY_BACKGROUND: DisplayBackground = "bubblegum";

export function normalizeDisplayBackground(value: unknown): DisplayBackground {
  return DISPLAY_BACKGROUNDS.some((bg) => bg.value === value)
    ? (value as DisplayBackground)
    : DEFAULT_DISPLAY_BACKGROUND;
}