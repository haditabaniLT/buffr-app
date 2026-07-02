/**
 * Shared Plaid helpers for Supabase Edge Functions.
 * Handles:
 *  - plaidPost()            — authenticated Plaid API calls
 *  - verifyPlaidWebhook()   — ES256 JWT + body-hash verification
 *  - syncTransactions()     — /transactions/sync cursor loop → DB upsert
 *  - flagAndNotify()        — merchant matching + Twilio SMS to parent
 */

import { jwtVerify, importJWK } from "npm:jose@5";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sendSms } from "./twilio.ts";

// Switch to "https://production.plaid.com" for live
export const PLAID_BASE =
  Deno.env.get("PLAID_ENV") === "production"
    ? "https://production.plaid.com"
    : "https://sandbox.plaid.com";

export function plaidCreds() {
  const client_id = Deno.env.get("PLAID_CLIENT_ID");
  const secret = Deno.env.get("PLAID_SECRET");
  if (!client_id || !secret)
    throw new Error("PLAID_CLIENT_ID / PLAID_SECRET not set in edge-function secrets.");
  return { client_id, secret };
}

export async function plaidPost<T = unknown>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${PLAID_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`Plaid ${path} error:`, data);
    throw new Error(
      (data as { error_message?: string }).error_message ||
        `Plaid request failed (${res.status})`,
    );
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Webhook verification
// ---------------------------------------------------------------------------

/** In-memory JWK cache — keys rotate rarely, fine for an edge function instance. */
const jwkCache = new Map<string, CryptoKey>();

/** Fetch + cache the Plaid ECDSA public key for a given key-id. */
async function getVerificationKey(kid: string): Promise<CryptoKey> {
  if (jwkCache.has(kid)) return jwkCache.get(kid)!;
  const creds = plaidCreds();
  const data = await plaidPost<{ key: JsonWebKey }>(
    "/webhook_verification_key/get",
    { ...creds, key_id: kid },
  );
  const key = (await importJWK(data.key, "ES256")) as CryptoKey;
  jwkCache.set(kid, key);
  return key;
}

/**
 * Verify a Plaid webhook request:
 *  1. Decode JWT header → fetch ES256 public key by kid
 *  2. jwtVerify() the Plaid-Verification JWT
 *  3. Check iat freshness (≤ 5 minutes)
 *  4. SHA-256 the raw body and match request_body_sha256 claim
 *
 * Returns true only if ALL checks pass.
 */
