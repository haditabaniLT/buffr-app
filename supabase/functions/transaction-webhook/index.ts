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

/** Structured logger — every line is prefixed with [webhook] for easy log filtering. */
function log(level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) {
  const entry = data ? `[webhook] ${msg} ${JSON.stringify(data)}` : `[webhook] ${msg}`;
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.log(entry);
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
  log("info", "received request", { size_bytes: rawBody.length });

  // ── 2. Verify Plaid-Verification JWT ───────────────────────────────────────
  const verificationHeader = req.headers.get("plaid-verification");
  const verified = await verifyPlaidWebhook(rawBody, verificationHeader);

  if (!verified) {
    log("warn", "rejected — signature invalid or stale");
    return json({ error: "Unauthorized" }, 401);
  }
  log("info", "signature verified");

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
    log("error", "invalid JSON body");
    return json({ error: "Invalid JSON" }, 400);
  }

  const { webhook_type, webhook_code, item_id } = payload;

  log("info", "payload parsed", { webhook_type, webhook_code, item_id: item_id ?? null });

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
  if (logErr) {
    log("error", "plaid_webhook_events insert failed", { message: logErr.message });
  } else {
    log("info", "event persisted to plaid_webhook_events");
  }

  // ── 6. Handle TRANSACTIONS webhooks ───────────────────────────────────────
  const TRANSACTION_CODES = new Set([
    "SYNC_UPDATES_AVAILABLE",
    "DEFAULT_UPDATE",
    "INITIAL_UPDATE",
    "HISTORICAL_UPDATE",
  ]);

  let syncResult = null;

  if (webhook_type === "TRANSACTIONS" && item_id && TRANSACTION_CODES.has(webhook_code ?? "")) {
    log("info", "TRANSACTIONS webhook — starting sync pipeline");

    // Look up plaid_access_token + current cursor for this item
    const { data: account, error: lookupErr } = await supabase
      .from("bank_accounts")
      .select("plaid_access_token, transactions_sync_cursor")
      .eq("plaid_item_id", item_id)
      .limit(1)
      .maybeSingle();

    if (lookupErr) {
      log("error", "bank_accounts lookup failed", { message: lookupErr.message });
    } else if (!account?.plaid_access_token) {
      log("warn", "no bank_account found for item", { item_id });
    } else {
      const hasCursor = !!account.transactions_sync_cursor;
      log("info", "bank_account resolved", {
        item_id,
        cursor: hasCursor ? "existing" : "fresh (first sync)",
      });

      try {
        syncResult = await syncTransactions(
          supabase,
          account.plaid_access_token,
          item_id,
          account.transactions_sync_cursor ?? null,
        );

        log("info", "sync complete", {
          added:    syncResult.added,
          modified: syncResult.modified,
          removed:  syncResult.removed,
          new_ids:  syncResult.addedIds?.length ?? 0,
        });

        // Flag merchant matches + send SMS to parent for each new flagged txn
        if (syncResult.addedIds?.length) {
          log("info", "flagging pipeline starting", { candidates: syncResult.addedIds.length });
          const flagged = await flagAndNotify(supabase, syncResult.addedIds, item_id);
          log("info", "flagging pipeline complete", {
            candidates: syncResult.addedIds.length,
            flagged,
            cleaned: syncResult.addedIds.length - flagged,
          });
        } else {
          log("info", "no new transactions to flag");
        }
      } catch (err) {
        log("error", "sync pipeline threw", {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } else {
    log("info", "webhook type not handled — no action taken", { webhook_type, webhook_code });
  }

  return json({ ok: true, webhook_code, sync: syncResult });
});
