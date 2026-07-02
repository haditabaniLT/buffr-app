/**
 * Supabase Edge Function: transaction-webhook
 *
 * Receives Plaid TRANSACTIONS webhooks, verifies the ES256 JWT signature,
 * then calls /transactions/sync to pull and persist new/modified/removed
 * transactions into public.transactions.
 *
 * Deploy:
 *   supabase functions deploy transaction-webhook --no-verify-jwt
 *
 * Plaid webhook URL to register:
 *   https://vvdzfrmyuaqwxdpndkvu.supabase.co/functions/v1/transaction-webhook
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  verifyPlaidWebhook,
  syncTransactions,
  flagAndNotify,
} from "../_shared/plaid.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Plaid-Verification",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // ── 1. Read raw body (must happen before any other await) ──────────────────
  const rawBody = await req.text();

  // ── 2. Verify Plaid-Verification JWT ───────────────────────────────────────
  const verificationHeader = req.headers.get("plaid-verification");
  const verified = await verifyPlaidWebhook(rawBody, verificationHeader);

  if (!verified) {
    console.warn("Rejected webhook — signature invalid or stale");
    return json({ error: "Unauthorized" }, 401);
  }

  // ── 3. Parse payload ───────────────────────────────────────────────────────
  let payload: {
    webhook_type?: string;
    webhook_code?: string;
    item_id?: string;
    error?: unknown;
  } = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { webhook_type, webhook_code, item_id } = payload;

  console.log(`Plaid webhook: ${webhook_type}/${webhook_code} item=${item_id}`);

  // ── 4. Supabase client (service role — bypasses RLS) ──────────────────────
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── 5. Persist raw event ──────────────────────────────────────────────────
  const { error: logErr } = await supabase.from("plaid_webhook_events").insert({
    payload: rawBody,
    plaid_item_id: item_id ?? null,
  });
  if (logErr) console.error("plaid_webhook_events insert error:", logErr);

  // ── 6. Handle TRANSACTIONS webhooks ───────────────────────────────────────
  const TRANSACTION_CODES = new Set([
    "SYNC_UPDATES_AVAILABLE",
    "DEFAULT_UPDATE",
    "INITIAL_UPDATE",
    "HISTORICAL_UPDATE",
  ]);

  console.log("====rawBody====", rawBody)

  let syncResult = null;

  if (webhook_type === "TRANSACTIONS" && item_id && TRANSACTION_CODES.has(webhook_code ?? "")) {
    console.log(`if (webhook_type === "TRANSACTIONS" && item_id && TRANSACTION_CODES.has(webhook_code ?? "")) {`)
    console.log(`// Look up plaid_access_token + current cursor for this item`);
    // Look up plaid_access_token + current cursor for this item
    const { data: account, error: lookupErr } = await supabase
      .from("bank_accounts")
      .select("plaid_access_token, transactions_sync_cursor")
      .eq("plaid_item_id", item_id)
      .limit(1)
      .maybeSingle();

    if (lookupErr) {
      console.error("bank_accounts lookup error:", lookupErr);
    } else if (!account?.plaid_access_token) {
      console.warn(`No bank_account found for plaid_item_id: ${item_id}`);
    } else {
      try {
        syncResult = await syncTransactions(
          supabase,
          account.plaid_access_token,
          item_id,
          account.transactions_sync_cursor ?? null,
        );
        console.log("Sync complete:", syncResult);

        // Flag merchant matches + send SMS to parent for each new flagged txn
        if (syncResult.addedIds?.length) {
          const flagged = await flagAndNotify(supabase, syncResult.addedIds, item_id);
          console.log(`Flagged ${flagged} transaction(s)`);
        }
      } catch (err) {
        console.error("syncTransactions threw:", err);
      }
    }
  }

  return json({ ok: true, webhook_code, sync: syncResult });
});
