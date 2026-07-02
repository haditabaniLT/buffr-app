import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { adminGetReports, type ReportStats } from "@/lib/admin-server";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, ShieldAlert, MessageSquare, Building2, TrendingUp, CheckCircle2, XCircle } from "lucide-react";

export const Route = createFileRoute("/admin/reports")({ component: AdminReports });

async function getToken() {
  return (await supabase.auth.getSession()).data.session?.access_token ?? null;
}

const CATEGORY_LABELS: Record<string, string> = {
  gambling:               "Gambling",
  crypto:                 "Crypto / NFT",
  payday_loan:            "Payday Loan",
  adult_content:          "Adult Content",
  mlm:                    "MLM",
  dark_web:               "Dark Web",
  tobacco_minor:          "Tobacco / Vaping",
  gaming_lootbox:         "Gaming Loot-Box",
  suspicious_marketplace: "Suspicious Marketplace",
  other_risk:             "Other Risk",
  high_risk:              "High Risk",
  other:                  "Other",
};

function categoryLabel(cat: string) {
  return CATEGORY_LABELS[cat] ?? cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5 flex items-start gap-4">
        <div className={`h-10 w-10 rounded-lg grid place-items-center shrink-0 ${color ?? "bg-accent text-accent-foreground"}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-xs uppercase text-muted-foreground tracking-wide">{label}</div>
          <div className="text-2xl font-semibold mt-0.5">{value}</div>
          {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

function BarChart({ data, max }: { data: Array<{ label: string; value: number; sub?: string }>; max: number }) {
  if (!data.length) return <p className="text-sm text-muted-foreground">No data yet.</p>;
  return (
    <div className="space-y-3">
      {data.map((d) => (
        <div key={d.label}>
          <div className="flex justify-between text-sm mb-1">
            <span className="font-medium">{d.label}</span>
            <span className="text-muted-foreground tabular-nums">{d.value}{d.sub ? ` — ${d.sub}` : ""}</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-destructive transition-all" style={{ width: `${Math.max((d.value / max) * 100, 2)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function MiniBarChart({ data }: { data: Array<{ month: string; count: number }> }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="flex items-end gap-1.5 h-16">
      {data.map((d) => (
        <div key={d.month} className="flex-1 flex flex-col items-center gap-1">
          <div
            className="w-full rounded-t bg-primary/70 transition-all"
            style={{ height: `${Math.max((d.count / max) * 52, 4)}px` }}
            title={`${d.month}: ${d.count} new users`}
          />
          <span className="text-[10px] text-muted-foreground">{d.month.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

function AdminReports() {
  const getReportsFn = useServerFn(adminGetReports);
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) { setLoading(false); return; }
    setLoading(true); setError(null);
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

  if (loading) return (
    <div className="space-y-6">
      <PageHeader title="Reports & analytics" description="Trends and breakdowns across the platform." />
      <div className="grid lg:grid-cols-4 md:grid-cols-2 gap-4">
        {[...Array(8)].map((_, i) => (
          <Card key={i}><CardContent className="p-5"><div className="h-14 bg-muted animate-pulse rounded" /></CardContent></Card>
        ))}
      </div>
    </div>
  );

  if (error) return (
    <div className="space-y-6">
      <PageHeader title="Reports & analytics" />
      <Card><CardContent className="p-6 text-destructive text-sm">{error}</CardContent></Card>
    </div>
  );

  if (!stats) return null;

  const catMax      = Math.max(...stats.byCategory.map((c) => c.count), 1);
  const merchantMax = Math.max(...stats.topMerchants.map((m) => m.count), 1);
  const successRate = stats.smsSent > 0 ? Math.round((stats.smsDelivered / stats.smsSent) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Reports & analytics" description="Live platform data." />

      {/* Users */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Users</h2>
        <div className="grid lg:grid-cols-4 md:grid-cols-2 gap-4">
          <StatCard icon={Users} label="Total users"  value={stats.totalUsers}    color="bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400" />
          <StatCard icon={Users} label="Parents"       value={stats.totalParents}  color="bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400" />
          <StatCard icon={Users} label="Children"      value={stats.totalChildren} color="bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-400" />
          <StatCard icon={Users} label="Active users"  value={stats.activeUsers}   sub={`of ${stats.totalUsers} total`} color="bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400" />
        </div>
      </section>

      {/* Transactions */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Transactions & Merchants</h2>
        <div className="grid lg:grid-cols-4 md:grid-cols-2 gap-4">
          <StatCard icon={ShieldAlert} label="Flagged transactions" value={stats.totalFlagged}     color="bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400" />
          <StatCard icon={TrendingUp}  label="Total flagged amount" value={`$${stats.totalFlaggedAmount.toFixed(2)}`} color="bg-orange-50 text-orange-600 dark:bg-orange-950 dark:text-orange-400" />
          <StatCard icon={Building2}   label="Tracked merchants"    value={stats.totalMerchants}   color="bg-yellow-50 text-yellow-600 dark:bg-yellow-950 dark:text-yellow-400" />
          <StatCard icon={TrendingUp}  label="Avg flagged amount"   value={stats.totalFlagged > 0 ? `$${(stats.totalFlaggedAmount / stats.totalFlagged).toFixed(2)}` : "—"} color="bg-pink-50 text-pink-600 dark:bg-pink-950 dark:text-pink-400" />
        </div>
      </section>

      {/* SMS */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">SMS Alerts</h2>
        <div className="grid lg:grid-cols-3 md:grid-cols-2 gap-4">
          <StatCard icon={MessageSquare} label="SMS sent"    value={stats.smsSent}      color="bg-cyan-50 text-cyan-600 dark:bg-cyan-950 dark:text-cyan-400" />
          <StatCard icon={CheckCircle2}  label="Delivered"   value={stats.smsDelivered} sub={`${successRate}% success rate`} color="bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400" />
          <StatCard icon={XCircle}       label="Failed"      value={stats.smsFailed}    color="bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400" />
        </div>
      </section>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-5">
            <h2 className="font-semibold mb-4">Flags by Category</h2>
            <BarChart max={catMax} data={stats.byCategory.map((c) => ({ label: categoryLabel(c.category), value: c.count, sub: `$${c.amount.toFixed(0)}` }))} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <h2 className="font-semibold mb-4">Top Flagged Merchants</h2>
            <BarChart max={merchantMax} data={stats.topMerchants.map((m) => ({ label: m.name, value: m.count, sub: `$${m.amount.toFixed(0)}` }))} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <h2 className="font-semibold mb-4">User Growth <span className="text-muted-foreground font-normal text-xs">(last 6 months)</span></h2>
            {stats.userGrowth.length > 0
              ? <MiniBarChart data={stats.userGrowth} />
              : <p className="text-sm text-muted-foreground">Not enough data yet.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <h2 className="font-semibold mb-4">SMS Delivery Breakdown</h2>
            {stats.smsSent === 0
              ? <p className="text-sm text-muted-foreground">No SMS sent yet.</p>
              : (
                <div className="space-y-3">
                  {[
                    { label: "Delivered", value: stats.smsDelivered, cls: "bg-green-500" },
                    { label: "Failed",    value: stats.smsFailed,    cls: "bg-red-500" },
                    { label: "Pending",   value: stats.smsSent - stats.smsDelivered - stats.smsFailed, cls: "bg-yellow-400" },
                  ].map((row) => (
                    <div key={row.label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="flex items-center gap-2">
                          <span className={`inline-block h-2.5 w-2.5 rounded-full ${row.cls}`} />
                          {row.label}
                        </span>
                        <span className="text-muted-foreground tabular-nums">
                          {row.value} ({stats.smsSent > 0 ? Math.round((row.value / stats.smsSent) * 100) : 0}%)
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full ${row.cls}`} style={{ width: `${stats.smsSent > 0 ? (row.value / stats.smsSent) * 100 : 0}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </CardContent>
        </Card>
      </div>

      {/* Recent flagged transactions */}
      <Card>
        <CardContent className="p-5">
          <h2 className="font-semibold mb-4">Recent Flagged Transactions</h2>
          {stats.recentFlagged.length === 0
            ? <p className="text-sm text-muted-foreground">No flagged transactions yet.</p>
            : (
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Merchant</TableHead>
                      <TableHead>Person</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.recentFlagged.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">{t.merchant_name ?? t.name ?? "Unknown"}</TableCell>
                        <TableCell className="text-muted-foreground">{t.owner_name ?? "—"}</TableCell>
                        <TableCell>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium">
                            {t.flag_reason ?? categoryLabel(t.flag_category ?? "other")}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{new Date(t.date).toLocaleDateString()}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium text-destructive">${t.amount.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
        </CardContent>
      </Card>
    </div>
  );
}
