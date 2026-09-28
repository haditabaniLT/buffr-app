import { createServerFn } from "@tanstack/react-start";
import { requireParent } from "@/lib/server-helpers";

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

// Parent: own flagged transactions + all children's flagged transactions.
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
