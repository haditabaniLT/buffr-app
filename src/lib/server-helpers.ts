// Shared server-only helpers: retry/transient detection + role guards.
// Import only from server functions or *.server.ts files.

const TRANSIENT_RE =
  /schema cache|retrying|connection|unexpected eof|fetch failed|network|temporarily/i;

export function isTransient(err: unknown) {
  const e = err as { message?: string; code?: string; status?: number; details?: string } | null;
  return (
    e?.code === "PGRST001" ||
    e?.code === "PGRST002" ||
    e?.status === 503 ||
    TRANSIENT_RE.test(`${e?.message ?? ""} ${e?.details ?? ""}`)
  );
}

/** Extract a human-readable message from any thrown value (Error, Supabase error, string, etc.) */
export function extractMessage(err: unknown, fallback = "Unknown error"): string {
  if (!err) return fallback;
  if (typeof err === "string") return err || fallback;
  if (err instanceof Error) return err.message || fallback;
  if (typeof err === "object") {
    const o = err as Record<string, any>;
    // Supabase PostgREST / auth errors: { message, code, details, hint }
    if (typeof o.message === "string" && o.message) return o.message;
    if (typeof o.error_description === "string") return o.error_description;
    if (typeof o.error === "string") return o.error;
    // Nested: TanStack Start may double-wrap
    if (o.message && typeof o.message === "object") {
      const inner = extractMessage(o.message, "");
      if (inner) return inner;
    }
    try { return JSON.stringify(o); } catch { /* ignore */ }
  }
  return fallback;
}

export async function withRetry<T>(op: () => Promise<T>, label = "operation", attempts = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await op();
    } catch (err) {
      last = err;
      if (!isTransient(err) || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  if (isTransient(last)) {
    throw new Error(`Unable to ${label} right now. Please try again in a moment.`);
  }
  throw last instanceof Error ? last : new Error(extractMessage(last, `Failed to ${label}.`));
}

type AppRole = "admin" | "parent" | "child";

async function requireRole(accessToken: string, role: AppRole) {
  if (!accessToken) throw new Error("Please sign in again.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const authData = await withRetry(async () => {
    const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
    if (error || !data.user) throw new Error(extractMessage(error, "Session could not be verified."));
    return data;
  }, "verify your session");

  const userRole = await withRetry(async () => {
    const { data, error } = await supabaseAdmin.rpc("get_primary_role", { _user_id: authData.user.id });
    if (error) throw new Error(extractMessage(error, "Could not determine user role."));
    return data;
  }, "verify your role");

  if (userRole !== role) {
    throw new Error(
      role === "admin" ? "Admin access required." : "You don't have access to this action."
    );
  }
  return { supabaseAdmin, userId: authData.user.id };
}

export async function requireParent(accessToken: string) {
  const { supabaseAdmin, userId } = await requireRole(accessToken, "parent");
  return { supabaseAdmin, parentId: userId };
}

export async function requireAdmin(accessToken: string) {
  const { supabaseAdmin, userId } = await requireRole(accessToken, "admin");
  return { supabaseAdmin, adminId: userId };
}

export async function requireChild(accessToken: string) {
  const { supabaseAdmin, userId } = await requireRole(accessToken, "child");
  return { supabaseAdmin, childId: userId };
}

/** Like requireChild but also blocks minors (is_minor = true).
 *  Use this for any action a child under 18 is not permitted to perform
 *  (linking/removing their own bank accounts). */
export async function requireAdultChild(accessToken: string) {
  const { supabaseAdmin, childId } = await requireChild(accessToken);
  const { data: profile } = await supabaseAdmin
    .from("users")
    .select("is_minor")
    .eq("id", childId)
    .single();
  if (profile?.is_minor) {
    throw new Error("Bank account management is handled by your parent or guardian.");
  }
  return { supabaseAdmin, childId };
}
