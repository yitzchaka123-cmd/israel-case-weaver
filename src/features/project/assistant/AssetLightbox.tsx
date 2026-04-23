import { useEffect } from "react";
import { X, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export type LightboxAsset = {
  url: string;
  title?: string | null;
  prompt?: string | null;
  openInTab?: { tab: string; targetId?: string; label?: string } | null;
};

export function AssetLightbox({ asset, onClose }: { asset: LightboxAsset | null; onClose: () => void }) {
  useEffect(() => {
    if (!asset) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [asset, onClose]);

  if (!asset) return null;

  const copyPrompt = async () => {
    if (!asset.prompt) return;
    try {
      await navigator.clipboard.writeText(asset.prompt);
      toast.success("Prompt copied");
    } catch {
      toast.error("Failed to copy");
    }
  };

  const openInTab = () => {
    if (!asset.openInTab) return;
    window.dispatchEvent(new CustomEvent("mystudio:navigate", { detail: { tab: asset.openInTab.tab, targetId: asset.openInTab.targetId } }));
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8 animate-in fade-in"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-4 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white inline-flex items-center justify-center transition"
      >
        <X className="h-5 w-5" />
      </button>
      <div
        className="relative max-w-[92vw] max-h-[88vh] flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={asset.url}
          alt={asset.title ?? "Asset preview"}
          className="max-w-full max-h-[72vh] object-contain rounded-lg shadow-2xl bg-background"
        />
        <div className="flex flex-wrap items-center gap-2 text-white">
          {asset.title && <div className="text-sm font-medium mr-auto truncate max-w-md">{asset.title}</div>}
          {asset.prompt && (
            <button
              type="button"
              onClick={copyPrompt}
              className="inline-flex items-center gap-1.5 rounded-md bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-medium transition"
            >
              <Copy className="h-3.5 w-3.5" /> Copy prompt
            </button>
          )}
          {asset.openInTab && (
            <button
              type="button"
              onClick={openInTab}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent hover:bg-accent/90 text-accent-foreground px-3 py-1.5 text-xs font-medium transition"
            >
              <ExternalLink className="h-3.5 w-3.5" /> {asset.openInTab.label ?? "Open in tab"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
