import { createServerFn } from "@tanstack/react-start";
import { withRetry, requireAdmin } from "@/lib/server-helpers";

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: "active" | "suspended" | "blocked";
  role: "parent" | "child" | "admin" | null;
  parent_id: string | null;
  parent_name: string | null;
  created_at: string;
};

export const adminListUsers = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await requireAdmin(data.accessToken);
    const rows = await withRetry(async () => {
      const { data: r, error } = await supabaseAdmin.rpc("admin_list_users");
      if (error) throw error;
      return r ?? [];
    }, "load users");
    return { users: rows as AdminUserRow[] };
  });

export const adminSetUserStatus = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { accessToken: string; userId: string; status: "active" | "suspended" | "blocked" }) => {
      if (!input?.accessToken) throw new Error("Please sign in again.");
      if (!input.userId) throw new Error("Missing user id.");
      if (!["active", "suspended", "blocked"].includes(input.status)) {
        throw new Error("Invalid status.");
      }
      return input;
    },
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await requireAdmin(data.accessToken);

    const updated = await withRetry(async () => {
      const { data: r, error } = await supabaseAdmin
        .from("users")
        .update({ status: data.status })
        .eq("id", data.userId)
        .select("id,status")
        .single();
      if (error) throw error;
      return r;
    }, "update user status");

    // If blocked, sign the user out everywhere by revoking sessions.
    if (data.status === "blocked" || data.status === "suspended") {
      try {
        await supabaseAdmin.auth.admin.signOut(data.userId);
      } catch (e) {
        console.warn("[admin] signOut failed (non-fatal):", e);
      }
    }

    return { ok: true as const, user: updated };
  });
