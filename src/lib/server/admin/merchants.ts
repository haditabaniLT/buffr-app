import { createServerFn } from "@tanstack/react-start";
import { withRetry, requireAdmin } from "@/lib/server-helpers";

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

export const listMerchants = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await requireAdmin(data.accessToken);
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

export const createMerchant = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string } & Partial<MerchantInput>) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await requireAdmin(data.accessToken);
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

export const updateMerchant = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { accessToken: string; id: string } & Partial<MerchantInput>) => {
      if (!input?.accessToken) throw new Error("Please sign in again.");
      if (!input.id) throw new Error("Missing merchant id.");
      return input;
    },
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await requireAdmin(data.accessToken);
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

export const deleteMerchant = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string; id: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    if (!input.id) throw new Error("Missing merchant id.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await requireAdmin(data.accessToken);
    await withRetry(async () => {
      const { error } = await supabaseAdmin.from("merchants").delete().eq("id", data.id);
      if (error) throw error;
      return true;
    }, "delete merchant");
    return { ok: true as const };
  });
