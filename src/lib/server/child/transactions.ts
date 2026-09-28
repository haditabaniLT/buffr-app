import { createServerFn } from "@tanstack/react-start";
import { requireChild } from "@/lib/server-helpers";

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

// Child: own flagged transactions only.
// Only flagged transactions are stored; always filter to is_flagged = true
// so any non-flagged rows written by the edge function before cleanup don't leak.
export const listStudentTransactions = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin, childId } = await requireChild(data.accessToken);

    const { data: rows, error } = await supabaseAdmin
      .from("transactions")
      .select(
        "id,name,merchant_name,amount,date,pending,is_flagged,flag_reason,flag_category,category,iso_currency_code,personal_finance_category,bank_account_id,owner_user_id,plaid_item_id",
      )
      .eq("owner_user_id", childId)
      .eq("is_flagged", true)
      .order("date", { ascending: false })
      .limit(500);

    if (error) throw new Error(error.message);
    return { transactions: (rows ?? []) as TxRow[] };
  });
