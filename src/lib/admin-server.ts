import { createServerFn } from "@tanstack/react-start";
import { withRetry, requireAdmin } from "./server-helpers";

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

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export type ReportStats = {
  totalUsers: number;
  totalParents: number;
  totalChildren: number;
  activeUsers: number;
  totalMerchants: number;
  totalFlagged: number;
  totalFlaggedAmount: number;
  smsSent: number;
  smsDelivered: number;
  smsFailed: number;
  byCategory: Array<{ category: string; count: number; amount: number }>;
  topMerchants: Array<{ name: string; count: number; amount: number }>;
  recentFlagged: Array<{
    id: string; merchant_name: string | null; name: string | null;
    amount: number; date: string; flag_reason: string | null;
    flag_category: string | null; owner_name: string | null;
  }>;
  userGrowth: Array<{ month: string; count: number }>;
};

export const adminGetReports = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await requireAdmin(data.accessToken);

    const [usersRes, txRes, smsRes, merchantsRes] = await Promise.all([
      supabaseAdmin.rpc("admin_list_users"),          // returns id, role, status, created_at
      supabaseAdmin
        .from("transactions")
        .select("id, merchant_name, name, amount, date, flag_reason, flag_category, owner_user_id")
        .eq("is_flagged", true)
        .order("date", { ascending: false })
        .limit(1000),
      supabaseAdmin.from("sms_logs").select("id, status"),
      supabaseAdmin.from("merchants").select("id"),
    ]);

    // ── User stats ────────────────────────────────────────────────────────────
    const users: any[] = usersRes.data ?? [];
    const totalParents  = users.filter((u) => u.role === "parent").length;
    const totalChildren = users.filter((u) => u.role === "child").length;
    const activeUsers   = users.filter((u) => u.status === "active").length;

    // User growth by month (last 6 months)
    const growthMap = new Map<string, number>();
    for (const u of users) {
      const month = (u.created_at as string).slice(0, 7); // "YYYY-MM"
      growthMap.set(month, (growthMap.get(month) ?? 0) + 1);
    }
    const userGrowth = [...growthMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, count]) => ({ month, count }));

    // ── Transaction stats ─────────────────────────────────────────────────────
    const txns: any[] = txRes.data ?? [];

    // Fetch owner names for recent transactions
    const ownerIds = [...new Set(txns.map((t: any) => t.owner_user_id).filter(Boolean))];
    let ownerMap = new Map<string, string>();
    if (ownerIds.length > 0) {
      const { data: owners } = await supabaseAdmin
        .from("users").select("id, name").in("id", ownerIds);
      ownerMap = new Map((owners ?? []).map((u: any) => [u.id, u.name]));
    }

    const totalFlaggedAmount = txns.reduce((s: number, t: any) => s + Math.abs(t.amount), 0);

    // By category
    const catMap = new Map<string, { count: number; amount: number }>();
    for (const t of txns) {
      const cat = t.flag_category ?? "other";
      const existing = catMap.get(cat) ?? { count: 0, amount: 0 };
      catMap.set(cat, { count: existing.count + 1, amount: existing.amount + Math.abs(t.amount) });
    }
    const byCategory = [...catMap.entries()]
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.count - a.count);

    // Top merchants
    const merchantMap = new Map<string, { count: number; amount: number }>();
    for (const t of txns) {
      const key = t.merchant_name ?? t.name ?? "Unknown";
      const existing = merchantMap.get(key) ?? { count: 0, amount: 0 };
      merchantMap.set(key, { count: existing.count + 1, amount: existing.amount + Math.abs(t.amount) });
    }
    const topMerchants = [...merchantMap.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Recent 10 flagged
    const recentFlagged = txns.slice(0, 10).map((t: any) => ({
      id: t.id,
      merchant_name: t.merchant_name,
      name: t.name,
      amount: Math.abs(t.amount),
      date: t.date,
      flag_reason: t.flag_reason,
      flag_category: t.flag_category,
      owner_name: ownerMap.get(t.owner_user_id) ?? null,
    }));

    // ── SMS stats ─────────────────────────────────────────────────────────────
    const smsLogs: any[] = smsRes.data ?? [];
    const smsDelivered = smsLogs.filter((s) => s.status === "delivered").length;
    const smsFailed    = smsLogs.filter((s) => s.status === "failed").length;

    const stats: ReportStats = {
      totalUsers:        users.length,
      totalParents,
      totalChildren,
      activeUsers,
      totalMerchants:    (merchantsRes.data ?? []).length,
      totalFlagged:      txns.length,
      totalFlaggedAmount,
      smsSent:           smsLogs.length,
      smsDelivered,
      smsFailed,
      byCategory,
      topMerchants,
      recentFlagged,
      userGrowth,
    };

    return { stats };
  });

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

// ---------------------------------------------------------------------------
// FAQs
// ---------------------------------------------------------------------------

export type FaqRow = {
  id: string;
  question: string;
  answer: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export const adminListFaqs = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await requireAdmin(data.accessToken);
    const { data: rows, error } = await (supabaseAdmin as any)
      .from("faqs").select("*").order("sort_order").order("created_at");
    if (error) throw new Error(error.message);
    return { faqs: (rows ?? []) as unknown as FaqRow[] };
  });

export const adminCreateFaq = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string; question: string; answer: string; sort_order?: number }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    if (!input.question?.trim()) throw new Error("Question is required.");
    if (!input.answer?.trim()) throw new Error("Answer is required.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await requireAdmin(data.accessToken);
    const { data: row, error } = await (supabaseAdmin as any)
      .from("faqs")
      .insert({ question: data.question.trim(), answer: data.answer.trim(), sort_order: data.sort_order ?? 0 })
      .select("*").single();
    if (error) throw new Error(error.message);
    return { faq: row as unknown as FaqRow };
  });

export const adminUpdateFaq = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string; id: string; question: string; answer: string; sort_order?: number }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    if (!input.id) throw new Error("Missing FAQ id.");
    if (!input.question?.trim()) throw new Error("Question is required.");
    if (!input.answer?.trim()) throw new Error("Answer is required.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await requireAdmin(data.accessToken);
    const { data: row, error } = await (supabaseAdmin as any)
      .from("faqs")
      .update({ question: data.question.trim(), answer: data.answer.trim(), sort_order: data.sort_order ?? 0 })
      .eq("id", data.id).select("*").single();
    if (error) throw new Error(error.message);
    return { faq: row as unknown as FaqRow };
  });

export const adminDeleteFaq = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string; id: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    if (!input.id) throw new Error("Missing FAQ id.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await requireAdmin(data.accessToken);
    const { error } = await (supabaseAdmin as any).from("faqs").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// ---------------------------------------------------------------------------
// Content pages (Terms / Privacy)
// ---------------------------------------------------------------------------

export type ContentPageRow = {
  id: string;
  slug: string;
  title: string;
  body: string;
  updated_at: string;
};

export const adminListContentPages = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await requireAdmin(data.accessToken);
    const { data: rows, error } = await (supabaseAdmin as any)
      .from("content_pages").select("*").order("slug");
    if (error) throw new Error(error.message);
    return { pages: (rows ?? []) as unknown as ContentPageRow[] };
  });

export const adminUpdateContentPage = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string; slug: string; body: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    if (!input.slug) throw new Error("Missing page slug.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await requireAdmin(data.accessToken);
    const { data: row, error } = await (supabaseAdmin as any)
      .from("content_pages")
      .update({ body: data.body })
      .eq("slug", data.slug)
      .select("*").single();
    if (error) throw new Error(error.message);
    return { page: row as unknown as ContentPageRow };
  });
