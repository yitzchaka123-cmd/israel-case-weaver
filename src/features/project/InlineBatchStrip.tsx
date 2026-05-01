// Generic compact progress strip used by Suspects / Hints / Envelopes
// batch generators. Mirrors the shape of marketing's BatchProgressPill but
// renders inline (not sticky) so it sits inside a section toolbar.
import { Loader2, CheckCircle2, AlertTriangle, X } from "lucide-react";
import type { ImgBatchProgress } from "./useImageBatchProgress";

export function InlineBatchStrip({
  progress,
  onDismiss,
}: {
  progress: ImgBatchProgress;
  onDismiss?: () => void;
}) {
  if (progress.total === 0) return null;
  const { done, failed, total, pending, label, jobs } = progress;
  const finished = pending === 0;
  const allOk = finished && failed === 0;
  const failedLabels = jobs
    .filter((j) => j.status === "failed")
    .map((j) => j.label)
    .filter((l): l is string => Boolean(l));

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${
        allOk
          ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20"
          : finished
            ? "border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/20"
            : "border-border text-foreground bg-muted/40"
      }`}
    >
      {!finished && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {allOk && <CheckCircle2 className="h-3.5 w-3.5" />}
      {finished && failed > 0 && <AlertTriangle className="h-3.5 w-3.5" />}
      <span>
        {label ? `${label}: ` : ""}
        {done} / {total}
        {failed > 0 ? ` · ${failed} failed` : ""}
        {failed > 0 && failedLabels.length > 0 ? ` (${failedLabels.slice(0, 3).join(", ")}${failedLabels.length > 3 ? "…" : ""})` : ""}
      </span>
      {finished && failed > 0 && onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="ml-1 rounded-full p-0.5 hover:bg-foreground/10"
          aria-label="Dismiss"
          title="Dismiss"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
