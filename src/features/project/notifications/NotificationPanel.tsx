import { useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Sparkles, AlertTriangle, Bell, Check, X } from "lucide-react";
import type { ProjectNotification } from "./useProjectNotifications";

type Filter = "all" | "unread" | "assistant" | "user";

function relativeTime(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationPanel({
  open,
  onOpenChange,
  notifications,
  onMarkRead,
  onDismiss,
  onMarkAllRead,
  onClearDismissed,
  onOpenAssistant,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  notifications: ProjectNotification[];
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onMarkAllRead: () => void;
  onClearDismissed: () => void;
  onOpenAssistant: (starterPrompt: string, notificationId: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const unreadCount = notifications.filter((n) => n.status === "unread").length;
  const dismissedCount = notifications.filter((n) => n.status === "dismissed").length;

  const filtered = useMemo(() => {
    if (filter === "unread") return notifications.filter((n) => n.status === "unread");
    if (filter === "assistant") return notifications.filter((n) => n.created_by === "assistant");
    if (filter === "user") return notifications.filter((n) => n.created_by === "user");
    return notifications;
  }, [notifications, filter]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col gap-0 p-0">
        <SheetHeader className="px-5 pt-5 pb-3 border-b">
          <SheetTitle>Case notifications</SheetTitle>
          <SheetDescription>
            {unreadCount} unread / {notifications.length} total
          </SheetDescription>
          <div className="flex items-center gap-2 pt-2">
            <Button variant="outline" size="sm" disabled={unreadCount === 0} onClick={onMarkAllRead}>
              Mark all read
            </Button>
            <Button variant="ghost" size="sm" disabled={dismissedCount === 0} onClick={onClearDismissed}>
              Clear dismissed
            </Button>
          </div>
          <div className="flex items-center gap-1 pt-3 flex-wrap">
            {([
              ["all", "All"],
              ["unread", "Unread"],
              ["assistant", "From assistant"],
              ["user", "From you"],
            ] as Array<[Filter, string]>).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={
                  "text-[11px] px-2.5 py-1 rounded-full border transition " +
                  (filter === key
                    ? "bg-foreground text-background border-foreground"
                    : "bg-transparent text-muted-foreground border-border hover:text-foreground")
                }
              >
                {label}
              </button>
            ))}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-auto p-4 space-y-2">
          {filtered.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-12 px-6">
              No notifications yet — when you change something the assistant should weigh in on, it'll show up here.
            </div>
          ) : (
            filtered.map((n) => (
              <NotificationCard
                key={n.id}
                n={n}
                onMarkRead={onMarkRead}
                onDismiss={onDismiss}
                onOpenAssistant={onOpenAssistant}
              />
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function NotificationCard({
  n,
  onMarkRead,
  onDismiss,
  onOpenAssistant,
}: {
  n: ProjectNotification;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onOpenAssistant: (prompt: string, id: string) => void;
}) {
  const Icon = n.created_by === "assistant" ? Sparkles : n.kind === "general" ? Bell : AlertTriangle;
  const iconClass =
    n.created_by === "assistant"
      ? "text-accent"
      : n.kind === "general"
        ? "text-muted-foreground"
        : "text-amber-500";

  return (
    <div
      className={
        "rounded-lg border p-3 transition " +
        (n.status === "unread" ? "bg-card border-accent/40" : "bg-card/50 border-border opacity-80")
      }
    >
      <div className="flex items-start gap-2.5">
        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${iconClass}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <h4 className="text-sm font-medium leading-snug flex-1">{n.title}</h4>
            <span className="text-[10px] text-muted-foreground shrink-0">{relativeTime(n.created_at)}</span>
          </div>
          {n.body && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{n.body}</p>}
          <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
            {n.starter_prompt && n.status !== "dismissed" && (
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs"
                onClick={() => onOpenAssistant(n.starter_prompt!, n.id)}
              >
                Open in Assistant
              </Button>
            )}
            {n.status === "unread" && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => onMarkRead(n.id)}
              >
                <Check className="h-3 w-3 mr-1" /> Mark read
              </Button>
            )}
            {n.status !== "dismissed" && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => onDismiss(n.id)}
              >
                <X className="h-3 w-3 mr-1" /> Dismiss
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
