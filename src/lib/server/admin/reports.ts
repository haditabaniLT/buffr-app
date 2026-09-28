import { createServerFn } from "@tanstack/react-start";
import { requireAdmin } from "@/lib/server-helpers";

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
