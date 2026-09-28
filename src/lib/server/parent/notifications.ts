import { createServerFn } from "@tanstack/react-start";
import { requireParent } from "@/lib/server-helpers";

export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
};

export const listParentNotifications = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin, parentId } = await requireParent(data.accessToken);
    const { data: rows, error } = await (supabaseAdmin as any)
      .from("notifications")
      .select("id, type, title, body, read, created_at")
      .eq("user_id", parentId)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error((error as any).message);
    return { notifications: (rows ?? []) as NotificationRow[] };
  });

export const markAllNotificationsRead = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin, parentId } = await requireParent(data.accessToken);
    const { error } = await (supabaseAdmin as any)
      .from("notifications")
      .update({ read: true })
      .eq("user_id", parentId)
      .eq("read", false);
    if (error) throw new Error((error as any).message);
    return { ok: true };
  });
