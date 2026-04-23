// Settings panel for the per-user Google Drive connection. Wires up the OAuth
// kickoff, displays the connected Google email, the auto-backup toggle, the
// last error (if any), and a Test/Disconnect action.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertTriangle, CheckCircle2, ExternalLink, FolderSymlink, HardDrive, Info, Loader2, Plug, PlugZap, ShieldCheck, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { invalidateDriveStatusCache } from "@/lib/drive-backup";

interface Status {
  loading: boolean;
  connected: boolean;
  google_email: string | null;
  auto_backup_enabled: boolean;
  last_error: string | null;
}

export function GoogleDriveConnection() {
  const [s, setS] = useState<Status>({ loading: true, connected: false, google_email: null, auto_backup_enabled: false, last_error: null });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail?: string } | null>(null);
  const [appEmail, setAppEmail] = useState<string | null>(null);
  const [lastConnectError, setLastConnectError] = useState<string | null>(null);

  const refresh = async () => {
    setS((p) => ({ ...p, loading: true }));
    const { data, error } = await supabase.functions.invoke("drive-status", { body: {} });
    if (error) {
      setS({ loading: false, connected: false, google_email: null, auto_backup_enabled: false, last_error: error.message });
      return;
    }
    setS({
      loading: false,
      connected: !!data?.connected,
      google_email: data?.google_email ?? null,
      auto_backup_enabled: !!data?.auto_backup_enabled,
      last_error: data?.last_error ?? null,
    });
    invalidateDriveStatusCache();
  };

  useEffect(() => {
    refresh();
    // Resolve the app's signed-in email so we can show it as the expected
    // Google account for the Drive connection.
    supabase.auth.getUser().then(({ data }) => {
      setAppEmail(data.user?.email ?? null);
    });
    // Pick up redirect-back from OAuth callback
    if (typeof window !== "undefined") {
      const hash = window.location.hash;
      if (hash.startsWith("#drive=connected")) {
        toast.success("Google Drive connected");
        setLastConnectError(null);
        history.replaceState({}, "", window.location.pathname + window.location.search);
        refresh();
      } else if (hash.startsWith("#drive=error")) {
        const m = hash.match(/detail=([^&]+)/);
        const detail = m ? decodeURIComponent(m[1]) : "unknown";
        setLastConnectError(detail);
        toast.error(`Drive connection failed: ${detail}`);
        history.replaceState({}, "", window.location.pathname + window.location.search);
      }
    }
  }, []);

  const connect = async () => {
    const returnTo = "/settings";
    setLastConnectError(null);
    const { data, error } = await supabase.functions.invoke("drive-oauth-start", {
      body: { returnTo, loginHint: appEmail ?? undefined },
    });
    if (error || !data?.url) {
      toast.error(error?.message || "Could not start OAuth");
      return;
    }
    window.location.href = data.url;
  };

  const disconnect = async () => {
    if (!confirm("Disconnect Google Drive? Auto-backup will stop.")) return;
    const { error } = await supabase.functions.invoke("drive-disconnect", { body: {} });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Disconnected");
    invalidateDriveStatusCache();
    refresh();
  };

  const toggleBackup = async (enabled: boolean) => {
    setS((p) => ({ ...p, auto_backup_enabled: enabled }));
    const { error } = await supabase.functions.invoke("drive-toggle-backup", { body: { enabled } });
    if (error) {
      toast.error(error.message);
      setS((p) => ({ ...p, auto_backup_enabled: !enabled }));
      return;
    }
    invalidateDriveStatusCache();
    toast.success(enabled ? "Auto-backup enabled" : "Auto-backup disabled");
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const text = `Lovable Drive connection test — ${new Date().toISOString()}`;
      const base64 = btoa(text);
      const { data, error } = await supabase.functions.invoke("drive-upload", {
        body: {
          folderPath: "MyStudio",
          fileName: `connection-test-${Date.now()}.txt`,
          mimeType: "text/plain",
          base64Body: base64,
        },
      });
      if (error || data?.error) {
        setTestResult({ ok: false, detail: error?.message || data?.error });
      } else {
        setTestResult({ ok: true, detail: `Uploaded (file id ${String(data.drive_file_id).slice(0, 8)}…)` });
      }
    } catch (e) {
      setTestResult({ ok: false, detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
      refresh();
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-center gap-4 p-4 rounded-xl border bg-muted/30">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <HardDrive className="h-4 w-4 text-accent" />
            <span className="font-medium">Google Drive</span>
            {s.loading ? (
              <Badge variant="outline"><Loader2 className="h-3 w-3 animate-spin" /></Badge>
            ) : s.connected ? (
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
            {s.google_email && <span>Account: <code>{s.google_email}</code></span>}
            <a
              href="https://drive.google.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:underline"
            >
              Open Drive <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          {s.last_error && (
            <div className="mt-2 text-xs flex items-center gap-1.5 text-destructive">
              <XCircle className="h-3.5 w-3.5" /> {s.last_error}
            </div>
          )}
          {testResult && (
            <div className="mt-2 text-xs flex items-center gap-1.5">
              {testResult.ok ? (
                <><CheckCircle2 className="h-3.5 w-3.5 text-accent" /> {testResult.detail}</>
              ) : (
                <><XCircle className="h-3.5 w-3.5 text-destructive" /> {testResult.detail}</>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 shrink-0">
          {s.connected && (
            <Button variant="outline" size="sm" onClick={test} disabled={testing}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Test"}
            </Button>
          )}
          <Button
            variant={s.connected ? "outline" : "default"}
            size="sm"
            onClick={connect}
          >
            {s.connected ? "Reconnect" : "Connect Google Drive"}
          </Button>
          {s.connected && (
            <Button variant="ghost" size="sm" onClick={disconnect} className="text-destructive hover:text-destructive">
              Disconnect
            </Button>
          )}
        </div>
      </div>

      {s.connected && (
        <div className="rounded-xl border p-4 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <FolderSymlink className="h-4 w-4 text-accent" />
              <Label htmlFor="auto-backup" className="font-medium cursor-pointer">Auto-backup new assets</Label>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 max-w-md">
              When ON, every newly-generated document, suspect portrait, envelope mock, cover image, and marketing image is mirrored to <code>MyStudio/&#123;Case Title&#125;/auto-backup/…</code> in your Drive. Failures don't interrupt generation.
            </p>
          </div>
          <Switch id="auto-backup" checked={s.auto_backup_enabled} onCheckedChange={toggleBackup} />
        </div>
      )}

      {!s.connected && appEmail && (
        <div className="rounded-xl border border-accent/40 bg-accent/5 p-4 text-xs space-y-2">
          <p className="font-medium text-foreground flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5" /> Before you click Connect
          </p>
          <p className="text-muted-foreground">
            You're signed into MyStudio as <code className="text-foreground">{appEmail}</code>. On the Google screen, pick the Google account that matches <strong>this same email</strong> (or another Google account that is listed as a <strong>Test user</strong> in our Google Cloud OAuth client while the app is in Testing mode).
          </p>
          <p className="text-muted-foreground">
            If you pick a different Google account, Google will return a <strong>403 access denied</strong> page <em>before</em> sending you back here — that means Google rejected the account, not MyStudio.
          </p>
        </div>
      )}

      {lastConnectError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-xs space-y-2">
          <p className="font-medium text-destructive flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" /> Last connection attempt failed
          </p>
          <p className="text-muted-foreground">
            Detail: <code className="text-foreground break-all">{lastConnectError}</code>
          </p>
          <p className="text-muted-foreground">
            If the detail mentions <code>access_denied</code> or you saw a Google 403 page, the most common cause is signing in with a Google account that isn't on the OAuth client's <strong>Test users</strong> list. Click Connect again and use the account chooser to pick the right one.
          </p>
        </div>
      )}

      <div className="rounded-xl border bg-muted/40 p-4 text-xs text-muted-foreground space-y-1.5">
        <p className="font-medium text-foreground flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" /> Privacy
        </p>
        <p>
          MyStudio uses the <code>drive.file</code> scope. The app can only see and modify files <em>it creates</em> in your Drive — it can't read the rest of your personal Drive.
        </p>
        <p>
          Use the <strong>Save case to Drive</strong> action on any project page to upload a complete case package as a zip.
        </p>
      </div>
    </div>
  );
}
