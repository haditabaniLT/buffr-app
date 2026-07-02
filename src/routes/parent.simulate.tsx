/**
 * Transaction Simulation — lets a parent fire test Plaid transactions
 * against a linked sandbox account and verify the full flagging + SMS flow.
 *
 * Two modes:
 *  "Sync (direct)"   → syncTransactionsManually — pulls existing Plaid history,
 *                      flags merchants, sends SMS. Works without edge function.
 *  "Fire webhook"    → fireSandboxWebhook — triggers SYNC_UPDATES_AVAILABLE
 *                      which Plaid sends to the edge function. Requires
 *                      transaction-webhook edge function to be deployed.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import {
  listParentBankAccounts,
  fireSandboxWebhook,
  syncTransactionsManually,
  createSandboxTransactions,
  injectAndFireWebhook,
  type BankAccountRow,
} from "@/lib/plaid-server";
import { PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, FlaskConical, RefreshCw, Zap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/parent/simulate")({ component: SimulatePage });

async function getToken() {
  return (await supabase.auth.getSession()).data.session?.access_token ?? null;
}

/** Safely extract a readable string from any thrown value (TanStack Start wraps errors as objects). */
function errMsg(e: unknown, fallback = "Something went wrong."): string {
  if (!e) return fallback;
  if (typeof e === "string") return e || fallback;
  if (e instanceof Error) return e.message || fallback;
  if (typeof e === "object") {
    const o = e as Record<string, any>;
    if (typeof o.message === "string" && o.message) return o.message;
    // TanStack Start may nest the server Error inside a data property
    if (o.data && typeof o.data.message === "string") return o.data.message;
    if (o.cause && typeof (o.cause as any).message === "string") return (o.cause as any).message;
    if (o.message && typeof o.message === "object") {
      const inner = o.message as Record<string, any>;
      if (typeof inner.message === "string") return inner.message;
      try { return JSON.stringify(inner); } catch { /* ignore */ }
    }
    try { return JSON.stringify(o); } catch { /* ignore */ }
  }
  return String(e) || fallback;
}

type Result = {
  mode: string;
  checked?: number;   // transactions seen from Plaid
  flagged?: number;   // transactions stored (all stored = flagged)
  webhookFired?: boolean;
  injected?: number;
  error?: string;
  rawError?: string;
};

