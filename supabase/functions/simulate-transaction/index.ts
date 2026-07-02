/**
 * Supabase Edge Function: simulate-transaction
 *
 * Sandbox-only helper called from the Buffr UI to:
 *   POST /fire-webhook   — fire a SYNC_UPDATES_AVAILABLE webhook for an item
 *   POST /create         — inject synthetic transactions via /sandbox/transactions/create
 *
 * The caller sends the Supabase user JWT (Authorization: Bearer <token>)
 * so we can verify they own the item before acting.
 *
 * Deploy:
 *   supabase functions deploy simulate-transaction
 *
 * Usage (from plaid-server.ts):
 *   POST https://{ref}.supabase.co/functions/v1/simulate-transaction
 *   Headers: Authorization: Bearer <supabase-access-token>
 *   Body: { action: "fire_webhook" | "create_transactions", item_id, transactions? }
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { plaidPost, plaidCreds } from "../_shared/plaid.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // ── Auth: verify caller is a parent/admin ──────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing Authorization header" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: {
    action?: string;
    item_id?: string;
    webhook_code?: string;
    transactions?: Array<{
      amount: number;
      date: string;         // YYYY-MM-DD
      description: string;
    }>;
  } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { action, item_id } = body;
  if (!action || !item_id) return json({ error: "action and item_id required" }, 400);

  // ── Verify caller owns the item ────────────────────────────────────────────
  const { data: account, error: accountErr } = await supabase
    .from("bank_accounts")
    .select("id, plaid_access_token, linked_by_parent_id")
    .eq("plaid_item_id", item_id)
    .eq("linked_by_parent_id", user.id)   // parent must own it
    .maybeSingle();

  if (accountErr) return json({ error: accountErr.message }, 500);
  if (!account) return json({ error: "Account not found or access denied" }, 404);

  const creds = plaidCreds();

  // ── Action: fire_webhook ───────────────────────────────────────────────────
  if (action === "fire_webhook") {
    const webhookCode = body.webhook_code ?? "SYNC_UPDATES_AVAILABLE";
    const result = await plaidPost<{ webhook_fired: boolean; request_id: string }>(
      "/sandbox/item/fire_webhook",
      {
        ...creds,
        access_token: account.plaid_access_token,
        webhook_type: "TRANSACTIONS",
        webhook_code: webhookCode,
      },
    );
    console.log(`Fired webhook ${webhookCode} for item ${item_id}:`, result);
    return json({ ok: true, ...result, webhook_code: webhookCode });
  }

  // ── Action: create_transactions ────────────────────────────────────────────
  if (action === "create_transactions") {
    const rawTxns = body.transactions ?? [];
    if (!rawTxns.length) return json({ error: "Provide at least one transaction" }, 400);
    if (rawTxns.length > 10) return json({ error: "Max 10 transactions per request" }, 400);

    // Plaid sandbox /transactions/create only works for items created with
    // the user_transactions_dynamic test username.
    const transactions = rawTxns.map((t) => ({
      amount: t.amount,
      date_transacted: t.date,
      date_posted: t.date,
      description: t.description,
      iso_currency_code: "USD",
    }));

    const result = await plaidPost<{ request_id: string }>(
      "/sandbox/transactions/create",
      { ...creds, access_token: account.plaid_access_token, transactions },
    );

    // After injecting transactions Plaid fires webhooks automatically,
    // but we also fire one explicitly to be sure.
    try {
      await plaidPost("/sandbox/item/fire_webhook", {
        ...creds,
        access_token: account.plaid_access_token,
        webhook_type: "TRANSACTIONS",
        webhook_code: "SYNC_UPDATES_AVAILABLE",
      });
    } catch (e) {
      console.warn("fire_webhook after create_transactions failed:", e);
    }

    return json({ ok: true, ...result, injected: rawTxns.length });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
});
