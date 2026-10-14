import { createAdminServerFn } from "@/lib/server/admin/server-fn";

// ---------------------------------------------------------------------------
// Flagged transactions — full list for monitoring page
// ---------------------------------------------------------------------------

export type AdminFlaggedTxRow = {
  id: string;
  merchant_name: string | null;
  name: string | null;
  amount: number;
  date: string;
  flag_reason: string | null;
  flag_category: string | null;
  owner_name: string | null;
  owner_user_id: string | null;
  alert_status: string | null;
  alert_error: string | null;
  alert_attempted_at: string | null;
};

export const adminListFlaggedTransactions = createAdminServerFn()
  .handler(async ({ context }) => {
    const { supabaseAdmin } = context;

    const { data: rows, error } = await supabaseAdmin
      .from("transactions")
      .select("id, merchant_name, name, amount, date, flag_reason, flag_category, owner_user_id")
      .eq("is_flagged", true)
      .order("date", { ascending: false })
      .limit(500);

    if (error) throw new Error(error.message);

    const txns: any[] = rows ?? [];
    const ownerIds = [...new Set(txns.map((t) => t.owner_user_id).filter(Boolean))];
    const txnIds = txns.map((t) => t.id as string);

    const [ownersRes, attemptsRes] = await Promise.all([
      ownerIds.length > 0
        ? supabaseAdmin.from("users").select("id, name").in("id", ownerIds)
        : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
      txnIds.length > 0
        ? supabaseAdmin
            .from("notification_attempts")
            .select("transaction_id, status, error, attempted_at")
            .eq("type", "sms")
            .in("transaction_id", txnIds)
            .order("attempted_at", { ascending: false })
        : Promise.resolve({ data: [] as Array<{ transaction_id: string; status: string; error: string | null; attempted_at: string }> }),
    ]);

    const ownerMap = new Map((ownersRes.data ?? []).map((u: { id: string; name: string }) => [u.id, u.name]));
    const latestAttempt = new Map<string, { status: string; error: string | null; attempted_at: string }>();
    for (const attempt of attemptsRes.data ?? []) {
      if (!latestAttempt.has(attempt.transaction_id)) latestAttempt.set(attempt.transaction_id, attempt);
    }

    const transactions: AdminFlaggedTxRow[] = txns.map((t) => {
      const attempt = latestAttempt.get(t.id);
      return {
        id:             t.id,
        merchant_name:  t.merchant_name,
        name:           t.name,
        amount:         Math.abs(t.amount),
        date:           t.date,
        flag_reason:    t.flag_reason,
        flag_category:  t.flag_category,
        owner_name:     ownerMap.get(t.owner_user_id) ?? null,
        owner_user_id:  t.owner_user_id,
        alert_status:   attempt?.status ?? null,
        alert_error:    attempt?.error ?? null,
        alert_attempted_at: attempt?.attempted_at ?? null,
      };
    });

    return { transactions };
  });
