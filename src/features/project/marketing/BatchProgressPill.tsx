// Sticky progress pill for batch image generation. Shows live count, names
// any failed slots, and stays on screen until dismissed when there were
// failures so the user actually notices.
import { Loader2, CheckCircle2, AlertTriangle, X } from "lucide-react";
import type { BatchProgress } from "./useBatchImageProgress";

export function BatchProgressPill({
  progress,
  onDismiss,
}: {
  progress: BatchProgress;
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
    <div className="sticky top-14 z-20 flex justify-center pointer-events-none">
      <div
        className={`pointer-events-auto inline-flex items-center gap-2 rounded-full border bg-background/95 px-3 py-1.5 text-xs font-medium shadow-md backdrop-blur ${
          allOk ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
          : finished ? "border-amber-500/40 text-amber-700 dark:text-amber-400"
          : "border-border text-foreground"
        }`}
      >
        {!finished && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {allOk && <CheckCircle2 className="h-3.5 w-3.5" />}
        {finished && failed > 0 && <AlertTriangle className="h-3.5 w-3.5" />}
        <span>
          {label ? `${label}: ` : ""}
          Generated {done} / {total}
          {failed > 0 ? ` · ${failed} failed` : ""}
          {failed > 0 && failedLabels.length > 0 ? ` (${failedLabels.join(", ")})` : ""}
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
    </div>
  );
}
