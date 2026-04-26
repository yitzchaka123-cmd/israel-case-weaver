// Reusable overlay that sits on top of an image area while a background image
// generation is in progress. Shows a live mm:ss timer that survives closing
// and reopening the app (the timer is anchored to the job's startedAt, which
// is persisted in localStorage by useBackgroundImageJob).
import { Loader2 } from "lucide-react";

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function GenerationTimer({
  elapsedSec,
  label = "Generating…",
  className = "",
}: {
  elapsedSec: number;
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={`absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/70 backdrop-blur-sm text-foreground rounded-[inherit] ${className}`}
      aria-live="polite"
    >
      <Loader2 className="h-5 w-5 animate-spin text-primary" />
      <div className="text-xs font-medium">{label}</div>
      <div className="text-xs tabular-nums text-muted-foreground">{formatElapsed(elapsedSec)}</div>
    </div>
  );
}

/** Inline (non-overlay) variant for buttons / status rows. */
export function InlineGenerationTimer({ elapsedSec, label = "Generating" }: { elapsedSec: number; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 className="h-3 w-3 animate-spin" />
      <span>{label}</span>
      <span className="tabular-nums">{formatElapsed(elapsedSec)}</span>
    </span>
  );
}
