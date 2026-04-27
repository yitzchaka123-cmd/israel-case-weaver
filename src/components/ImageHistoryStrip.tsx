// 24-item history carousel with click-to-preview lightbox + restore.
// Shared by all image surfaces (covers, suspects, hint sheets, media library)
// and originally extracted from DocumentsSection's inline HistoryStrip.
import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";
import { AiOriginBadge } from "./AiOriginBadge";
import { DownloadButton } from "./DownloadButton";

export interface ImageHistoryRow {
  id: string;
  url: string | null;
  preview_url: string | null;
  model: string | null;
  effective_model: string | null;
  provider: string | null;
  fallback?: string | null;
  created_at: string;
}

interface Props {
  items: ImageHistoryRow[];
  /** Currently active URL — gets the highlight ring. */
  currentUrl: string | null;
  /** Restore this history item as the surface's active asset. */
  onRestore: (item: ImageHistoryRow) => void | Promise<void>;
  title?: string;
  className?: string;
}

export function ImageHistoryStrip({ items, currentUrl, onRestore, title = "History", className }: Props) {
  const [preview, setPreview] = useState<ImageHistoryRow | null>(null);
  const visible = items.filter((it) => !!it.url).slice(0, 24);
  if (visible.length === 0) return null;

  return (
    <div className={`mt-3 space-y-1.5 ${className ?? ""}`}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{title}</p>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {visible.map((item) => {
          const isActive = item.url === currentUrl;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setPreview(item)}
              title={item.model ?? "Open"}
              className={`group relative shrink-0 rounded-md border bg-muted overflow-hidden ${isActive ? "border-accent ring-2 ring-accent/40" : "border-border hover:border-accent/40"}`}
            >
              <img
                src={item.preview_url ?? item.url ?? ""}
                alt="History thumbnail"
                className="block w-20 h-20 object-cover"
                loading="lazy"
              />
              {isActive && (
                <span className="absolute top-1 left-1 text-[8px] uppercase tracking-wider bg-accent text-accent-foreground px-1 py-0.5 rounded">
                  Active
                </span>
              )}
              <span
                className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => e.stopPropagation()}
              >
                <DownloadButton url={item.url} title={`history-${item.id}`} />
              </span>
            </button>
          );
        })}
      </div>

      {preview?.url && (
        <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
          <DialogContent className="max-w-5xl p-4">
            <div className="relative rounded-lg bg-muted overflow-hidden border">
              <img src={preview.url} alt="History preview" className="max-h-[78vh] w-full object-contain" />
              <AiOriginBadge
                info={{
                  requested: preview.model,
                  effective: preview.effective_model ?? preview.model,
                  provider: preview.provider,
                  fallback: preview.fallback ?? "none",
                }}
              />
            </div>
            <div className="flex justify-between items-center pt-2 gap-2">
              <p className="text-[11px] text-muted-foreground truncate">
                {new Date(preview.created_at).toLocaleString()}
              </p>
              <div className="flex items-center gap-2">
                <DownloadButton url={preview.url} title={`history-${preview.id}`} size="sm" variant="outline" />
                {preview.url !== currentUrl && (
                  <Button size="sm" className="gap-2" onClick={async () => { await onRestore(preview); setPreview(null); }}>
                    <RotateCcw className="h-3.5 w-3.5" /> Restore as active
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
