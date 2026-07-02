import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listStudentTransactions, type TxRow } from "@/lib/transactions-server";
import { dbTxToMock, type Transaction } from "@/lib/mock-data";
import { PageHeader } from "@/components/AppShell";
import { TransactionsTable } from "@/components/TransactionsTable";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/student/transactions")({ component: StudentTx });

async function getToken() {
  return (await supabase.auth.getSession()).data.session?.access_token ?? null;
}

function StudentTx() {
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

  return (
    <div className="space-y-6">
      <PageHeader title="My Transactions" description="All transactions on your linked account." />
      {loading
        ? <p className="text-sm text-muted-foreground">Loading…</p>
        : <TransactionsTable transactions={transactions} />}
    </div>
  );
}
