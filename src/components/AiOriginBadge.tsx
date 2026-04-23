import { Sparkles, AlertTriangle, Cpu } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface AiOriginInfo {
  requested?: string | null;
  effective?: string | null;
  fallback?: string | null; // "none" | "openai-direct" | "lovable-ai" | null
  provider?: string | null;
}

function shortLabel(model: string | null | undefined): string {
  if (!model) return "—";
  // Strip provider prefixes for compact chip
  return model
    .replace(/^openai\//, "")
    .replace(/^google\//, "")
    .replace(/^anthropic\//, "")
    .replace(/^gemini-direct\//, "");
}

/**
 * Small "AI origin" chip overlaid on generated images. Hover shows full
 * requested → effective lineage and the reason for any fallback.
 *
 * Usage: position the parent relative; chip pins to top-right by default.
 */
export function AiOriginBadge({
  info,
  className = "",
  position = "absolute",
  hoverOnly = false,
}: {
  info: AiOriginInfo | null | undefined;
  className?: string;
  position?: "absolute" | "inline";
  hoverOnly?: boolean;
}) {
  if (!info || (!info.requested && !info.effective)) return null;
  const fellBack = !!info.fallback && info.fallback !== "none";
  const requested = info.requested ?? info.effective ?? "";
  const effective = info.effective ?? info.requested ?? "";

  const reasonText = fellBack
    ? info.fallback === "openai-direct"
      ? "Original model was unavailable, ran on OpenAI direct as a fallback."
      : "Original model was unavailable, ran on Lovable AI Gateway as a fallback."
    : "Ran on the requested model — no fallback.";

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={[
              position === "absolute" ? "absolute top-2 right-2 z-10" : "inline-flex",
              hoverOnly ? "opacity-0 group-hover:opacity-100 transition-opacity" : "",
              "pointer-events-auto",
              className,
            ].join(" ")}
          >
            <div
              className={[
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium leading-none border backdrop-blur-md shadow-soft",
                fellBack
                  ? "bg-amber-500/20 border-amber-500/40 text-amber-100"
                  : "bg-emerald-500/20 border-emerald-500/40 text-emerald-100",
              ].join(" ")}
            >
              {fellBack ? <AlertTriangle className="h-2.5 w-2.5" /> : <Sparkles className="h-2.5 w-2.5" />}
              <span className="max-w-[140px] truncate">
                {fellBack
                  ? `${shortLabel(requested)} → ${shortLabel(effective)}`
                  : shortLabel(effective)}
              </span>
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs space-y-1">
          <div className="flex items-center gap-1.5 font-semibold">
            <Cpu className="h-3 w-3" /> AI origin
          </div>
          <div>
            <span className="text-muted-foreground">Requested:</span> <code className="text-[10px]">{requested || "—"}</code>
          </div>
          <div>
            <span className="text-muted-foreground">Ran on:</span> <code className="text-[10px]">{effective || "—"}</code>
          </div>
          {info.provider && (
            <div>
              <span className="text-muted-foreground">Provider:</span> {info.provider}
            </div>
          )}
          <div className="pt-1 text-muted-foreground">{reasonText}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
