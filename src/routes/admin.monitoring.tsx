import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { adminListFlaggedTransactions, type AdminFlaggedTxRow } from "@/lib/admin-server";
import { PageHeader } from "@/components/AppShell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FlagBadge } from "@/components/FlagBadge";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/monitoring")({ component: AdminMonitoring });

const CATEGORY_LABEL: Record<string, string> = {
  gambling:    "Gambling",
  payday_loan: "Payday Loan",
  crypto:      "Crypto",
  high_risk:   "High Risk",
  other:       "Other",
};

async function getToken() {
  return (await supabase.auth.getSession()).data.session?.access_token ?? null;
}

function AdminMonitoring() {
  const listFn = useServerFn(adminListFlaggedTransactions);
  const [transactions, setTransactions] = useState<AdminFlaggedTxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await listFn({ data: { accessToken: token } });
      setTransactions(res.transactions);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load transactions.");
    } finally {
      setLoading(false);
    }
  }, [listFn]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transaction monitoring"
        description="Read-only view of all flagged activity across every linked account."
      />

      {error && (
        <p className="text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2 bg-destructive/5">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Merchant</TableHead>
                <TableHead>Account holder</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Risk signal</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    No flagged transactions yet.
                  </TableCell>
                </TableRow>
              )}
              {transactions.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">
                    {t.merchant_name ?? t.name ?? "Unknown"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {t.owner_name ?? "—"}
                  </TableCell>
                  <TableCell>
                    {t.flag_category ? (
                      <Badge variant="outline" className="text-xs">
                        {CATEGORY_LABEL[t.flag_category] ?? t.flag_category}
                      </Badge>
                    ) : "—"}
                  </TableCell>
                  <TableCell>
                    <FlagBadge reason={t.flag_reason ?? undefined} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(t.date).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-destructive font-medium">
                    ${t.amount.toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {!loading && transactions.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Showing the {transactions.length} most recent flagged transactions.
        </p>
      )}
    </div>
  );
}
