import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { adminGetReports, type ReportStats } from "@/lib/admin-server";
import { PageHeader } from "@/components/AppShell";
import { KpiCard } from "@/components/KpiCard";
import { Card, CardContent } from "@/components/ui/card";
import { Activity, AlertTriangle, Bell, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/")({ component: AdminOverview });

const FLAG_LABEL: Record<string, string> = {
  gambling:    "Gambling",
  payday_loan: "Payday Loan",
  crypto:      "Crypto Exchange",
  high_risk:   "High Risk",
  other:       "Other",
};

async function getToken() {
  return (await supabase.auth.getSession()).data.session?.access_token ?? null;
}

function AdminOverview() {
  const getReportsFn = useServerFn(adminGetReports);
  const [stats,   setStats]   = useState<ReportStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await getReportsFn({ data: { accessToken: token } });
      setStats(res.stats);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load reports.");
    } finally {
      setLoading(false);
    }
  }, [getReportsFn]);

  useEffect(() => { load(); }, [load]);

  const v = (n: number | undefined) => (loading ? "…" : (n ?? 0));

  return (
    <div className="space-y-6">
      <PageHeader title="Platform overview" description="Key metrics across the Buffr platform." />

      {error && (
        <p className="text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2 bg-destructive/5">
          {error}
        </p>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total Users"   value={v(stats?.totalUsers)}   icon={<Users className="h-4 w-4" />} />
        <KpiCard label="Flagged"       value={v(stats?.totalFlagged)} tone="danger" icon={<AlertTriangle className="h-4 w-4" />} />
        <KpiCard label="Alerts Sent"   value={v(stats?.smsSent)}      icon={<Bell className="h-4 w-4" />} />
        <KpiCard label="Active Users"  value={v(stats?.activeUsers)}  icon={<Activity className="h-4 w-4" />} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Risk category breakdown */}
        <Card>
          <CardContent className="p-5">
            <h2 className="font-semibold mb-3">Risk categories</h2>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : !stats?.byCategory?.length ? (
              <p className="text-sm text-muted-foreground">No flagged activity yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {stats.byCategory.map(({ category, count, amount }) => (
                  <li key={category} className="flex items-center justify-between">
                    <span>{FLAG_LABEL[category] ?? category}</span>
                    <span className="flex items-center gap-3 tabular-nums">
                      <span className="text-muted-foreground">${amount.toFixed(2)}</span>
                      <span className="font-semibold w-6 text-right">{count}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Recent flags */}
        <Card>
          <CardContent className="p-5">
            <h2 className="font-semibold mb-3">Recent flags</h2>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : !stats?.recentFlagged?.length ? (
              <p className="text-sm text-muted-foreground">No flagged transactions yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {stats.recentFlagged.map((t) => (
                  <li key={t.id} className="flex justify-between border-b last:border-0 pb-2 gap-2">
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium truncate">
                        {t.merchant_name ?? t.name ?? "Unknown"}
                      </span>
                      {t.owner_name && (
                        <span className="text-xs text-muted-foreground">{t.owner_name}</span>
                      )}
                    </div>
                    <span className="text-destructive tabular-nums shrink-0">
                      ${t.amount.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* User / SMS summary row */}
      {stats && (
        <div className="grid sm:grid-cols-3 gap-4 text-sm">
          <Card>
            <CardContent className="p-5 space-y-1">
              <h2 className="font-semibold">Users</h2>
              <div className="flex justify-between text-muted-foreground">
                <span>Parents</span><span className="tabular-nums">{stats.totalParents}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Children</span><span className="tabular-nums">{stats.totalChildren}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Active</span><span className="tabular-nums">{stats.activeUsers}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5 space-y-1">
              <h2 className="font-semibold">SMS Delivery</h2>
              <div className="flex justify-between text-muted-foreground">
                <span>Sent</span><span className="tabular-nums">{stats.smsSent}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Delivered</span><span className="tabular-nums text-success">{stats.smsDelivered}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Failed</span><span className="tabular-nums text-destructive">{stats.smsFailed}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5 space-y-1">
              <h2 className="font-semibold">Flagged activity</h2>
              <div className="flex justify-between text-muted-foreground">
                <span>Total flagged</span><span className="tabular-nums">{stats.totalFlagged}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Total amount</span>
                <span className="tabular-nums text-destructive">${stats.totalFlaggedAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Merchants tracked</span><span className="tabular-nums">{stats.totalMerchants}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
