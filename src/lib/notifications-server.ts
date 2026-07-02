import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { requireParent } from "@/lib/server-helpers";

const SUPABASE_URL         = process.env.SUPABASE_URL              ?? process.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

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

/** Internal helper — called server-side only (not a server function) */
export async function insertNotification(opts: {
  userId: string;
  type: string;
  title: string;
  body: string;
}) {
  if (!SUPABASE_SERVICE_KEY) return;
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  await (admin.from("notifications") as any).insert({
    user_id:    opts.userId,
    type:       opts.type,
    title:      opts.title,
    body:       opts.body,
  });
}
