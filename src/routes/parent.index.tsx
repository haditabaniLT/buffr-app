import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
import { listParentTransactions, type TxRow } from "@/lib/transactions-server";
import { dbTxToMock, type Transaction } from "@/lib/mock-data";
import { getParentChildren, type ParentChildRow } from "@/lib/children-server";
import { PageHeader } from "@/components/AppShell";
import { KpiCard } from "@/components/KpiCard";
import { TransactionsTable } from "@/components/TransactionsTable";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, Clock, DollarSign, Users } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/parent/")({ component: ParentDashboard });

async function getToken() {
  return (await supabase.auth.getSession()).data.session?.access_token ?? null;
}

function ParentDashboard() {
  const { profile } = useAuth();
  const { smsLogs } = useStore();

  const listTxFn      = useServerFn(listParentTransactions);
  const getChildrenFn = useServerFn(getParentChildren);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [children,     setChildren]     = useState<ParentChildRow[]>([]);
  const [loading,      setLoading]      = useState(true);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) { setLoading(false); return; }
    setLoading(true);
    try {
      const [txRes, chRes] = await Promise.all([
        listTxFn({ data: { accessToken: token } }),
        getChildrenFn({ data: { accessToken: token } }),
      ]);
      setTransactions((txRes.transactions as TxRow[]).map(dbTxToMock));
      setChildren(chRes.children);
    } catch (e) {
      console.error("dashboard load failed:", e);
    } finally {
      setLoading(false);
    }
  }, [listTxFn, getChildrenFn]);

  useEffect(() => { load(); }, [load]);

  const flagged        = transactions.filter((t) => t.isFlagged);
  const flaggedTotal   = flagged.reduce((s, t) => s + t.amount, 0);
  const lastFlagged    = [...flagged].sort((a, b) => +new Date(b.date) - +new Date(a.date))[0];
  const linkedChildren = children.filter((c) => c.type === "child" && c.status === "linked");
  const pendingInvites = children.filter((c) => c.type === "invitation" && c.status === "pending");

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${profile?.name?.split(" ")[0] ?? "Parent"}`}
        description="Here's what's happening across your linked accounts."
      />

      {/* Pending child account banner */}
      {!loading && pendingInvites.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-400/40 bg-yellow-400/10 px-4 py-3 text-sm">
          <Clock className="h-4 w-4 mt-0.5 shrink-0 text-yellow-600 dark:text-yellow-400" />
          <div className="flex-1 min-w-0">
            <span className="font-semibold text-yellow-700 dark:text-yellow-300">
              Pending Child Account Connection
            </span>
            <p className="text-yellow-700/80 dark:text-yellow-300/80 mt-0.5">
              {pendingInvites.length === 1
                ? `An invitation has been sent to ${pendingInvites[0].email}.`
                : `${pendingInvites.length} invitations are waiting to be accepted.`}{" "}
              The setup will be complete once your child creates their account and connects a bank.
            </p>
          </div>
          <Link to="/parent/child" className="shrink-0 text-xs underline text-yellow-700 dark:text-yellow-300 hover:opacity-80">
            Manage
          </Link>
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-4">
        <KpiCard label="Flagged"         value={loading ? "…" : flagged.length}                tone="danger" icon={<AlertTriangle className="h-4 w-4" />} />
        <KpiCard label="Flagged Amount"  value={loading ? "…" : `$${flaggedTotal.toFixed(2)}`} tone="danger" icon={<DollarSign className="h-4 w-4" />} />
        <KpiCard label="Linked Children" value={loading ? "…" : linkedChildren.length}         icon={<Users className="h-4 w-4" />} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardContent className="p-5">
            <h2 className="font-semibold mb-3">Recent transactions</h2>
            {loading
              ? <p className="text-sm text-muted-foreground">Loading…</p>
              : <TransactionsTable transactions={transactions} />}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardContent className="p-5">
              <h2 className="font-semibold mb-3">Last alert</h2>
              {lastFlagged ? (
                <div className="text-sm space-y-1">
                  <div className="font-medium">{lastFlagged.merchantName}</div>
                  <div className="text-destructive">${lastFlagged.amount.toFixed(2)} · {lastFlagged.flagReason}</div>
                  <div className="text-xs text-muted-foreground">{new Date(lastFlagged.date).toLocaleDateString()}</div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{loading ? "Loading…" : "No alerts yet."}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <h2 className="font-semibold mb-3">Children</h2>
              <ul className="space-y-2 text-sm">
                {linkedChildren.map((c) => (
                  <li key={c.id} className="flex items-center justify-between">
                    <span>{c.name}</span>
                    <span className="text-xs text-muted-foreground">{c.email}</span>
                  </li>
                ))}
                {!loading && linkedChildren.length === 0 && (
                  <li className="text-muted-foreground">No children linked yet.</li>
                )}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <h2 className="font-semibold mb-3">SMS notifications</h2>
              <p className="text-sm text-muted-foreground">{flagged.length} alert{flagged.length !== 1 ? "s" : ""} sent.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
