import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2, Plus, Trash2, User as UserIcon } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  createPlaidLinkToken,
  exchangePlaidPublicToken,
  listParentBankAccounts,
  assignBankAccountOwner,
  deleteBankAccount,
  type BankAccountRow,
} from "@/lib/plaid-server";
import { getParentChildren, type ParentChildRow } from "@/lib/children-server";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/parent/accounts")({ component: ParentAccounts });

async function getAccessToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function ConnectBankButton({ onLinked }: { onLinked: (justLinkedIds: string[]) => void }) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const createLinkTokenFn = useServerFn(createPlaidLinkToken);
  const exchangeFn = useServerFn(exchangePlaidPublicToken);

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
        data: {
          accessToken,
          publicToken,
          institutionName: metadata?.institution?.name,
        },
      });
      toast.success(`${result.accounts.length} account(s) linked from ${metadata?.institution?.name ?? "your bank"}.`);
      setLinkToken(null);
      onLinked(result.accounts.map((a: any) => a.id));
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to save linked accounts.");
    }
  }, [exchangeFn, onLinked]);

  const { open, ready } = usePlaidLink({
    token: linkToken ?? "",
    onSuccess,
  });

  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  return (
    <Button onClick={fetchLinkToken} disabled={loading}>
      <Plus className="h-4 w-4 mr-1" /> {loading ? "Loading…" : "Connect bank"}
    </Button>
  );
}

function ParentAccounts() {
  const { user } = useAuth();
  const listFn = useServerFn(listParentBankAccounts);
  const childrenFn = useServerFn(getParentChildren);
  const assignFn = useServerFn(assignBankAccountOwner);
  const deleteFn = useServerFn(deleteBankAccount);

  const [accounts, setAccounts] = useState<BankAccountRow[]>([]);
  const [children, setChildren] = useState<ParentChildRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [pendingAssignIds, setPendingAssignIds] = useState<string[]>([]);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<string>("self");

  const [deleteId, setDeleteId] = useState<string | null>(null);

  const linkedChildren = children.filter((c) => c.type === "child" && c.status === "linked");

  const refresh = useCallback(async () => {
    const accessToken = await getAccessToken();
    if (!accessToken) return;
    setLoading(true);
    try {
      const [a, c] = await Promise.all([
        listFn({ data: { accessToken } }),
        childrenFn({ data: { accessToken } }),
      ]);
      setAccounts(a.accounts);
      setChildren(c.children);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to load accounts.");
    } finally {
      setLoading(false);
    }
  }, [listFn, childrenFn]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleLinked = (ids: string[]) => {
    refresh().then(() => {
      if (ids.length > 0) {
        setPendingAssignIds(ids);
        setAssignTarget("self");
        setAssignDialogOpen(true);
      }
    });
  };

  const confirmAssign = async () => {
    if (!user) return;
    const ownerId = assignTarget === "self" ? user.id : assignTarget;
    const accessToken = await getAccessToken();
    if (!accessToken) return;
    try {
      await Promise.all(
        pendingAssignIds.map((id) =>
          assignFn({ data: { accessToken, accountId: id, ownerUserId: ownerId } })
        )
      );
      toast.success(assignTarget === "self" ? "Kept on your account." : "Linked to selected child.");
      setAssignDialogOpen(false);
      setPendingAssignIds([]);
      refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to assign account.");
    }
  };

  const skipAssign = () => {
    setAssignDialogOpen(false);
    setPendingAssignIds([]);
  };

  const changeOwner = async (accountId: string, ownerUserId: string) => {
    const accessToken = await getAccessToken();
    if (!accessToken) return;
    try {
      await assignFn({ data: { accessToken, accountId, ownerUserId } });
      toast.success("Account owner updated.");
      refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to update owner.");
    }
  };

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
        description="Securely connect bank accounts via Plaid and assign them to yourself or your children."
        actions={<ConnectBankButton onLinked={handleLinked} />}
      />

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
                <div className="text-xs text-success font-medium">Active</div>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t">
                <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Owner:</span>
                <Select
                  value={a.owner_user_id === user?.id ? "self" : a.owner_user_id}
                  onValueChange={(v) => changeOwner(a.id, v === "self" ? user!.id : v)}
                >
                  <SelectTrigger className="h-7 text-xs flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="self">Me (parent)</SelectItem>
                    {linkedChildren.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                  onClick={() => setDeleteId(a.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {!loading && accounts.length === 0 && (
          <p className="text-sm text-muted-foreground">No bank accounts linked yet. Click "Connect bank" to get started.</p>
        )}
      </div>

      {/* Post-link "assign to child or skip" dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={(o) => !o && skipAssign()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link this bank to a child?</DialogTitle>
            <DialogDescription>
              You just connected {pendingAssignIds.length} account(s). You can keep them on your own account or assign them to one of your children.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label className="text-sm font-medium">Assign to</label>
            <Select value={assignTarget} onValueChange={setAssignTarget}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="self">Keep on my account</SelectItem>
                {linkedChildren.length === 0 && (
                  <SelectItem value="none" disabled>No linked children yet</SelectItem>
                )}
                {linkedChildren.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name} ({c.email})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={skipAssign}>Skip</Button>
            <Button onClick={confirmAssign}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this bank account?</AlertDialogTitle>
            <AlertDialogDescription>
              This unlinks the account from Buffr. You can reconnect it later from Plaid.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
