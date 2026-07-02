import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  listParentNotifications,
  markAllNotificationsRead,
  type NotificationRow,
} from "@/lib/notifications-server";

async function getToken() {
  return (await supabase.auth.getSession()).data.session?.access_token ?? null;
}

export function NotificationBell() {
  const listFn  = useServerFn(listParentNotifications);
  const markFn  = useServerFn(markAllNotificationsRead);

  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [open,          setOpen]          = useState(false);
  const [loading,       setLoading]       = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) { setLoading(false); return; }
    try {
      const res = await listFn({ data: { accessToken: token } });
      setNotifications(res.notifications);
    } catch { /* silently ignore */ }
    finally { setLoading(false); }
  }, [listFn]);

  useEffect(() => { load(); }, [load]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const unread = notifications.filter((n) => !n.read).length;

  const toggleOpen = async () => {
    if (!open && unread > 0) {
      // Mark all read optimistically, then persist
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      const token = await getToken();
      if (token) markFn({ data: { accessToken: token } }).catch(() => {});
    }
    setOpen((v) => !v);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={toggleOpen}
        className="relative flex items-center justify-center w-8 h-8 rounded-md hover:bg-sidebar-accent transition-colors"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4 text-sidebar-foreground" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 rounded-full bg-destructive text-[10px] text-white font-bold flex items-center justify-center leading-none">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-10 z-50 w-80 rounded-lg border bg-popover shadow-lg text-popover-foreground">
          <div className="px-4 py-3 border-b">
            <span className="font-semibold text-sm">Notifications</span>
          </div>

          <ul className="max-h-72 overflow-y-auto divide-y">
            {loading ? (
              <li className="px-4 py-3 text-sm text-muted-foreground">Loading…</li>
            ) : notifications.length === 0 ? (
              <li className="px-4 py-6 text-sm text-muted-foreground text-center">
                No notifications yet.
              </li>
            ) : (
              notifications.map((n) => (
                <li key={n.id} className={`px-4 py-3 text-sm ${n.read ? "opacity-60" : ""}`}>
                  <div className="font-medium">{n.title}</div>
                  <div className="text-muted-foreground mt-0.5 leading-snug">{n.body}</div>
                  <div className="text-xs text-muted-foreground/60 mt-1">
                    {new Date(n.created_at).toLocaleString()}
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
