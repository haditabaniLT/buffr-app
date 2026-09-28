import { createServerFn } from "@tanstack/react-start";
import { requireAdmin } from "@/lib/server-helpers";

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
};

export const adminListFlaggedTransactions = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await requireAdmin(data.accessToken);

    const { data: rows, error } = await supabaseAdmin
      .from("transactions")
      .select("id, merchant_name, name, amount, date, flag_reason, flag_category, owner_user_id")
      .eq("is_flagged", true)
      .order("date", { ascending: false })
      .limit(500);

    if (error) throw new Error(error.message);

    const txns: any[] = rows ?? [];
    const ownerIds = [...new Set(txns.map((t) => t.owner_user_id).filter(Boolean))];
    let ownerMap = new Map<string, string>();
    if (ownerIds.length > 0) {
      const { data: owners } = await supabaseAdmin
        .from("users").select("id, name").in("id", ownerIds);
      ownerMap = new Map((owners ?? []).map((u: any) => [u.id, u.name]));
    }

    const transactions: AdminFlaggedTxRow[] = txns.map((t) => ({
      id:             t.id,
      merchant_name:  t.merchant_name,
      name:           t.name,
      amount:         Math.abs(t.amount),
      date:           t.date,
      flag_reason:    t.flag_reason,
      flag_category:  t.flag_category,
      owner_name:     ownerMap.get(t.owner_user_id) ?? null,
      owner_user_id:  t.owner_user_id,
    }));

    return { transactions };
  });
