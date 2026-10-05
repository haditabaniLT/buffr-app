import { createParentServerFn } from "@/lib/server/parent/server-fn";

export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
};

export const listParentNotifications = createParentServerFn()
  .handler(async ({ context }) => {
    const { supabaseAdmin, parentId } = context;
    const { data: rows, error } = await (supabaseAdmin as any)
      .from("notifications")
      .select("id, type, title, body, read, created_at")
      .eq("user_id", parentId)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error((error as any).message);
    return { notifications: (rows ?? []) as NotificationRow[] };
  });

export const markAllNotificationsRead = createParentServerFn()
  .handler(async ({ context }) => {
    const { supabaseAdmin, parentId } = context;
    const { error } = await (supabaseAdmin as any)
      .from("notifications")
      .update({ read: true })
      .eq("user_id", parentId)
      .eq("read", false);
    if (error) throw new Error((error as any).message);
    return { ok: true };
  });
