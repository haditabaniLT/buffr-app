import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { listStudentTransactions, type TxRow } from "@/lib/transactions-server";
import { dbTxToMock, type Transaction } from "@/lib/mock-data";
import { PageHeader } from "@/components/AppShell";
import { KpiCard } from "@/components/KpiCard";
import { TransactionsTable } from "@/components/TransactionsTable";
import { AlertTriangle, DollarSign } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/student/")({ component: StudentDash });

async function getToken() {
  return (await supabase.auth.getSession()).data.session?.access_token ?? null;
}

function StudentDash() {
  const { profile } = useAuth();
  const listTxFn = useServerFn(listStudentTransactions);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) { setLoading(false); return; }
    try {
      const res = await listTxFn({ data: { accessToken: token } });
      setTransactions((res.transactions as TxRow[]).map(dbTxToMock));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [listTxFn]);

  useEffect(() => { load(); }, [load]);

  const flagged = transactions.filter((t) => t.isFlagged);
  const sum     = flagged.reduce((s, t) => s + t.amount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hi, ${profile?.name?.split(" ")[0] ?? "Student"}`}
        description="Here's a summary of your flagged activity."
      />
      <div className="grid sm:grid-cols-2 gap-4">
        <KpiCard label="Flagged Transactions" value={loading ? "…" : flagged.length}              tone="danger" icon={<AlertTriangle className="h-4 w-4" />} />
        <KpiCard label="Flagged Amount"        value={loading ? "…" : `$${sum.toFixed(2)}`}       tone="danger" icon={<DollarSign className="h-4 w-4" />} />
      </div>
      {loading
        ? <p className="text-sm text-muted-foreground">Loading…</p>
        : <TransactionsTable transactions={transactions} />}
    </div>
  );
}
