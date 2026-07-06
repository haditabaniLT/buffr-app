import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { usePlaidLink } from "react-plaid-link";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { createParentChild, getParentChildren, type ParentChildRow } from "@/lib/children-server";
import {
  createPlaidLinkToken,
  exchangePlaidPublicToken,
  assignBankAccountOwner,
} from "@/lib/plaid-server";
import { listParentTransactions, type TxRow } from "@/lib/transactions-server";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Building2, Plus, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

async function getAccessToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export const Route = createFileRoute("/parent/child")({ component: ParentChild });

function calcAge(dob: string): number {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return 0;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

function ParentChild() {
  const { currentUser } = useStore();
  const { session } = useAuth();
  const getParentChildrenFn   = useServerFn(getParentChildren);
  const createParentChildFn   = useServerFn(createParentChild);
  const createLinkTokenFn     = useServerFn(createPlaidLinkToken);
  const exchangeFn            = useServerFn(exchangePlaidPublicToken);
  const assignFn              = useServerFn(assignBankAccountOwner);
  const listTransactionsFn    = useServerFn(listParentTransactions);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"form" | "invited" | "connect" | "done">("form");
  const [children, setChildren] = useState<ParentChildRow[]>([]);
  const [txRows, setTxRows] = useState<TxRow[]>([]);
  const [loadingChildren, setLoadingChildren] = useState(true);
  const [childrenError, setChildrenError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [dob, setDob] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const [pendingChildId, setPendingChildId] = useState<string | null>(null);

  // ── Plaid link state (for "link bank now" in the connect step) ──────────────
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [fetchingToken, setFetchingToken] = useState(false);

  const onPlaidSuccess = useCallback(async (publicToken: string, metadata: any) => {
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) { toast.error("Please sign in again."); return; }
      const result = await exchangeFn({
        data: { accessToken, publicToken, institutionName: metadata?.institution?.name },
      });
      // Auto-assign every new account to the child
      if (pendingChildId && result.accounts.length > 0) {
        await Promise.all(
          result.accounts.map((a: any) =>
            assignFn({ data: { accessToken, accountId: a.id, ownerUserId: pendingChildId } })
          )
        );
      }
      toast.success(`${result.accounts.length} account(s) linked to ${name}.`);
      setLinkToken(null);
      await loadChildren();
      setStep("done");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to link bank account.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exchangeFn, assignFn, pendingChildId, name]);

  const { open: openPlaid, ready: plaidReady } = usePlaidLink({
    token: linkToken ?? "",
    onSuccess: onPlaidSuccess,
  });

  // Open Plaid as soon as the token arrives
  useEffect(() => {
    if (linkToken && plaidReady) openPlaid();
  }, [linkToken, plaidReady, openPlaid]);

  const handleLinkNow = async () => {
    setFetchingToken(true);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) { toast.error("Please sign in again."); return; }
      const result = await createLinkTokenFn({ data: { accessToken } });
      setLinkToken(result.link_token);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to start bank linking.");
    } finally {
      setFetchingToken(false);
    }
  };

  const loadChildren = async () => {
    const accessToken = session?.access_token;
    if (!accessToken) {
      setLoadingChildren(false);
      setChildrenError("Please sign in again to load linked children.");
      return;
    }
    setLoadingChildren(true);
    setChildrenError(null);
    try {
      const [childResult, txResult] = await Promise.all([
        getParentChildrenFn({ data: { accessToken } }),
        listTransactionsFn({ data: { accessToken } }).catch(() => ({ transactions: [] })),
      ]);
      setChildren(childResult.children as ParentChildRow[]);
      setTxRows((txResult.transactions as TxRow[]) ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load linked children.";
      setChildrenError(message);
    } finally {
      setLoadingChildren(false);
    }
  };

  useEffect(() => {
    void loadChildren();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token]);

  if (!currentUser) return null;

  const resetDialog = () => {
    setStep("form");
    setName(""); setEmail(""); setDob("");
    setInviteLink(""); setPendingChildId(null);
  };

  const handleSubmit = async () => {
    if (!name.trim() || !email.trim() || !dob) {
      toast.error("Please fill in all fields");
      return;
    }
    const accessToken = session?.access_token;
    if (!accessToken) { toast.error("You must be signed in"); return; }
    const age = calcAge(dob);
    if (age <= 0) { toast.error("Please enter a valid date of birth"); return; }

    setSubmitting(true);
    try {
      const result = await createParentChildFn({ data: { accessToken, name, email, dob } });
      await loadChildren();

      if (result.mode === "invitation") {
        const url = `${window.location.origin}/invite/${result.token}`;
        setInviteLink(url);
        setStep("invited");
        toast.success(`Invitation generated for ${email}`);
      } else {
        setPendingChildId(result.child.id);
        setStep("connect");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not add child.";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader title="Linked students" description="View and manage students linked to your account." />
        <Button onClick={() => { resetDialog(); setOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Add child
        </Button>
      </div>

      {childrenError && (
        <Card><CardContent className="p-4 flex items-center justify-between gap-3">
          <p className="text-sm text-destructive">{childrenError}</p>
          <Button variant="outline" size="sm" onClick={() => void loadChildren()}>Retry</Button>
        </CardContent></Card>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {loadingChildren && [0, 1].map((i) => (
          <Card key={i}><CardContent className="p-5 space-y-3">
            <div className="h-4 w-36 rounded bg-muted animate-pulse" />
            <div className="h-3 w-48 rounded bg-muted animate-pulse" />
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="h-10 rounded bg-muted animate-pulse" />
              <div className="h-10 rounded bg-muted animate-pulse" />
            </div>
          </CardContent></Card>
        ))}

        {!loadingChildren && children.map((c) => {
          const flaggedTx = txRows.filter((t) => t.owner_user_id === c.id && t.is_flagged);
          const flaggedCount = flaggedTx.length;
          const flaggedAmount = flaggedTx.reduce((sum, t) => sum + (t.amount ?? 0), 0);
          const statusLabel = c.status === "linked" ? "Linked" : c.status === "pending" ? "Invite pending" : c.status === "accepted" ? "Accepted" : "Expired";
          return (
            <Card key={c.id}><CardContent className="p-5 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">{c.email}</div>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-accent text-accent-foreground">{statusLabel}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2 text-sm">
                {c.type === "child" ? (
                  <>
                    <div><div className="text-muted-foreground text-xs">Flagged txns</div><div className="font-semibold text-destructive">{flaggedCount}</div></div>
                    <div><div className="text-muted-foreground text-xs">Flagged amount</div><div className="font-semibold text-destructive">${flaggedAmount.toFixed(2)}</div></div>
                  </>
                ) : (
                  <>
                    <div><div className="text-muted-foreground text-xs">Setup</div><div className="font-semibold">Waiting</div></div>
                    <div className="flex items-end justify-end">
                      {c.inviteToken && c.status === "pending" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}/invite/${c.inviteToken}`);
                            toast.success("Invite link copied");
                          }}
                        >Copy invite</Button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </CardContent></Card>
          );
        })}
        {!loadingChildren && children.length === 0 && <p className="text-sm text-muted-foreground">No students linked yet. Click "Add child" to get started.</p>}
      </div>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetDialog(); }}>
        <DialogContent className="sm:max-w-lg">
          {step === "form" && (
            <>
              <DialogHeader>
                <DialogTitle>Add a child</DialogTitle>
                <DialogDescription>
                  We'll use the date of birth to decide the setup flow. Students 18 or older
                  receive an email invitation to create their own login. For students under 18,
                  you'll link their account through your own.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor="child-name">Full name</Label>
                  <Input id="child-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jamie Mitchell" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="child-email">Email address</Label>
                  <Input id="child-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="student@example.com" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="child-dob">Date of birth</Label>
                  <Input id="child-dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={handleSubmit} disabled={submitting}>
                  {submitting ? "Saving..." : "Continue"}
                </Button>
              </DialogFooter>
            </>
          )}

          {step === "invited" && (
            <>
              <DialogHeader>
                <DialogTitle>Invitation ready</DialogTitle>
                <DialogDescription>
                  In production we'd email this link to <span className="font-medium text-foreground">{email}</span>.
                  For now you can copy it or open it directly. Once they accept and connect their bank via Plaid,
                  both dashboards will be linked.
                </DialogDescription>
              </DialogHeader>
              <div className="flex gap-2 py-2">
                <Input readOnly value={inviteLink} onFocus={(e) => e.currentTarget.select()} />
                <Button
                  variant="outline"
                  onClick={() => { navigator.clipboard.writeText(inviteLink); toast.success("Link copied"); }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={() => setOpen(false)}>Done</Button>
              </DialogFooter>
            </>
          )}

          {step === "connect" && (
            <>
              <DialogHeader>
                <DialogTitle>Would you like to link a bank account?</DialogTitle>
                <DialogDescription>
                  <strong>{name}</strong>'s account is ready. You can connect a bank account on their
                  behalf right now, or come back to it later from{" "}
                  <strong>Bank Accounts</strong>.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => setStep("done")}>
                  Later
                </Button>
                <Button onClick={handleLinkNow} disabled={fetchingToken}>
                  {fetchingToken
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Opening Plaid…</>
                    : "Link bank now"}
                </Button>
              </DialogFooter>
            </>
          )}

          {step === "done" && (
            <>
              <DialogHeader>
                <DialogTitle>Child added</DialogTitle>
                <DialogDescription>
                  {name} is now linked to your account. We'll start monitoring transactions
                  and notify you of any flagged activity.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button onClick={() => setOpen(false)}>Done</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
