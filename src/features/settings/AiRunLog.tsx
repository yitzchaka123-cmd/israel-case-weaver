// AI activity log — shows the most recent AI calls (chat + image gen) so the
// user can see what model actually ran for each call, including any fallbacks
// the router fired automatically (e.g. Gemini → OpenAI on a 429).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";

interface RunRow {
  id: string;
  created_at: string;
  user_id: string | null;
  project_id: string | null;
  surface: string;
  requested_model: string | null;
  effective_model: string | null;
  fallback: string;
  status: string;
  latency_ms: number | null;
  error_message: string | null;
  target_id: string | null;
  prompt_excerpt: string | null;
}

const SURFACES = [
  "all",
  "assistant-chat",
  "generate-image",
  "suggest-image-prompt",
  "generate-marketing-copy",
  "generate-storyboard",
  "generate-document",
  "generate-logic-flow",
  "generate-envelopes",
  "explain-canvas-node",
] as const;

const FALLBACKS = ["all", "none", "openai-direct", "lovable-ai"] as const;

export function AiRunLog() {
  const { user } = useAuth();
  const [surface, setSurface] = useState<(typeof SURFACES)[number]>("all");
  const [fallback, setFallback] = useState<(typeof FALLBACKS)[number]>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["ai-run-logs", user?.id, surface, fallback],
    queryFn: async () => {
      let q = supabase
        .from("ai_run_logs" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (surface !== "all") q = q.eq("surface", surface);
      if (fallback !== "all") q = q.eq("fallback", fallback);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as RunRow[];
    },
    enabled: !!user,
  });

  const rows = data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <FilterChips
          label="Surface"
          values={SURFACES as unknown as string[]}
          active={surface}
          onChange={(v) => setSurface(v as (typeof SURFACES)[number])}
        />
        <FilterChips
          label="Fallback"
          values={FALLBACKS as unknown as string[]}
          active={fallback}
          onChange={(v) => setFallback(v as (typeof FALLBACKS)[number])}
        />
        <Button variant="ghost" size="sm" className="ml-auto h-8 gap-1.5 text-xs" onClick={() => refetch()}>
          {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Refresh
        </Button>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="grid grid-cols-[16px_120px_1fr_1fr_90px_70px_70px] gap-2 px-3 py-2 border-b bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <div></div>
          <div>When</div>
          <div>Surface · Requested</div>
          <div>Effective · Fallback</div>
          <div className="text-right">Latency</div>
          <div className="text-center">Status</div>
          <div></div>
        </div>
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No runs yet. Try generating something — it'll show up here.
          </div>
        ) : (
          <div className="divide-y">
            {rows.map((r) => (
              <RunRowItem
                key={r.id}
                row={r}
                expanded={expanded.has(r.id)}
                onToggle={() => {
                  setExpanded((s) => {
                    const next = new Set(s);
                    if (next.has(r.id)) next.delete(r.id);
                    else next.add(r.id);
                    return next;
                  });
                }}
              />
            ))}
          </div>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">Showing the last 200 calls.</p>
    </div>
  );
}

function FilterChips({
  label,
  values,
  active,
  onChange,
}: {
  label: string;
  values: string[];
  active: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}:</span>
      <div className="flex flex-wrap gap-1 p-0.5 bg-muted rounded-lg">
        {values.map((v) => (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={[
              "px-2 py-0.5 text-[11px] font-medium rounded-md transition-colors",
              active === v ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

function RunRowItem({
  row,
  expanded,
  onToggle,
}: {
  row: RunRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const dot = row.status === "error"
    ? "bg-destructive"
    : row.fallback !== "none"
    ? "bg-amber-500"
    : "bg-emerald-500";
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full grid grid-cols-[16px_120px_1fr_1fr_90px_70px_70px] gap-2 px-3 py-2 items-center text-left hover:bg-muted/30 transition-colors text-xs"
      >
        <div className={`h-2 w-2 rounded-full ${dot}`} />
        <div className="text-muted-foreground text-[11px] truncate">
          {new Date(row.created_at).toLocaleString()}
        </div>
        <div className="min-w-0">
          <div className="font-medium truncate">{row.surface}</div>
          <div className="text-muted-foreground text-[10px] truncate">{row.requested_model ?? "—"}</div>
        </div>
        <div className="min-w-0">
          <div className="truncate">{row.effective_model ?? "—"}</div>
          <div className="text-[10px] text-muted-foreground truncate">
            {row.fallback === "none" ? "no fallback" : row.fallback}
          </div>
        </div>
        <div className="text-right text-[11px] text-muted-foreground">
          {row.latency_ms != null ? `${row.latency_ms}ms` : "—"}
        </div>
        <div className="text-center text-[11px] capitalize">{row.status}</div>
        <div className="text-muted-foreground">
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </div>
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-1 bg-muted/20 text-[11px] space-y-1">
          {row.prompt_excerpt && (
            <div>
              <span className="text-muted-foreground">Prompt:</span>{" "}
              <span className="font-mono whitespace-pre-wrap">{row.prompt_excerpt}</span>
            </div>
          )}
          {row.target_id && (
            <div>
              <span className="text-muted-foreground">Target:</span>{" "}
              <code>{row.target_id}</code>
            </div>
          )}
          {row.error_message && (
            <div className="text-destructive">
              <span className="font-semibold">Error:</span> {row.error_message}
            </div>
          )}
          {!row.prompt_excerpt && !row.target_id && !row.error_message && (
            <div className="text-muted-foreground">No extra details captured for this run.</div>
          )}
        </div>
      )}
    </div>
  );
}
