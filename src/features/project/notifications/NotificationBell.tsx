import { useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProjectNotifications } from "./useProjectNotifications";
import { NotificationPanel } from "./NotificationPanel";

export function NotificationBell({
  projectId,
  onOpenAssistant,
}: {
  projectId: string;
  onOpenAssistant: (starterPrompt: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, markRead, dismiss, markAllRead, clearDismissed } =
    useProjectNotifications(projectId);

  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        onClick={() => setOpen(true)}
        className="relative text-muted-foreground hover:text-foreground"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-accent text-accent-foreground text-[10px] font-semibold flex items-center justify-center">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Button>
      <NotificationPanel
        open={open}
        onOpenChange={setOpen}
        notifications={notifications}
        onMarkRead={markRead}
        onDismiss={dismiss}
        onMarkAllRead={() => markAllRead()}
        onClearDismissed={() => clearDismissed()}
        onOpenAssistant={(prompt, id) => {
          markRead(id);
          setOpen(false);
          onOpenAssistant(prompt);
        }}
      />
    </>
  );
}
