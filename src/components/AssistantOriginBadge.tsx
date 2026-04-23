import { Sparkles } from "lucide-react";

/**
 * Tiny "✨ by assistant" chip. Click jumps to the chat tab and scroll-highlights
 * the exact assistant message that created/last-edited this thing.
 *
 * Renders nothing if no messageId is known (e.g. user-created or pre-tracking data).
 */
export function AssistantOriginBadge({
  messageId,
  label = "by assistant",
  className = "",
}: {
  messageId: string | null | undefined;
  label?: string;
  className?: string;
}) {
  if (!messageId) return null;
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.dispatchEvent(
      new CustomEvent("mystudio:navigate", {
        detail: { tab: "assistant", messageId },
      }),
    );
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      title="Open the chat turn where the assistant locked this in"
      className={`inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 hover:bg-accent/20 hover:border-accent/60 transition-colors px-1.5 py-0.5 text-[10px] font-medium text-accent leading-none align-middle ${className}`}
    >
      <Sparkles className="h-2.5 w-2.5" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
