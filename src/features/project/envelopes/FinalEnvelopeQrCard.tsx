// Polished QR control card for the FINAL envelope only.
// Live preview (debounced), URL validation, status badge, test-scan + copy + clear.
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { QrCode, ExternalLink, Copy, Trash2, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Status =
  | { kind: "empty"; tone: "muted"; label: "Add a link"; icon: typeof QrCode }
  | { kind: "invalid"; tone: "destructive"; label: "Invalid URL"; icon: typeof XCircle }
  | { kind: "non-youtube"; tone: "warning"; label: "Link saved (not a YouTube URL)"; icon: typeof AlertTriangle }
  | { kind: "youtube"; tone: "success"; label: "YouTube link ready"; icon: typeof CheckCircle2 };

function classifyUrl(raw: string): Status {
  const v = raw.trim();
  if (!v) return { kind: "empty", tone: "muted", label: "Add a link", icon: QrCode };
  try {
    const u = new URL(v);
    if (!/^https?:$/.test(u.protocol)) {
      return { kind: "invalid", tone: "destructive", label: "Invalid URL", icon: XCircle };
    }
    const host = u.hostname.replace(/^www\./, "");
    const isYt = host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be" || host.endsWith(".youtube.com");
    return isYt
      ? { kind: "youtube", tone: "success", label: "YouTube link ready", icon: CheckCircle2 }
      : { kind: "non-youtube", tone: "warning", label: "Link saved (not a YouTube URL)", icon: AlertTriangle };
  } catch {
    return { kind: "invalid", tone: "destructive", label: "Invalid URL", icon: XCircle };
  }
}

const toneClasses: Record<Status["tone"], string> = {
  muted: "bg-muted text-muted-foreground border-border",
  destructive: "bg-destructive/10 text-destructive border-destructive/30",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
};

export function FinalEnvelopeQrCard({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [debounced, setDebounced] = useState(value);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");

  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(draft), 200);
    return () => clearTimeout(t);
  }, [draft]);

  const status = useMemo(() => classifyUrl(debounced), [debounced]);
  const isValid = status.kind === "youtube" || status.kind === "non-youtube";

  useEffect(() => {
    let cancelled = false;
    if (!isValid) {
      setQrDataUrl("");
      return;
    }
    QRCode.toDataURL(debounced.trim(), { errorCorrectionLevel: "M", margin: 1, width: 320 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, isValid]);

  const StatusIcon = status.icon;

  const commit = (next: string) => {
    setDraft(next);
    onChange(next);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft.trim());
      toast.success("URL copied");
    } catch {
      toast.error("Couldn't copy URL");
    }
  };

  return (
    <div className="rounded-xl border bg-gradient-to-br from-background to-muted/30 p-4 space-y-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <QrCode className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold">Final envelope QR</h4>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Scanned by the player after the verdict to watch the cinematic news report. The page mock-up prints a QR placeholder; the real QR is composited at print time.
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap",
            toneClasses[status.tone],
          )}
        >
          <StatusIcon className="h-3 w-3" />
          {status.label}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
            Solution video URL
          </Label>
          <Input
            type="url"
            inputMode="url"
            value={draft}
            onChange={(e) => commit(e.target.value)}
            placeholder="https://youtube.com/watch?v=…"
            className="text-sm"
            maxLength={500}
          />
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="gap-1.5"
              disabled={!isValid}
              onClick={() => window.open(draft.trim(), "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="h-3.5 w-3.5" /> Test scan
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={!draft.trim()}
              onClick={copy}
            >
              <Copy className="h-3.5 w-3.5" /> Copy URL
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground"
              disabled={!draft}
              onClick={() => commit("")}
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear
            </Button>
          </div>
        </div>

        <div className="flex flex-col items-center gap-1.5 sm:w-[180px]">
          <div
            className={cn(
              "relative flex h-[160px] w-[160px] items-center justify-center rounded-xl border-2 bg-white p-2",
              qrDataUrl ? "border-border shadow-soft" : "border-dashed border-border",
            )}
          >
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="QR preview of solution video URL" className="h-full w-full object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-1.5 text-muted-foreground text-center px-2">
                <QrCode className="h-8 w-8 opacity-40" />
                <span className="text-[10px] leading-tight">Live preview appears here</span>
              </div>
            )}
          </div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            {qrDataUrl ? "Scan to watch" : "Preview"}
          </p>
          {qrDataUrl && (
            <p className="font-mono text-[9px] text-muted-foreground/80 max-w-[180px] truncate" title={draft.trim()}>
              {draft.trim()}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
