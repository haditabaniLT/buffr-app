import { createAdminServerFn } from "@/lib/server/admin/server-fn";
import { withRetry } from "@/lib/server-helpers";

// ---------- Merchants ----------
export type MerchantRow = {
  id: string;
  name: string;
  category: "gambling" | "payday_loan" | "crypto" | "high_risk";
  risk_level: "low" | "medium" | "high";
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export const listMerchants = createAdminServerFn()
  .handler(async ({ context }) => {
    const { supabaseAdmin } = context;
    const rows = await withRetry(async () => {
      const { data: r, error } = await supabaseAdmin
        .from("merchants")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return r ?? [];
    }, "load merchants");
    return { merchants: rows as MerchantRow[] };
  });

type MerchantInput = {
  name: string;
  category: MerchantRow["category"];
  risk_level: MerchantRow["risk_level"];
  notes?: string | null;
};

function validateMerchant(m: Partial<MerchantInput>): MerchantInput {
  const name = (m.name ?? "").trim();
  if (!name) throw new Error("Merchant name is required.");
  if (!["gambling", "payday_loan", "crypto", "high_risk"].includes(m.category as string)) {
    throw new Error("Invalid category.");
  }
  if (!["low", "medium", "high"].includes(m.risk_level as string)) {
    throw new Error("Invalid risk level.");
  }
  return {
    name,
    category: m.category as MerchantRow["category"],
    risk_level: m.risk_level as MerchantRow["risk_level"],
    notes: m.notes?.toString().trim() || null,
  };
}

export const createMerchant = createAdminServerFn()
  .inputValidator((input: Partial<MerchantInput>) => {
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = context;
    const payload = validateMerchant(data);
    const row = await withRetry(async () => {
      const { data: r, error } = await supabaseAdmin
        .from("merchants")
        .insert(payload)
        .select("*")
        .single();
      if (error) throw error;
      return r;
    }, "create merchant");
    return { merchant: row as MerchantRow };
  });

export const updateMerchant = createAdminServerFn()
  .inputValidator(
    (input: { accessToken: string; id: string } & Partial<MerchantInput>) => {
      if (!input.id) throw new Error("Missing merchant id.");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = context;
    const payload = validateMerchant(data);
    const row = await withRetry(async () => {
      const { data: r, error } = await supabaseAdmin
        .from("merchants")
        .update(payload)
        .eq("id", data.id)
        .select("*")
        .single();
      if (error) throw error;
      return r;
    }, "update merchant");
    return { merchant: row as MerchantRow };
  });

export const deleteMerchant = createAdminServerFn()
  .inputValidator((input: { accessToken: string; id: string }) => {
    if (!input.id) throw new Error("Missing merchant id.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = context;
    await withRetry(async () => {
      const { error } = await supabaseAdmin.from("merchants").delete().eq("id", data.id);
      if (error) throw error;
      return true;
    }, "delete merchant");
    return { ok: true as const };
  });
