import { createServerFn } from "@tanstack/react-start";
import { isTransient, withRetry } from "./server-helpers";

type AppRole = "admin" | "parent" | "child";

type ProfileSnapshot = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  parent_id: string | null;
  status: "active" | "suspended" | "blocked";
};

function normalizeRole(value: unknown): AppRole | null {
  return value === "admin" || value === "parent" || value === "child" ? value : null;
}

export const getAuthSnapshot = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string }) => {
    if (!input?.accessToken) throw new Error("Missing session token");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    try {
      const authData = await withRetry(async () => {
        const { data: d, error } = await supabaseAdmin.auth.getUser(data.accessToken);
        if (error) throw error;
        if (!d.user) throw new Error("No user for token");
        return d;
      });

      const uid = authData.user.id;
      const [profileResult, roleResult] = await Promise.all([
        withRetry(async () => {
          const r = await supabaseAdmin
            .from("users")
            .select("id,name,email,phone,avatar_url,parent_id,status")
            .eq("id", uid)
            .maybeSingle();
          if (r.error) throw r.error;
          return r;
        }),
        withRetry(async () => {
          const r = await supabaseAdmin.rpc("get_primary_role", { _user_id: uid });
          if (r.error) throw r.error;
          return r;
        }),
      ]);

      return {
        ok: true as const,
        profile: (profileResult.data as ProfileSnapshot | null) ?? null,
        role: normalizeRole(roleResult.data),
      };
    } catch (err) {
      // Soft-fail on transient backend issues so the client can keep its cached snapshot.
      if (isTransient(err)) {
        return {
          ok: false as const,
          transient: true,
          profile: null,
          role: null,
          message: "Backend warming up",
        };
      }
      const e = err as { message?: string; status?: number; code?: string } | null;
      if (e?.status === 401 || e?.status === 403) {
        return {
          ok: false as const,
          transient: false,
          code: "INVALID_SESSION" as const,
          profile: null,
          role: null,
          message: "Your session could not be verified. Please sign in again.",
        };
      }
      console.error("[auth-server] snapshot failed:", err);
      return {
        ok: false as const,
        transient: false,
        code: "AUTH_SNAPSHOT_UNAVAILABLE" as const,
        profile: null,
        role: null,
        message: "Account data is temporarily unavailable.",
      };
    }
  });