export async function verifyPlaidWebhook(
  rawBody: string,
  verificationHeader: string | null,
): Promise<boolean> {
  if (!verificationHeader) {
    console.warn("Missing Plaid-Verification header");
    return false;
  }

  try {
    // Decode JWT header (without verification) to extract kid + alg
    const [headerB64] = verificationHeader.split(".");
    // base64url → base64
    const padded = headerB64.replace(/-/g, "+").replace(/_/g, "/");
    const header = JSON.parse(atob(padded)) as { alg?: string; kid?: string };

    if (header.alg !== "ES256") {
      console.warn("Unexpected Plaid webhook JWT algorithm:", header.alg);
      return false;
    }
    if (!header.kid) {
      console.warn("Missing kid in Plaid webhook JWT header");
      return false;
    }

    const key = await getVerificationKey(header.kid);

    // Verify signature + decode claims
    const { payload } = await jwtVerify(verificationHeader, key, {
      algorithms: ["ES256"],
    });

    // Freshness check — reject if older than 5 minutes
    const iat = payload.iat as number | undefined;
    if (!iat || Math.floor(Date.now() / 1000) - iat > 300) {
      console.warn("Plaid webhook JWT is stale (iat:", iat, ")");
      return false;
    }

    // Body-hash check
    const bodyBytes = new TextEncoder().encode(rawBody);
    const hashBuffer = await crypto.subtle.digest("SHA-256", bodyBytes);
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const claimedHash = (payload as Record<string, unknown>)
      .request_body_sha256 as string | undefined;
    if (!claimedHash || hashHex !== claimedHash) {
      console.warn("Plaid webhook body hash mismatch");
      return false;
    }

    return true;
  } catch (err) {
    console.error("Plaid webhook verification threw:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Transaction sync
// ---------------------------------------------------------------------------

export interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  amount: number;
  iso_currency_code: string | null;
  name: string | null;
  merchant_name: string | null;
  category: string[] | null;
  personal_finance_category?: { primary?: string } | null;
  date: string;
  pending: boolean;
}

export interface SyncResult {
  added: number;
  modified: number;
  removed: number;
  cursor: string;
}

/**
 * Drain the /transactions/sync cursor loop for one item, upsert results into
 * public.transactions, and persist the next_cursor back to bank_accounts.
 */
export async function syncTransactions(
  supabase: SupabaseClient,
  accessToken: string,
  itemId: string,
  cursor: string | null,
): Promise<SyncResult> {
  const creds = plaidCreds();

  let nextCursor: string = cursor ?? "";
  let hasMore = true;
  const allAdded: PlaidTransaction[] = [];
  const allModified: PlaidTransaction[] = [];
  const allRemovedIds: string[] = [];

  // Drain all pages
  while (hasMore) {
    const reqBody: Record<string, unknown> = {
      ...creds,
      access_token: accessToken,
    };
    if (nextCursor) reqBody.cursor = nextCursor;

    const page = await plaidPost<{
      added: PlaidTransaction[];
      modified: PlaidTransaction[];
      removed: Array<{ transaction_id: string }>;
      next_cursor: string;
      has_more: boolean;
    }>("/transactions/sync", reqBody);

    allAdded.push(...page.added);
    allModified.push(...page.modified);
    allRemovedIds.push(...page.removed.map((r) => r.transaction_id));
    nextCursor = page.next_cursor;
    hasMore = page.has_more;
  }

  // Resolve bank_account rows for this item (need id + owner)
  const { data: accounts } = await supabase
    .from("bank_accounts")
    .select("id, plaid_account_id, owner_user_id")
    .eq("plaid_item_id", itemId);

  const accountMap = new Map(
    (accounts ?? []).map((a: { plaid_account_id: string; id: string; owner_user_id: string }) => [
      a.plaid_account_id,
      a,
    ]),
  );

  // Build upsert rows
  const toUpsert = [...allAdded, ...allModified].map((txn) => {
    const acct = accountMap.get(txn.account_id);
    return {
      id: txn.transaction_id,
      account_id: txn.account_id,
      bank_account_id: acct?.id ?? null,
      owner_user_id: acct?.owner_user_id ?? null,
      amount: txn.amount,
      iso_currency_code: txn.iso_currency_code ?? "USD",
      name: txn.name ?? null,
      merchant_name: txn.merchant_name ?? null,
      category: txn.category ?? [],
      personal_finance_category:
        txn.personal_finance_category?.primary ?? null,
      date: txn.date,
      pending: txn.pending,
      plaid_item_id: itemId,
      raw_json: txn,
      updated_at: new Date().toISOString(),
    };
  });

  if (toUpsert.length > 0) {
    const { error } = await supabase
      .from("transactions")
      .upsert(toUpsert, { onConflict: "id" });
    if (error) console.error("transactions upsert error:", error);
  }

  // Hard-delete removed transaction IDs
  if (allRemovedIds.length > 0) {
    const { error } = await supabase
      .from("transactions")
      .delete()
      .in("id", allRemovedIds);
    if (error) console.error("transactions delete error:", error);
  }

  // Persist cursor so the next webhook resumes from here
  if (nextCursor) {
    await supabase
      .from("bank_accounts")
      .update({ transactions_sync_cursor: nextCursor })
      .eq("plaid_item_id", itemId);
  }

  return {
    added: allAdded.length,
    modified: allModified.length,
    removed: allRemovedIds.length,
    cursor: nextCursor,
    addedIds: allAdded.map((t) => t.transaction_id),
  };
}

// ---------------------------------------------------------------------------
// Flagging + SMS notification
// ---------------------------------------------------------------------------

interface MerchantRow {
  name: string;
  category: string;
  risk_level: string;
}

// ---------------------------------------------------------------------------
// OpenAI fraud detection helpers (Deno / edge-function flavour)
// ---------------------------------------------------------------------------

interface AIFraudResult {
  is_fraud: boolean;
  risk_level: "high" | "medium" | "low";
  category: string;
  reason: string;
  merchant_name: string;
}

const AI_SYSTEM_PROMPT = `You are a fraud-detection assistant for Buffr, a parental financial monitoring app that watches a teenager's spending.

Your job: decide whether a transaction is from a HIGH-RISK or FRAUDULENT merchant that a parent should be alerted about.

FLAG these categories (is_fraud = true):
- Gambling / sports betting (DraftKings, FanDuel, BetMGM, casinos, poker sites)
- Cryptocurrency exchanges or NFT platforms (Coinbase, Binance, OpenSea, Kraken)
- Payday loan / cash-advance services
- Adult content / explicit material platforms
- Adult Places and Shops / Like strip clubs, sex shops, etc.
- MLM (multi-level marketing) recruitment purchases
- Dark web / anonymisation tools (Tor-related purchases, anonymous prepaid card services)
- Vaping / tobacco products sold to minors
- Excessive gaming microtransactions or loot-box platforms clearly targeting minors
- Suspicious peer-to-peer marketplaces with no buyer protection

Do NOT flag these (is_fraud = false):
- Grocery stores, supermarkets, convenience stores
- Restaurants, fast food, cafes, coffee shops
- Streaming services (Netflix, Spotify, Hulu, Disney+, YouTube Premium)
- Major retailers (Amazon, Walmart, Target, Best Buy, Apple Store)
- Ride-sharing (Uber, Lyft)
- Healthcare, pharmacies, dentists
- Educational platforms (Coursera, Udemy, Khan Academy, school fees)
- Transportation (bus, subway, airline tickets)
- Utilities and phone carriers
- Standard video game storefronts (Steam, PlayStation Store, Xbox, Nintendo eShop) — flag only if clear loot-box abuse

When uncertain, lean toward NOT flagging (is_fraud = false).

Respond ONLY with valid JSON matching this exact shape:
{
  "is_fraud": true | false,
  "risk_level": "high" | "medium" | "low",
  "category": "<one of: gambling, crypto, payday_loan, adult_content, mlm, dark_web, tobacco_minor, gaming_lootbox, suspicious_marketplace, other_risk, safe>",
  "reason": "<one concise sentence explaining the decision>",
  "merchant_name": "<normalized merchant name, title-case>"
}`;

async function analyzeTransactionWithAI(txn: {
  name: string | null;
  merchant_name: string | null;
  amount: number;
  category?: string[] | null;
  personal_finance_category?: string | null;
}): Promise<AIFraudResult | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    console.warn("[ai] OPENAI_API_KEY not set — skipping AI check.");
    return null;
  }

  const userContent = `Transaction details:
- Merchant name: ${txn.merchant_name || "(none)"}
- Transaction name: ${txn.name || "(none)"}
- Amount: $${Math.abs(txn.amount).toFixed(2)}
- Plaid category: ${(txn.category ?? []).join(", ") || "(none)"}
- Personal finance category: ${txn.personal_finance_category || "(none)"}`;

console.log("====USER TRANSACTION DATA======", JSON.stringify(userContent,null,1))


  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-5",
        temperature: 1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: AI_SYSTEM_PROMPT },
          { role: "user",   content: userContent },
        ],
      }),
    });

    if (!res.ok) {
      console.error("[ai] OpenAI API error:", await res.text());
      return null;
    }

    const json: any = await res.json();
    console.log("[API LOG]", JSON.stringify(json,null,1))

    const raw = json?.choices?.[0]?.message?.content;
    if (!raw) return null;
    return JSON.parse(raw) as AIFraudResult;
  } catch (err) {
    console.error("[ai] analyzeTransactionWithAI threw:", err);
    return null;
  }
}