function SimulatePage() {
  const { session } = useAuth();

  const listAccountsFn      = useServerFn(listParentBankAccounts);
  const fireWebhookFn       = useServerFn(fireSandboxWebhook);
  const syncDirectlyFn      = useServerFn(syncTransactionsManually);
  const createTxnFn         = useServerFn(createSandboxTransactions);
  const injectAndFireFn     = useServerFn(injectAndFireWebhook);

  const [accounts,     setAccounts]     = useState<BankAccountRow[]>([]);
  const [accountId,    setAccountId]    = useState("");   // bank_accounts.id (UUID)
  const [loading,      setLoading]      = useState(true);
  const [running,      setRunning]      = useState(false);
  const [result,       setResult]       = useState<Result | null>(null);

  // Custom transaction fields (for create_transactions mode)
  const [merchant, setMerchant] = useState("DraftKings");
  const [amount,   setAmount]   = useState("50.00");

  const loadAccounts = useCallback(async () => {
    const token = await getToken();
    if (!token) { setLoading(false); return; }
    try {
      const res = await listAccountsFn({ data: { accessToken: token } });
      setAccounts(res.accounts);
      if (res.accounts.length) setAccountId(res.accounts[0].id);
    } catch (e: unknown) {
      toast.error(errMsg(e, "Failed to load accounts."));
    } finally { setLoading(false); }
  }, [listAccountsFn]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  // Derive plaid_item_id from whichever account row is selected
  const selectedAccount = accounts.find((a) => a.id === accountId);
  const plaidItemId     = selectedAccount?.plaid_item_id ?? "";

  // ── Mode: Sync directly (pulls Plaid history, flags, SMS) ────────────────
  const runSyncDirect = async () => {
    const token = await getToken();
    if (!token || !plaidItemId) return;
    setRunning(true); setResult(null);
    try {
      const res = await syncDirectlyFn({ data: { accessToken: token, plaidItemId } });
      setResult({ mode: "Sync (direct)", ...res });
      toast.success(`Sync complete — ${res.checked} checked, ${res.flagged ?? 0} flagged`);
    } catch (e: unknown) {
      console.error("[simulate] sync error:", e);
      const msg = errMsg(e, "Sync failed.");
      let rawError = "";
      try { rawError = JSON.stringify(e, Object.getOwnPropertyNames(e as object)); } catch { rawError = String(e); }
      setResult({ mode: "Sync (direct)", error: msg, rawError });
      toast.error(msg);
    } finally { setRunning(false); }
  };

  // ── Mode: Fire webhook → edge fn picks it up ─────────────────────────────
  const runFireWebhook = async () => {
    const token = await getToken();
    if (!token || !plaidItemId) return;
    setRunning(true); setResult(null);
    try {
      const res = await fireWebhookFn({ data: { accessToken: token, plaidItemId } });
      setResult({ mode: "Fire webhook", webhookFired: res.webhook_fired });
      toast.success("Webhook fired — edge function will sync + flag shortly.");
    } catch (e: unknown) {
      console.error("[simulate] webhook error:", e);
      const msg = errMsg(e, "Webhook failed.");
      let rawError = "";
      try { rawError = JSON.stringify(e, Object.getOwnPropertyNames(e as object)); } catch { rawError = String(e); }
      setResult({ mode: "Fire webhook", error: msg, rawError });
      toast.error(msg);
    } finally { setRunning(false); }
  };

  // ── Mode: Inject custom transaction (user_transactions_dynamic only) ──────
  const runCreateTxn = async () => {
    const token = await getToken();
    if (!token || !plaidItemId) return;
    if (!merchant.trim()) { toast.error("Enter a merchant name."); return; }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { toast.error("Enter a valid amount."); return; }
    setRunning(true); setResult(null);
    try {
      const res = await createTxnFn({
        data: {
          accessToken: token,
          plaidItemId,
          transactions: [{ amount: amt, date: new Date().toISOString().split("T")[0], description: merchant.trim() }],
        },
      });
      setResult({ mode: "Create transaction", ...res });
      toast.success(`Injected & synced — ${res.flagged ?? 0} flagged`);
    } catch (e: unknown) {
      console.error("[simulate] create error:", e);
      const msg = errMsg(e, "Create failed.");
      let rawError = "";
      try { rawError = JSON.stringify(e, Object.getOwnPropertyNames(e as object)); } catch { rawError = String(e); }
      setResult({ mode: "Create transaction", error: msg, rawError });
      toast.error(msg);
    } finally { setRunning(false); }
  };


  // ── Mode D — Inject + fire webhook (full pipeline test) ──────────────────
  const runInjectAndFire = async () => {
    const token = await getToken();
    if (!token || !plaidItemId) return;
    if (!merchant.trim()) { toast.error("Enter a merchant name."); return; }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { toast.error("Enter a valid amount."); return; }
    setRunning(true); setResult(null);
    try {
      const res = await injectAndFireFn({
        data: { accessToken: token, plaidItemId, merchant: merchant.trim(), amount: amt },
      });
      setResult({ mode: "Full pipeline (inject + webhook)", injected: res.injected, webhookFired: res.webhook_fired });
      toast.success("Transaction injected & webhook fired — edge function will sync shortly.");
    } catch (e: unknown) {
      console.error("[simulate] inject+fire error:", e);
      const msg = errMsg(e, "Inject + fire failed.");
      let rawError = "";
      try { rawError = JSON.stringify(e, Object.getOwnPropertyNames(e as object)); } catch { rawError = String(e); }
      setResult({ mode: "Full pipeline (inject + webhook)", error: msg, rawError });
      toast.error(msg);
    } finally { setRunning(false); }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        title="Transaction Simulator"
        description="Test the full Plaid → flag → SMS pipeline using sandbox accounts."
      />

      {/* Account selector */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <Label>Select bank account</Label>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading accounts…</p>
          ) : accounts.length === 0 ? (
            <p className="text-sm text-destructive">
              No linked accounts. Go to <strong>Bank Accounts</strong> and connect a Plaid sandbox account first.
            </p>
          ) : (
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Select one account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    <span className="font-medium">
                      {a.institution_name ?? "Bank"}
                    </span>
                    <span className="text-muted-foreground">
                      {" "}— {a.account_name ?? "Account"}
                      {a.account_mask ? ` ••${a.account_mask}` : ""}
                      {a.account_type ? ` (${a.account_type})` : ""}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {selectedAccount && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground font-mono">
              <span>account id: {selectedAccount.id}</span>
              <span>item id: {selectedAccount.plaid_item_id}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mode A — Sync directly */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-start gap-3">
            <RefreshCw className="h-5 w-5 mt-0.5 text-primary shrink-0" />
            <div>
              <h3 className="font-semibold">Sync existing history (direct)</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Pulls all available transactions from Plaid via <code>/transactions/sync</code>,
                matches them against the flagged-merchant list, and sends SMS alerts.
                Works without the edge function deployed.
              </p>
            </div>
          </div>
          <Button onClick={runSyncDirect} disabled={running || !accountId || loading}>
            {running ? "Syncing…" : "Pull & flag transactions"}
          </Button>
        </CardContent>
      </Card>

      {/* Mode B — Fire webhook */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-start gap-3">
            <Zap className="h-5 w-5 mt-0.5 text-yellow-500 shrink-0" />
            <div>
              <h3 className="font-semibold">Fire sandbox webhook → edge function</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Calls <code>/sandbox/item/fire_webhook</code> with <code>SYNC_UPDATES_AVAILABLE</code>.
                Plaid sends the webhook to the deployed <code>transaction-webhook</code> edge function
                which syncs, flags and sends SMS. Requires the edge function to be deployed.
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={runFireWebhook} disabled={running || !accountId || loading}>
            {running ? "Firing…" : "Fire webhook"}
          </Button>
        </CardContent>
      </Card>

      {/* Mode C — Inject custom transaction */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 mt-0.5 text-destructive shrink-0" />
            <div>
              <h3 className="font-semibold">Inject custom transaction</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Injects a synthetic transaction dated <strong>today</strong> via{" "}
                <code>/sandbox/transactions/create</code>, then immediately syncs and flags it.{" "}
                <strong>Requires</strong> the account to be linked with username{" "}
                <code>user_transactions_dynamic</code> (password: any non-blank value).
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Merchant name</Label>
              <Input
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                placeholder="e.g. DraftKings"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Amount ($)</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>

          <div className="p-3 rounded-md bg-muted text-xs text-muted-foreground space-y-1">
            <p><strong>Flagged merchants (from your DB):</strong> DraftKings, FanDuel, BetMGM, Coinbase, Binance, MoneyMutual, CashNetUSA</p>
            <p>Use any of these names to trigger a flag + SMS alert.</p>
          </div>

          <Button variant="destructive" onClick={runCreateTxn} disabled={running || !accountId || loading}>
            {running ? "Injecting & syncing…" : "Inject & sync now"}
          </Button>
        </CardContent>
      </Card>

      {/* Mode D — Full pipeline test */}
      <Card className="border-primary/30">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-start gap-3">
            <FlaskConical className="h-5 w-5 mt-0.5 text-primary shrink-0" />
            <div>
              <h3 className="font-semibold">Full pipeline test <span className="text-xs font-normal text-primary ml-1">Recommended</span></h3>
              <p className="text-sm text-muted-foreground mt-1">
                Injects a transaction into Plaid sandbox, then fires{" "}
                <code>SYNC_UPDATES_AVAILABLE</code> to the <code>transaction-webhook</code> edge
                function. Tests the <strong>real production path</strong>: webhook → sync → flag → SMS.
                Requires the edge function deployed and Plaid webhook URL configured.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Merchant name</Label>
              <Input
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                placeholder="e.g. DraftKings"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Amount ($)</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>

          <Button onClick={runInjectAndFire} disabled={running || !accountId || loading}>
            {running ? "Injecting & firing…" : "Inject + fire webhook"}
          </Button>

          <p className="text-xs text-muted-foreground">
            After clicking, wait ~5 seconds then refresh Flagged Transactions. If nothing appears,
            check edge function logs in the Supabase dashboard.
          </p>
        </CardContent>
      </Card>

      {/* Result */}
      {result && (
        <Card className={result.error ? "border-destructive" : "border-success"}>
          <CardContent className="p-5 space-y-2">
            <div className="flex items-center gap-2">
              {result.error
                ? <AlertTriangle className="h-4 w-4 text-destructive" />
                : <CheckCircle2 className="h-4 w-4 text-success" />}
              <span className="font-medium">{result.mode} result</span>
            </div>
            {result.error ? (
              <div className="space-y-2">
                <p className="text-sm text-destructive font-medium">{result.error}</p>
                {result.rawError && (
                  <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-40 text-muted-foreground whitespace-pre-wrap break-all">
                    {result.rawError}
                  </pre>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 text-sm">
                {result.checked   != null && <Badge variant="outline">{result.checked} checked</Badge>}
                {result.injected  != null && <Badge variant="outline">{result.injected} injected</Badge>}
                {result.flagged   != null && (
                  <Badge className="bg-destructive/10 text-destructive border border-destructive/30">
                    {result.flagged} flagged &amp; stored
                  </Badge>
                )}
                {result.webhookFired && <Badge className="bg-success/10 text-success border border-success/30">Webhook fired ✓</Badge>}
              </div>
            )}
            {!result.error && result.mode !== "Fire webhook" && (
              <p className="text-xs text-muted-foreground pt-1">
                Check <strong>Flagged Transactions</strong> in the nav to see results.
                SMS logs are under Admin → SMS Logs.
              </p>
            )}
            {!result.error && (result.mode === "Fire webhook" || result.mode === "Full pipeline (inject + webhook)") && (
              <p className="text-xs text-muted-foreground pt-1">
                The edge function is processing. Refresh <strong>Flagged Transactions</strong> in ~5 seconds.
                If nothing appears, check edge function logs in the Supabase dashboard.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
