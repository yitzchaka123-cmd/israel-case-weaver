import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { toast } from "sonner";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Trigger a real "Save as…" download for any URL (Supabase storage, blob,
 * data URL). Fetches the URL into a blob first so the browser doesn't
 * navigate away — and so cross-origin Supabase URLs respect the `download`
 * attribute even when their server doesn't send `Content-Disposition`.
 */
export async function downloadAsset(url: string, filename?: string): Promise<void> {
  if (!url) {
    toast.error("Nothing to download");
    return;
  }
  try {
    const resp = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename || guessFilename(url, blob.type);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
  } catch (e) {
    // Fallback: open in a new tab so the user can right-click → save.
    console.warn("downloadAsset fetch failed, opening in new tab", e);
    window.open(url, "_blank", "noopener");
    toast.message("Opened in a new tab — right-click → Save image as…");
  }
}

function guessFilename(url: string, mime?: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").pop() || "download";
    if (last.includes(".")) return last;
    const ext = mimeToExt(mime);
    return ext ? `${last}.${ext}` : last;
  } catch {
    return "download";
  }
}

function mimeToExt(mime?: string): string {
  if (!mime) return "";
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("svg")) return "svg";
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("zip")) return "zip";
  return "";
}

export function slugify(input: string, max = 40): string {
  return (input || "asset")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, max) || "asset";
}