const VALID_FLAG_CATEGORIES = new Set([
  "gambling", "payday_loan", "crypto", "high_risk",
  "adult_content", "mlm", "dark_web", "tobacco_minor",
  "gaming_lootbox", "suspicious_marketplace", "other_risk",
]);

function safeCategory(cat: string): string {
  return VALID_FLAG_CATEGORIES.has(cat) ? cat : "high_risk";
}

async function addDetectedMerchant(
  supabase: SupabaseClient,
  name: string,
  category: string,
  riskLevel: "high" | "medium" | "low",
): Promise<void> {
  const { error } = await supabase.from("merchants").upsert(
    { name, category, risk_level: riskLevel },
    { onConflict: "name", ignoreDuplicates: true },
  );
  if (error) console.error("[ai] addDetectedMerchant error:", error.message);
  else console.log(`[ai] merchant added/already present: ${name} (${category})`);
}

/**
 * For each newly added/modified transaction ID:
 *  1. Match merchant name against the flagged merchants table (case-insensitive substring)
 *  2. Mark matched rows as is_flagged in DB
 *  3. Send one Twilio SMS to the parent for each newly flagged transaction
 *  4. Insert a row in sms_logs
 *
 * Returns the number of transactions flagged.
 */
export async function flagAndNotify(
  supabase: SupabaseClient,
  txnIds: string[],
  plaidItemId: string,
): Promise<number> {
  if (!txnIds.length) return 0;

  // Load transactions + merchants in parallel
  const [txnRes, merchantRes, accountRes] = await Promise.all([
    supabase
      .from("transactions")
      .select("id, name, merchant_name, amount, owner_user_id, category, personal_finance_category")
      .in("id", txnIds)
      .eq("is_flagged", false),           // only re-check unflagged rows
    supabase
      .from("merchants")
      .select("name, category, risk_level"),
    supabase
      .from("bank_accounts")
      .select("linked_by_parent_id")
      .eq("plaid_item_id", plaidItemId)
      .limit(1)
      .maybeSingle(),
  ]);

  const txns      = (txnRes.data    ?? []) as Array<{ id: string; name: string | null; merchant_name: string | null; amount: number; owner_user_id: string | null; category: string[] | null; personal_finance_category: string | null }>;
  const merchants = (merchantRes.data ?? []) as MerchantRow[];
  const parentId  = (accountRes.data as { linked_by_parent_id: string } | null)?.linked_by_parent_id ?? null;

  if (!txns.length) return 0;

  // Look up parent phone once (only needed if there are flagged transactions)
  let parentPhone: string | null = null;
  let parentDbId: string | null  = parentId;

  const newlyFlagged: Array<{ id: string; name: string; amount: number; reason: string }> = [];
  // Track which IDs were processed (matched or AI-flagged) so we can delete the rest
  const processedIds = new Set<string>();

  for (const txn of txns) {
    const search = (txn.merchant_name || txn.name || "").toLowerCase().trim();
    if (!search) continue;

    let flagReason: string;
    let flagCategory: string;

    // 1. Try rule-based merchant-list match first
    const match = merchants.find(
      (m) =>
        search.includes(m.name.toLowerCase()) ||
        m.name.toLowerCase().includes(search),
    );

    if (match) {
      flagReason   = `${match.category.replace(/_/g, " ")} – ${match.name}`;
      flagCategory = match.category;
    } else {
      // 2. Fall back to AI analysis
      const ai = await analyzeTransactionWithAI({
        name:                    txn.name,
        merchant_name:           txn.merchant_name,
        amount:                  txn.amount,
        category:                txn.category,
        personal_finance_category: txn.personal_finance_category,
      });

      if (!ai || !ai.is_fraud) continue; // AI says safe (or unreachable) — will be deleted below

      const safeCat = safeCategory(ai.category);
      flagReason   = `${safeCat.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())} – ${ai.risk_level.charAt(0).toUpperCase() + ai.risk_level.slice(1)} Risk`;
      flagCategory = safeCat;

      // Persist merchant so future rule-based checks catch it
      await addDetectedMerchant(
        supabase,
        ai.merchant_name || (txn.merchant_name ?? txn.name ?? "Unknown"),
        safeCat,
        ai.risk_level,
      );
    }

    const { error } = await supabase
      .from("transactions")
      .update({
        is_flagged:    true,
        flag_reason:   flagReason,
        flag_category: flagCategory,
      })
      .eq("id", txn.id);

    if (error) {
      console.error("flag update error:", error);
      continue;
    }

    processedIds.add(txn.id);
    newlyFlagged.push({
      id:     txn.id,
      name:   txn.merchant_name || txn.name || "Unknown merchant",
      amount: txn.amount,
      reason: flagReason,
    });
  }

  // Remove transactions that matched neither the merchant list nor AI — keep DB clean.
  const unflaggedIds = txns
    .filter((t) => !processedIds.has(t.id) && (t.merchant_name || t.name)) // skip empty-search rows already skipped above
    .map((t) => t.id);
  if (unflaggedIds.length > 0) {
    const { error: delErr } = await supabase
      .from("transactions")
      .delete()
      .in("id", unflaggedIds);
    if (delErr) console.error("flagAndNotify: cleanup delete error:", delErr);
  }

  if (!newlyFlagged.length || !parentDbId) return newlyFlagged.length;

  // Fetch parent phone (only once)
  const { data: parent } = await supabase
    .from("users")
    .select("phone")
    .eq("id", parentDbId)
    .maybeSingle();
  parentPhone = (parent as { phone?: string | null } | null)?.phone ?? null;

  // Send SMS + log for each flagged transaction
  for (const txn of newlyFlagged) {
    const msg =
      `Buffr Alert ⚠️ ${txn.name} — $${Math.abs(txn.amount).toFixed(2)} flagged (${txn.reason}). Check your Buffr dashboard.`;

    let status = "pending";
    let twilioSid: string | undefined;

    if (parentPhone) {
      const result = await sendSms(parentPhone, msg);
      status    = result.success ? "delivered" : "failed";
      twilioSid = result.sid;
    }

    await supabase.from("sms_logs").insert({
      parent_id:      parentDbId,
      transaction_id: txn.id,
      phone:          parentPhone ?? "unknown",
      message:        msg,
      status,
      twilio_sid:     twilioSid ?? null,
    });
  }

  return newlyFlagged.length;
}
