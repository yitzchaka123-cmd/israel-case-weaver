import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Sparkles,
  Plug,
  PlugZap,
  ShieldCheck,
} from "lucide-react";

type Status = {
  loading: boolean;
  present: boolean;
  hint: string | null;
  testing: boolean;
  ok?: boolean;
  detail?: string;
  latencyMs?: number;
};

const NANO_MODELS = [
  { name: "Nano Banana", id: "google/gemini-2.5-flash-image", note: "Classic — fast, cheap" },
  { name: "Nano Banana 2", id: "google/gemini-3.1-flash-image-preview", note: "Latest fast preview" },
  { name: "Nano Banana Pro", id: "google/gemini-3-pro-image-preview", note: "Top quality" },
];

export function GeminiConnection() {
  const [s, setS] = useState<Status>({ loading: true, present: false, hint: null, testing: false });

  const refresh = async () => {
    setS((p) => ({ ...p, loading: true }));
    const { data } = await supabase.functions.invoke("api-key-manager", { body: { action: "list" } });
    const entry = (data?.keys ?? []).find((k: { name: string }) => k.name === "GEMINI_API_KEY");
    setS({
      loading: false,
      present: !!entry?.present,
      hint: entry?.hint ?? null,
      testing: false,
    });
  };

  useEffect(() => { refresh(); }, []);

  const test = async () => {
    setS((p) => ({ ...p, testing: true, ok: undefined, detail: undefined }));
    const { data, error } = await supabase.functions.invoke("api-key-manager", {
      body: { action: "test", name: "GEMINI_API_KEY" },
    });
    if (error) {
      setS((p) => ({ ...p, testing: false, ok: false, detail: error.message }));
      return;
    }
    setS((p) => ({
      ...p,
      testing: false,
      ok: data.ok,
      detail: data.detail,
      latencyMs: data.latencyMs,
    }));
  };

  const connect = () => {
    toast.info("Ask Lovable to connect Google Gemini", {
      description:
        'In the chat say: "Set the GEMINI_API_KEY secret" — Lovable will open a secure form. Get a free key at aistudio.google.com/app/apikey.',
      duration: 10000,
    });
  };

  const disconnect = () => {
    toast.info("Ask Lovable to disconnect Google Gemini", {
      description: 'In the chat say: "Delete the GEMINI_API_KEY secret".',
      duration: 8000,
    });
  };

  return (
    <div className="space-y-5">
      {/* Status row */}
      <div className="flex flex-col md:flex-row md:items-center gap-4 p-4 rounded-xl border bg-muted/30">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Sparkles className="h-4 w-4 text-accent" />
            <span className="font-medium">Google Gemini (Nano Banana)</span>
            {s.loading ? (
              <Badge variant="outline"><Loader2 className="h-3 w-3 animate-spin" /></Badge>
            ) : s.present ? (
              <Badge className="bg-accent/15 text-accent hover:bg-accent/20">
                <PlugZap className="h-3 w-3 mr-1" /> Connected
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                <Plug className="h-3 w-3 mr-1" /> Not connected
              </Badge>
            )}
          </div>
          <div className="mt-1.5 text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
            {s.hint && <span>Key: <code>{s.hint}</code></span>}
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:underline"
            >
              Google AI Studio <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          {s.ok !== undefined && (
            <div className="mt-2 text-xs flex items-center gap-1.5">
              {s.ok ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-accent" />
                  Key valid {s.latencyMs ? `· ${s.latencyMs}ms` : ""}
                </>
              ) : (
                <>
                  <XCircle className="h-3.5 w-3.5 text-destructive" />
                  {s.detail || "Invalid key"}
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 shrink-0">
          {s.present && (
            <Button variant="outline" size="sm" onClick={test} disabled={s.testing}>
              {s.testing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Test"}
            </Button>
          )}
          <Button
            variant={s.present ? "outline" : "default"}
            size="sm"
            onClick={connect}
          >
            {s.present ? "Replace key" : "Connect Gemini"}
          </Button>
          {s.present && (
            <Button
              variant="ghost"
              size="sm"
              onClick={disconnect}
              className="text-destructive hover:text-destructive"
            >
              Disconnect
            </Button>
          )}
        </div>
      </div>

      {/* Models list */}
      <div className="rounded-xl border divide-y">
        <div className="px-4 py-2.5 text-xs font-medium text-muted-foreground bg-muted/40 rounded-t-xl">
          Models routed through this connection
        </div>
        {NANO_MODELS.map((m) => (
          <div key={m.id} className="px-4 py-3 flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0">
              <div className="font-medium">{m.name}</div>
              <div className="text-xs text-muted-foreground">{m.note} · <code className="text-[10px]">{m.id}</code></div>
            </div>
            {s.present ? (
              <Badge className="bg-accent/15 text-accent hover:bg-accent/20 shrink-0">via your key</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground shrink-0">via Lovable AI</Badge>
            )}
          </div>
        ))}
      </div>

      {/* Help */}
      <div className="rounded-xl border bg-muted/40 p-4 text-xs text-muted-foreground space-y-1.5">
        <p className="font-medium text-foreground flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" /> How it works
        </p>
        <p>
          When connected, all three Nano Banana models call Google directly using <em>your</em> AI Studio key — no Lovable credits are used and you're billed by Google.
        </p>
        <p>
          When disconnected, the same models still work but route through the Lovable AI Gateway (workspace credits).
        </p>
        <p className="pt-1">
          <strong>OAuth note:</strong> Google's image generation API doesn't support consumer OAuth. The only direct authentication method is an AI Studio API key — that's why "Connect" opens a paste-key form rather than a Google sign-in popup.
        </p>
      </div>
    </div>
  );
}
