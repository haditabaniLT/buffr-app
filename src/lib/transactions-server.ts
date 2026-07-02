import { createServerFn } from "@tanstack/react-start";
import { withRetry, requireParent } from "./server-helpers";

// ── Shared row type returned to the client ──────────────────────────────────

export type TxRow = {
  id: string;
  name: string | null;
  merchant_name: string | null;
  amount: number;
  date: string;
  pending: boolean;
  is_flagged: boolean;
  flag_reason: string | null;
  flag_category: string | null;
  category: string[];
  iso_currency_code: string;
  personal_finance_category: string | null;
  bank_account_id: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  plaid_item_id: string;
};

export type SmsLogRow = {
  id: string;
  parent_id: string;
  transaction_id: string | null;
  phone: string;
  message: string;
  status: string;
  twilio_sid: string | null;
  created_at: string;
};

// ── Parent: own flagged transactions + all children's flagged transactions ────
export const listParentTransactions = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin, parentId } = await requireParent(data.accessToken);

    // Fetch parent's own name + all children's IDs and names in one query
    const { data: users, error: usersErr } = await supabaseAdmin
      .from("users")
      .select("id, name")
      .or(`id.eq.${parentId},parent_id.eq.${parentId}`);

    if (usersErr) throw new Error(usersErr.message);

    const userMap = new Map<string, string>(
      (users ?? []).map((u: { id: string; name: string }) => [u.id, u.name])
    );

    // All relevant owner IDs: parent + children
    const ownerIds = [...userMap.keys()];

    const { data: rows, error } = await supabaseAdmin
      .from("transactions")
      .select("id,name,merchant_name,amount,date,pending,is_flagged,flag_reason,flag_category,category,iso_currency_code,personal_finance_category,bank_account_id,owner_user_id,plaid_item_id")
      .in("owner_user_id", ownerIds)
      .eq("is_flagged", true)
      .order("date", { ascending: false })
      .limit(500);

    if (error) throw new Error(error.message);

    // Attach owner name to each row
    const transactions: TxRow[] = (rows ?? []).map((r: any) => ({
      ...r,
      owner_name: userMap.get(r.owner_user_id) ?? null,
    }));

    return { transactions };
  });

// ── Student: own flagged transactions only ──────────────────────────────────
// Only flagged transactions are stored; always filter to is_flagged = true
// so any non-flagged rows written by the edge function before cleanup don't leak.

export const listStudentTransactions = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { createClient } = await import("@supabase/supabase-js");

    const anonClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
    );
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(data.accessToken);
    if (authErr || !user) throw new Error("Not authenticated.");

    const { data: rows, error } = await supabaseAdmin
      .from("transactions")
      .select(
        "id,name,merchant_name,amount,date,pending,is_flagged,flag_reason,flag_category,category,iso_currency_code,personal_finance_category,bank_account_id,owner_user_id,plaid_item_id",
      )
      .eq("owner_user_id", user.id)
      .eq("is_flagged", true)
      .order("date", { ascending: false })
      .limit(500);

    if (error) throw new Error(error.message);
    return { transactions: (rows ?? []) as TxRow[] };
  });

// ── Parent: SMS alert log ───────────────────────────────────────────────────

export const listSmsLogs = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin, parentId } = await requireParent(data.accessToken);

    const rows = await withRetry(async () => {
      const { data: r, error } = await supabaseAdmin
        .from("sms_logs")
        .select("id,parent_id,transaction_id,phone,message,status,twilio_sid,created_at")
        .eq("parent_id", parentId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return r ?? [];
    }, "load SMS logs");

    return { logs: rows as SmsLogRow[] };
  });

// ── Admin: all SMS logs ─────────────────────────────────────────────────────

export const adminListSmsLogs = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    return input;
  })
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./server-helpers");
    const { supabaseAdmin } = await requireAdmin(data.accessToken);

    const rows = await withRetry(async () => {
      const { data: r, error } = await supabaseAdmin
        .from("sms_logs")
        .select("id,parent_id,transaction_id,phone,message,status,twilio_sid,created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return r ?? [];
    }, "admin load SMS logs");

    return { logs: rows as SmsLogRow[] };
  });
