import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { adminListSmsLogs, type SmsLogRow } from "@/lib/transactions-server";
import { PageHeader } from "@/components/AppShell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/sms")({ component: AdminSms });

async function getToken() {
  return (await supabase.auth.getSession()).data.session?.access_token ?? null;
}

function statusVariant(status: string) {
  if (status === "delivered") return "bg-success/10 text-success border border-success/20";
  if (status === "failed")    return "bg-destructive/10 text-destructive border border-destructive/20";
  return "bg-warning/15 text-warning-foreground border border-warning/30";
}

function AdminSms() {
  const listFn = useServerFn(adminListSmsLogs);
  const [logs, setLogs]     = useState<SmsLogRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) { setLoading(false); return; }
    try {
      const res = await listFn({ data: { accessToken: token } });
      setLogs(res.logs);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [listFn]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader title="SMS logs" description="All Twilio messages dispatched by Buffr." />
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Phone</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Sent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-10">
                    No SMS alerts sent yet.
                  </TableCell>
                </TableRow>
              )}
              {logs.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.phone}</TableCell>
                  <TableCell className="text-muted-foreground max-w-md truncate">{s.message}</TableCell>
                  <TableCell>
                    <Badge className={statusVariant(s.status)}>{s.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(s.created_at).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
