import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle2, XCircle, AlertCircle, RefreshCw, ExternalLink, Loader2, ShieldCheck, KeyRound } from "lucide-react";

type KeyEntry = {
  name: string;
  label: string;
  provider: "openai" | "lovable" | "anthropic" | "gemini";
  managed: boolean;
  present: boolean;
  hint: string | null;
};

type TestState = {
  loading: boolean;
  ok?: boolean;
  status?: number;
  detail?: string;
  latencyMs?: number;
};

const PROVIDER_DOCS: Record<KeyEntry["provider"], { name: string; url: string; how: string }> = {
  openai: {
    name: "OpenAI",
    url: "https://platform.openai.com/api-keys",
    how: "Create a key on platform.openai.com → API Keys, then paste it when prompted.",
  },
  lovable: {
    name: "Lovable AI",
    url: "https://docs.lovable.dev/features/ai",
    how: "Managed automatically by Lovable Cloud — no manual key needed. Top up credits in Workspace → Usage.",
  },
  anthropic: {
    name: "Anthropic",
    url: "https://console.anthropic.com/settings/keys",
    how: "Create a key at console.anthropic.com → Settings → API Keys, then paste it when prompted.",
  },
  gemini: {
    name: "Google Gemini (direct)",
    url: "https://aistudio.google.com/app/apikey",
    how: "Create a key in AI Studio, then paste it when prompted.",
  },
};

export function ApiKeyManager() {
  const [keys, setKeys] = useState<KeyEntry[]>([]);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [loadingList, setLoadingList] = useState(true);

  const refresh = async () => {
    setLoadingList(true);
    const { data, error } = await supabase.functions.invoke("api-key-manager", {
      body: { action: "list" },
    });
    setLoadingList(false);
    if (error) {
      toast.error(`Could not load keys: ${error.message}`);
      return;
    }
    setKeys(data?.keys ?? []);
  };

  useEffect(() => { refresh(); }, []);

  const testOne = async (name: string) => {
    setTests((t) => ({ ...t, [name]: { loading: true } }));
    const { data, error } = await supabase.functions.invoke("api-key-manager", {
      body: { action: "test", name },
    });
    if (error) {
      setTests((t) => ({ ...t, [name]: { loading: false, ok: false, detail: error.message } }));
      return;
    }
    setTests((t) => ({
      ...t,
      [name]: { loading: false, ok: data.ok, status: data.status, detail: data.detail, latencyMs: data.latencyMs },
    }));
  };

  const testAll = async () => {
    const present = keys.filter((k) => k.present);
    setTests((t) => {
      const next = { ...t };
      for (const k of present) next[k.name] = { loading: true };
      return next;
    });
    const { data, error } = await supabase.functions.invoke("api-key-manager", {
      body: { action: "test_all" },
    });
    if (error) {
      toast.error(`Test failed: ${error.message}`);
      return;
    }
    const next: Record<string, TestState> = { ...tests };
    for (const r of data?.results ?? []) {
      next[r.name] = { loading: false, ok: r.ok, status: r.status, detail: r.detail, latencyMs: r.latencyMs };
    }
    setTests(next);
  };

  const requestSet = (name: string) => {
    toast.info(
      `Ask Lovable to set ${name}`,
      {
        description: `In the chat say: "Set the ${name} secret" — Lovable will open a secure form for you to paste the value. Existing values can be replaced the same way.`,
        duration: 8000,
      },
    );
  };

  const requestDelete = (name: string) => {
    toast.info(
      `Ask Lovable to delete ${name}`,
      {
        description: `In the chat say: "Delete the ${name} secret".`,
        duration: 8000,
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4" />
          Keys are stored encrypted as Lovable Cloud secrets — values are never exposed to the browser.
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={loadingList}>
            {loadingList ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Refresh</span>
          </Button>
          <Button variant="outline" size="sm" onClick={testAll} disabled={keys.filter((k) => k.present).length === 0}>
            Test all
          </Button>
        </div>
      </div>

      <div className="rounded-xl border divide-y">
        {keys.length === 0 && !loadingList && (
          <div className="p-6 text-sm text-muted-foreground">No keys configured yet.</div>
        )}
        {keys.map((k) => {
          const docs = PROVIDER_DOCS[k.provider];
          const t = tests[k.name];
          return (
            <div key={k.name} className="p-4 flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{k.label}</span>
                  <code className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{k.name}</code>
                  {k.managed && <Badge variant="secondary">managed</Badge>}
                  {k.present ? (
                    <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20">configured</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">not set</Badge>
                  )}
                </div>
                <div className="mt-1.5 text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                  {k.hint && <span>Value: <code>{k.hint}</code></span>}
                  <a href={docs.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                    {docs.name} dashboard <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                {t && (
                  <div className="mt-2 text-xs flex items-center gap-2">
                    {t.loading ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Testing…</>
                    ) : t.ok ? (
                      <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> {t.detail} {t.latencyMs ? `· ${t.latencyMs}ms` : ""}</>
                    ) : (
                      <><XCircle className="h-3.5 w-3.5 text-destructive" /> {t.detail || "failed"}{t.status ? ` (${t.status})` : ""}</>
                    )}
                  </div>
                )}
                {!k.present && (
                  <div className="mt-2 text-xs text-muted-foreground flex items-start gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>{docs.how}</span>
                  </div>
                )}
              </div>

              <div className="flex gap-2 shrink-0">
                {k.present && !k.managed && (
                  <Button variant="outline" size="sm" onClick={() => testOne(k.name)} disabled={t?.loading}>
                    {t?.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Test"}
                  </Button>
                )}
                {!k.managed && (
                  <Button
                    variant={k.present ? "outline" : "default"}
                    size="sm"
                    onClick={() => requestSet(k.name)}
                  >
                    {k.present ? "Replace" : "Add key"}
                  </Button>
                )}
                {k.present && !k.managed && (
                  <Button variant="ghost" size="sm" onClick={() => requestDelete(k.name)} className="text-destructive hover:text-destructive">
                    Delete
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border bg-muted/40 p-4 text-xs text-muted-foreground space-y-1.5">
        <p className="font-medium text-foreground">How key changes work</p>
        <p>For security, secret values can only be written through Lovable's encrypted form — not from this page.</p>
        <p>Click <strong>Add key</strong> / <strong>Replace</strong> / <strong>Delete</strong>, or just say it in the chat — Lovable will prompt you with a secure dialog.</p>
        <p className="pt-1">
          <strong>OpenAI OAuth:</strong> OpenAI's API only supports key-based auth (no third-party OAuth). The closest option, SSO, is for logging into OpenAI's own dashboard on enterprise plans — not for delegated API access.
        </p>
      </div>
    </div>
  );
}
