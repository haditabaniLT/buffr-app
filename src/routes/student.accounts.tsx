import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Building2, Plus, Trash2, Info } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  createPlaidLinkTokenForStudent,
  exchangePlaidPublicTokenForStudent,
  listStudentBankAccounts,
  deleteStudentBankAccount,
  type BankAccountRow,
} from "@/lib/plaid-server";

export const Route = createFileRoute("/student/accounts")({ component: StudentAccounts });

async function getAccessToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

// Reuses the same Plaid Link pattern as the parent ConnectBankButton,
// just wired to the student-scoped server functions.
function ConnectBankButton({ onLinked }: { onLinked: () => void }) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const createLinkTokenFn = useServerFn(createPlaidLinkTokenForStudent);
  const exchangeFn = useServerFn(exchangePlaidPublicTokenForStudent);

  const fetchLinkToken = async () => {
    setLoading(true);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) { toast.error("Please sign in again."); return; }
      const result = await createLinkTokenFn({ data: { accessToken } });
      setLinkToken(result.link_token);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to start bank linking.");
    } finally {
      setLoading(false);
    }
  };

  const onSuccess = useCallback(async (publicToken: string, metadata: any) => {
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) { toast.error("Please sign in again."); return; }
      const result = await exchangeFn({
        data: { accessToken, publicToken, institutionName: metadata?.institution?.name },
      });
      toast.success(`${result.accounts.length} account(s) linked from ${metadata?.institution?.name ?? "your bank"}.`);
      setLinkToken(null);
      onLinked();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to save linked accounts.");
    }
  }, [exchangeFn, onLinked]);

  const { open, ready } = usePlaidLink({ token: linkToken ?? "", onSuccess });

  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  return (
    <Button onClick={fetchLinkToken} disabled={loading}>
      <Plus className="h-4 w-4 mr-1" /> {loading ? "Loading…" : "Connect bank"}
    </Button>
  );
}

function StudentAccounts() {
  const listFn = useServerFn(listStudentBankAccounts);
  const deleteFn = useServerFn(deleteStudentBankAccount);

  const [accounts, setAccounts] = useState<BankAccountRow[]>([]);
  const [isMinor, setIsMinor] = useState(true); // default true — safe until confirmed otherwise
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const accessToken = await getAccessToken();
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await listFn({ data: { accessToken } });
      setAccounts(res.accounts);
      setIsMinor(res.isMinor);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to load accounts.");
    } finally {
      setLoading(false);
    }
  }, [listFn]);

  useEffect(() => { refresh(); }, [refresh]);

  const confirmDelete = async () => {
    if (!deleteId) return;
    const accessToken = await getAccessToken();
    if (!accessToken) return;
    try {
      await deleteFn({ data: { accessToken, accountId: deleteId } });
      toast.success("Account removed.");
      setDeleteId(null);
      refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to remove account.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bank accounts"
        description={
          isMinor
            ? "Your linked bank accounts. Your parent manages account connections on your behalf."
            : "Connect your bank account via Plaid so Buffr can monitor your transactions."
        }
        actions={!isMinor ? <ConnectBankButton onLinked={refresh} /> : undefined}
      />

      {isMinor && (
        <div className="flex items-start gap-2 rounded-md border border-muted bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <p>Bank accounts are linked and managed by your parent or guardian. Contact them to add or change a connected account.</p>
        </div>
      )}

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="grid md:grid-cols-2 gap-4">
        {accounts.map((a) => (
          <Card key={a.id}>
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-md bg-accent text-accent-foreground grid place-items-center">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-medium">{a.institution_name ?? a.account_name ?? "Bank"}</div>
                    <div className="text-xs text-muted-foreground">
                      {a.account_name} {a.account_mask ? `•••• ${a.account_mask}` : ""}
                      {a.account_subtype ? ` • ${a.account_subtype}` : ""}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-xs text-success font-medium">Active</div>
                  {!isMinor && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      onClick={() => setDeleteId(a.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {!loading && accounts.length === 0 && (
          <p className="text-sm text-muted-foreground col-span-2">
            No bank accounts linked yet. Click "Connect bank" to get started.
          </p>
        )}
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this bank account?</AlertDialogTitle>
            <AlertDialogDescription>
              This unlinks the account from Buffr. You can reconnect it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
