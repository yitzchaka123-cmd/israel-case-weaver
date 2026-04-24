export const DEFAULT_GAME_LANGUAGE = "Hebrew";

export const DEFAULT_GAME_LANGUAGES = [
  "Hebrew",
  "English",
  "Arabic",
  "Spanish",
  "French",
  "German",
  "Russian",
];

export const RTL_GAME_LANGUAGES = new Set(["Hebrew", "Arabic", "Persian", "Urdu", "Yiddish"]);

export function isRtlGameLanguage(language: string | null | undefined) {
  return RTL_GAME_LANGUAGES.has(String(language ?? DEFAULT_GAME_LANGUAGE).trim());
}

export function normalizeGameLanguage(language: string | null | undefined) {
  const trimmed = String(language ?? "").trim();
  return trimmed || DEFAULT_GAME_LANGUAGE;
}