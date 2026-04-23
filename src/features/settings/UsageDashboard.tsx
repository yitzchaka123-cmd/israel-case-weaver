// Mini usage dashboard for the API providers used by this workspace.
// Only OpenAI exposes a real costs API — the other three providers get an
// honest "Open billing" card instead of a fake/empty graph.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, AlertTriangle, TrendingUp, Plus } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type DailyPoint = { date: string; usd: number };
type OpenAiUsage =
  | { available: true; daily: DailyPoint[]; total7d: number; currency: string; hardLimitUsd: number | null }
  | { available: false; reason: string; needsScope?: boolean };

interface UsageSummary {
  openai: OpenAiUsage;
  lovable: { available: false; reason: string };
  anthropic: { available: false; reason: string };
  gemini: { available: false; reason: string };
}

const ADD_CREDITS_URLS = {
  openai: "https://platform.openai.com/settings/organization/billing",
  lovable: "https://lovable.dev/dashboard",
  anthropic: "https://console.anthropic.com/settings/billing",
  gemini: "https://aistudio.google.com/app/apikey",
} as const;

function formatUsd(n: number, currency = "usd") {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function UsageDashboard() {
  const { data, isLoading, refetch, isFetching } = useQuery<UsageSummary>({
    queryKey: ["usage-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("api-key-manager", {
        body: { action: "usage_summary" },
      });
      if (error) throw new Error(error.message);
      return data as UsageSummary;
    },
    staleTime: 60_000,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Real-time numbers come straight from each provider. Only OpenAI publishes a usage API — others link to their billing dashboards.
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <OpenAiCard usage={data?.openai} loading={isLoading} />
        <LinkOnlyCard
          provider="Lovable AI Gateway"
          subtitle="Workspace credits"
          reason={data?.lovable?.reason ?? "Lovable AI Gateway doesn't expose per-key usage via API."}
          buttonLabel="Open Workspace → Usage"
          url={ADD_CREDITS_URLS.lovable}
          loading={isLoading}
        />
        <LinkOnlyCard
          provider="Anthropic (Claude)"
          subtitle="Direct Anthropic key"
          reason={data?.anthropic?.reason ?? "Anthropic doesn't expose balance/usage via API."}
          buttonLabel="Open Anthropic billing"
          url={ADD_CREDITS_URLS.anthropic}
          loading={isLoading}
        />
        <LinkOnlyCard
          provider="Google Gemini (direct)"
          subtitle="AI Studio / GCP billing"
          reason={data?.gemini?.reason ?? "Google AI Studio doesn't expose balance/usage via API."}
          buttonLabel="Open AI Studio"
          url={ADD_CREDITS_URLS.gemini}
          loading={isLoading}
        />
      </div>
    </div>
  );
}

function OpenAiCard({ usage, loading }: { usage?: OpenAiUsage; loading: boolean }) {
  if (loading || !usage) {
    return (
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-[120px] w-full" />
      </div>
    );
  }

  if (!usage.available) {
    return (
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-medium tracking-wider uppercase text-muted-foreground">OpenAI</div>
            <div className="text-sm font-medium mt-1">Last 7 days</div>
          </div>
          <Button asChild size="sm" variant="outline">
            <a href={ADD_CREDITS_URLS.openai} target="_blank" rel="noreferrer">
              <Plus className="h-3.5 w-3.5" />
              <span className="ml-1.5">Add credits</span>
              <ExternalLink className="h-3 w-3 ml-1.5" />
            </a>
          </Button>
        </div>
        <div className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
          <div>
            <div className="font-medium text-foreground mb-1">
              {usage.needsScope ? "Admin key required" : "Couldn't load OpenAI usage"}
            </div>
            <div className="leading-relaxed">{usage.reason}</div>
          </div>
        </div>
      </div>
    );
  }

  const total = usage.total7d;
  const currency = usage.currency || "usd";
  const limit = usage.hardLimitUsd;
  const pct = limit ? Math.min(100, Math.round((total / limit) * 100)) : null;
  const data = usage.daily.map((d) => ({ date: d.date.slice(5), usd: d.usd }));

  return (
    <div className="rounded-xl border bg-card p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium tracking-wider uppercase text-muted-foreground">OpenAI</div>
          <div className="flex items-baseline gap-2 mt-1">
            <div className="text-3xl font-display font-medium">{formatUsd(total, currency)}</div>
            <div className="text-xs text-muted-foreground">last 7 days</div>
          </div>
          {limit && (
            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
              <TrendingUp className="h-3 w-3" />
              {pct}% of {formatUsd(limit, currency)} hard limit
            </div>
          )}
        </div>
        <Button asChild size="sm">
          <a href={ADD_CREDITS_URLS.openai} target="_blank" rel="noreferrer">
            <Plus className="h-3.5 w-3.5" />
            <span className="ml-1.5">Add credits</span>
            <ExternalLink className="h-3 w-3 ml-1.5" />
          </a>
        </Button>
      </div>

      <div className="h-[120px] -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="openaiUsageFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.4} />
                <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis hide domain={[0, "auto"]} />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(v: number) => [formatUsd(v, currency), "Spent"]}
            />
            <Area
              type="monotone"
              dataKey="usd"
              stroke="hsl(var(--accent))"
              strokeWidth={2}
              fill="url(#openaiUsageFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function LinkOnlyCard({
  provider,
  subtitle,
  reason,
  buttonLabel,
  url,
  loading,
}: {
  provider: string;
  subtitle: string;
  reason: string;
  buttonLabel: string;
  url: string;
  loading: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium tracking-wider uppercase text-muted-foreground">{provider}</div>
          <div className="text-sm font-medium mt-1">{subtitle}</div>
        </div>
        <Button asChild size="sm" variant="outline">
          <a href={url} target="_blank" rel="noreferrer">
            {buttonLabel}
            <ExternalLink className="h-3 w-3 ml-1.5" />
          </a>
        </Button>
      </div>
      {loading ? (
        <Skeleton className="h-[60px] w-full" />
      ) : (
        <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground leading-relaxed">
          {reason}
        </div>
      )}
    </div>
  );
}
