import * as React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Check, Loader2, AlertCircle } from "lucide-react";

/**
 * Shared auto-save primitives.
 *
 * Behavior (per product spec):
 *   - Save on blur.
 *   - Save on Enter (textarea: Shift+Enter still inserts a newline).
 *   - Skip the save when the value is unchanged from the last persisted value.
 *   - Show a tiny inline indicator: "Saving…" / "Saved" / "Failed — retry".
 *   - Silent otherwise (no toasts).
 *
 * `value` is treated as the *persisted* value coming from the data layer.
 * Local edits live in internal state until a commit fires.
 */

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

interface BaseProps {
  value: string | null | undefined;
  onSave: (next: string) => void | Promise<void>;
  /** When true, Enter commits even in a textarea. Defaults: input=true, textarea=false (Shift+Enter rule). */
  commitOnEnter?: boolean;
  /** Hide the inline "Saved" indicator. Default false. */
  hideStatus?: boolean;
  /** Show indicator inside the input on the right. Default true. */
  inlineStatus?: boolean;
}

function normalize(v: string | null | undefined) {
  return v ?? "";
}

function useAutoSaveState(value: string | null | undefined, onSave: (n: string) => void | Promise<void>) {
  const [draft, setDraft] = React.useState(normalize(value));
  const [status, setStatus] = React.useState<AutoSaveStatus>("idle");
  const lastSavedRef = React.useRef<string>(normalize(value));
  const focusedRef = React.useRef(false);
  const savedTimerRef = React.useRef<number | null>(null);

  // Keep local draft in sync when the upstream value changes AND the field isn't being edited.
  React.useEffect(() => {
    const next = normalize(value);
    if (!focusedRef.current && next !== draft) {
      setDraft(next);
      lastSavedRef.current = next;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = React.useCallback(async (next: string) => {
    if (next === lastSavedRef.current) return;
    setStatus("saving");
    try {
      await onSave(next);
      lastSavedRef.current = next;
      setStatus("saved");
      if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = window.setTimeout(() => setStatus("idle"), 1400);
    } catch {
      setStatus("error");
    }
  }, [onSave]);

  React.useEffect(() => () => {
    if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current);
  }, []);

  return { draft, setDraft, status, commit, focusedRef };
}

export function StatusIndicator({ status, className }: { status: AutoSaveStatus; className?: string }) {
  if (status === "idle") return null;
  return (
    <span
      className={cn(
        "pointer-events-none flex items-center gap-1 text-[10px] font-medium tabular-nums",
        status === "saving" && "text-muted-foreground",
        status === "saved" && "text-primary",
        status === "error" && "text-destructive",
        className,
      )}
      aria-live="polite"
    >
      {status === "saving" && (<><Loader2 className="h-3 w-3 animate-spin" /> Saving…</>)}
      {status === "saved" && (<><Check className="h-3 w-3" /> Saved</>)}
      {status === "error" && (<><AlertCircle className="h-3 w-3" /> Failed — retry</>)}
    </span>
  );
}

type InputProps = Omit<React.ComponentPropsWithoutRef<typeof Input>, "value" | "onChange" | "defaultValue"> & BaseProps;

export const AutoSaveInput = React.forwardRef<HTMLInputElement, InputProps>(function AutoSaveInput(
  { value, onSave, commitOnEnter = true, hideStatus, inlineStatus = true, className, onBlur, onKeyDown, ...rest },
  ref,
) {
  const { draft, setDraft, status, commit, focusedRef } = useAutoSaveState(value, onSave);

  return (
    <span className="relative block">
      <Input
        ref={ref}
        {...rest}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => { focusedRef.current = true; rest.onFocus?.(e); }}
        onBlur={(e) => { focusedRef.current = false; void commit(draft); onBlur?.(e); }}
        onKeyDown={(e) => {
          if (commitOnEnter && e.key === "Enter") {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          }
          onKeyDown?.(e);
        }}
        className={cn(inlineStatus && status !== "idle" && "pr-20", className)}
      />
      {!hideStatus && inlineStatus && (
        <StatusIndicator status={status} className="absolute right-2 top-1/2 -translate-y-1/2" />
      )}
      {!hideStatus && !inlineStatus && status !== "idle" && (
        <StatusIndicator status={status} className="mt-1" />
      )}
    </span>
  );
});

type TextareaProps = Omit<React.ComponentPropsWithoutRef<typeof Textarea>, "value" | "onChange" | "defaultValue"> & BaseProps;

export const AutoSaveTextarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function AutoSaveTextarea(
  { value, onSave, commitOnEnter = false, hideStatus, inlineStatus = false, className, onBlur, onKeyDown, ...rest },
  ref,
) {
  const { draft, setDraft, status, commit, focusedRef } = useAutoSaveState(value, onSave);

  return (
    <span className="relative block">
      <Textarea
        ref={ref}
        {...rest}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => { focusedRef.current = true; rest.onFocus?.(e); }}
        onBlur={(e) => { focusedRef.current = false; void commit(draft); onBlur?.(e); }}
        onKeyDown={(e) => {
          // Enter saves immediately (without newline) when commitOnEnter; Shift+Enter always inserts a newline.
          if (commitOnEnter && e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            (e.currentTarget as HTMLTextAreaElement).blur();
          }
          onKeyDown?.(e);
        }}
        className={className}
      />
      {!hideStatus && (
        <StatusIndicator
          status={status}
          className={cn(
            inlineStatus
              ? "absolute right-2 top-2"
              : "mt-1",
          )}
        />
      )}
    </span>
  );
});
