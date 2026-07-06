import { createServerFn } from "@tanstack/react-start";
import { withRetry, requireParent, requireChild, requireAdultChild } from "./server-helpers";
import { insertNotification } from "./notifications-server";
import type { SupabaseClient } from "@supabase/supabase-js";

const PLAID_BASE =
  process.env.PLAID_ENV === "production"
    ? "https://production.plaid.com"
    : "https://sandbox.plaid.com";

/** Supabase Edge Function URL that receives Plaid webhooks. */
const WEBHOOK_EDGE_FN =
  process.env.PLAID_WEBHOOK_URL ??
  `${process.env.SUPABASE_URL ?? "https://vvdzfrmyuaqwxdpndkvu.supabase.co"}/functions/v1/transaction-webhook`;

function plaidCreds() {
  const client_id = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!client_id || !secret) {
    throw new Error("Plaid credentials are not configured. Add PLAID_CLIENT_ID and PLAID_SECRET.");
  }
  return { client_id, secret };
}

async function plaidPost<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${PLAID_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: any = await res.json();
  if (!res.ok) {
    console.error(`Plaid ${path} error:`, data);
    throw new Error(data?.error_message || `Plaid request failed (${res.status}).`);
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// OpenAI fraud detection helpers
// ---------------------------------------------------------------------------

interface AIFraudResult {
  is_fraud: boolean;
  risk_level: "high" | "medium" | "low";
  category: string;
  reason: string;
  merchant_name: string;
}

/**
 * Ask GPT-4o-mini whether a transaction looks fraudulent / high-risk.
 * Returns null if the API key is missing or the call fails (fail-open).
 */
async function analyzeTransactionWithAI(txn: {
  name: string | null;
  merchant_name: string | null;
  amount: number;
  category?: string[] | null;
  personal_finance_category?: string | null;
}): Promise<AIFraudResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[ai] OPENAI_API_KEY not set — skipping AI check.");
    return null;
  }

  const systemPrompt = `You are a fraud-detection assistant for Buffr, a parental financial monitoring app that watches a teenager's spending.

Your job: decide whether a transaction is from a HIGH-RISK or FRAUDULENT merchant that a parent should be alerted about.

FLAG these categories (is_fraud = true):
- Gambling / sports betting (DraftKings, FanDuel, BetMGM, casinos, poker sites)
- Cryptocurrency exchanges or NFT platforms (Coinbase, Binance, OpenSea, Kraken)
- Payday loan / cash-advance services
- Adult content / explicit material platforms
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

  const userContent = `Transaction details:
- Merchant name: ${txn.merchant_name || "(none)"}
- Transaction name: ${txn.name || "(none)"}
- Amount: $${Math.abs(txn.amount).toFixed(2)}
- Plaid category: ${(txn.category ?? []).join(", ") || "(none)"}
- Personal finance category: ${txn.personal_finance_category || "(none)"}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-5-nano",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[ai] OpenAI API error:", err);
      return null;
    }

    const json: any = await res.json();
    const raw = json?.choices?.[0]?.message?.content;
    if (!raw) return null;
    return JSON.parse(raw) as AIFraudResult;
  } catch (err) {
    console.error("[ai] analyzeTransactionWithAI threw:", err);
    return null;
  }
}

/**
 * Upsert a merchant detected by AI into the merchants table.
 * Uses ignoreDuplicates so manually curated rows are never overwritten.
 */
const VALID_FLAG_CATEGORIES = new Set([
  "gambling", "payday_loan", "crypto", "high_risk",
  "adult_content", "mlm", "dark_web", "tobacco_minor",
  "gaming_lootbox", "suspicious_marketplace", "other_risk",
]);

function safeCategory(cat: string): string {
  return VALID_FLAG_CATEGORIES.has(cat) ? cat : "high_risk";
}

async function addDetectedMerchant(
  supabaseAdmin: SupabaseClient,
  name: string,
  category: string,
  riskLevel: "high" | "medium" | "low",
): Promise<void> {
  const { error } = await supabaseAdmin.from("merchants").upsert(
    { name, category, risk_level: riskLevel },
    { onConflict: "name", ignoreDuplicates: true },
  );
  if (error) console.error("[ai] addDetectedMerchant error:", error.message);
  else console.log(`[ai] merchant added/already present: ${name} (${category})`);
}

export const createPlaidLinkToken = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    return input;
  })
  .handler(async ({ data }) => {
    const { parentId } = await requireParent(data.accessToken);
    const creds = plaidCreds();
    // Points to the Supabase Edge Function which verifies the Plaid JWT
    // and calls /transactions/sync automatically on every webhook event.
    const webhookUrl = WEBHOOK_EDGE_FN;
    const result = await plaidPost<{ link_token: string }>("/link/token/create", {
      ...creds,
      user: { client_user_id: parentId },
      client_name: "Buffr",
      products: ["transactions"],
      country_codes: ["US"],
      language: "en",
      webhook: webhookUrl,
    });
    return { link_token: result.link_token };
  });

export const exchangePlaidPublicToken = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string; publicToken: string; institutionName?: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    if (!input?.publicToken) throw new Error("Missing Plaid public token.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin, parentId } = await requireParent(data.accessToken);
    const creds = plaidCreds();

    // 1. Exchange public_token -> access_token + item_id
    const exchange = await plaidPost<{ access_token: string; item_id: string }>(
      "/item/public_token/exchange",
      { ...creds, public_token: data.publicToken }
    );

    // 2. Fetch accounts
    const accountsResp = await plaidPost<{ accounts: any[]; item: any }>("/accounts/get", {
      ...creds,
      access_token: exchange.access_token,
    });

    // 3. Insert each account row (owner defaults to the parent)
    const rows = accountsResp.accounts.map((a) => ({
      owner_user_id: parentId,
      linked_by_parent_id: parentId,
      plaid_item_id: exchange.item_id,
      plaid_account_id: a.account_id,
      plaid_access_token: exchange.access_token,
      institution_name: data.institutionName ?? null,
      account_name: a.name ?? a.official_name ?? null,
      account_mask: a.mask ?? null,
      account_type: a.type ?? null,
      account_subtype: a.subtype ?? null,
      current_balance: a.balances?.current ?? null,
      available_balance: a.balances?.available ?? null,
      iso_currency_code: a.balances?.iso_currency_code ?? "USD",
    }));

    const inserted = await withRetry(async () => {
      const { data: r, error } = await supabaseAdmin
        .from("bank_accounts")
        .upsert(rows, { onConflict: "plaid_item_id,plaid_account_id" })
        .select("id,plaid_account_id,account_name,account_mask,account_type,institution_name,current_balance");
      if (error) throw error;
      return r ?? [];
    }, "save bank accounts");

    return { accounts: inserted };
  });

export type BankAccountRow = {
  id: string;
  owner_user_id: string;
  owner_name: string | null;
  plaid_item_id: string;
  institution_name: string | null;
  account_name: string | null;
  account_mask: string | null;
  account_type: string | null;
  account_subtype: string | null;
  current_balance: number | null;
  iso_currency_code: string | null;
  created_at: string;
};

export const listParentBankAccounts = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin, parentId } = await requireParent(data.accessToken);

    // All accounts visible to this parent = those owned by the parent or any of
    // their children (covers parent-linked, child self-linked, and reassigned accounts).
    const { data: childRows, error: childErr } = await supabaseAdmin
      .from("users").select("id").eq("parent_id", parentId);
    if (childErr) throw childErr;
    const familyIds = [parentId, ...(childRows ?? []).map((c) => c.id)];

    const accounts = await withRetry(async () => {
      const { data: r, error } = await supabaseAdmin
        .from("bank_accounts")
        .select("id,owner_user_id,plaid_item_id,institution_name,account_name,account_mask,account_type,account_subtype,current_balance,iso_currency_code,created_at")
        .in("owner_user_id", familyIds)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return r ?? [];
    }, "load bank accounts");

    const ownerIds = Array.from(new Set(accounts.map((a) => a.owner_user_id)));
    const owners = await withRetry(async () => {
      const { data: r, error } = await supabaseAdmin
        .from("users")
        .select("id,name,email")
        .in("id", ownerIds.length ? ownerIds : ["00000000-0000-0000-0000-000000000000"]);
      if (error) throw error;
      return r ?? [];
    }, "load account owners");
    const ownerMap = new Map(owners.map((o) => [o.id, o.name || o.email]));

    return {
      accounts: accounts.map((a) => ({
        ...a,
        owner_name: ownerMap.get(a.owner_user_id) ?? null,
      })) as BankAccountRow[],
    };
  });

export const assignBankAccountOwner = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string; accountId: string; ownerUserId: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    if (!input?.accountId || !input?.ownerUserId) throw new Error("Missing account or owner.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin, parentId } = await requireParent(data.accessToken);

    // Fetch all children to build the family ID set
    const { data: childRows, error: childErr } = await supabaseAdmin
      .from("users").select("id").eq("parent_id", parentId);
    if (childErr) throw childErr;
    const childIds = (childRows ?? []).map((c) => c.id);
    const familyIds = [parentId, ...childIds];

    // Verify the target owner is the parent or one of their children
    if (!familyIds.includes(data.ownerUserId)) {
      throw new Error("You can only assign accounts to yourself or your children.");
    }

    // Verify the account currently belongs to this parent's family before updating
    const { data: existing, error: scopeErr } = await supabaseAdmin
      .from("bank_accounts").select("id").eq("id", data.accountId).in("owner_user_id", familyIds).maybeSingle();
    if (scopeErr) throw scopeErr;
    if (!existing) throw new Error("Account not found or access denied.");

    await withRetry(async () => {
      const { error } = await supabaseAdmin
        .from("bank_accounts")
        .update({ owner_user_id: data.ownerUserId })
        .eq("id", data.accountId);
      if (error) throw error;
    }, "assign account");

    return { ok: true };
  });

export const deleteBankAccount = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string; accountId: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    if (!input?.accountId) throw new Error("Missing account id.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin, parentId } = await requireParent(data.accessToken);

    const { data: childRows } = await supabaseAdmin
      .from("users").select("id").eq("parent_id", parentId);
    const familyIds = [parentId, ...(childRows ?? []).map((c) => c.id)];

    await withRetry(async () => {
      const { error } = await supabaseAdmin
        .from("bank_accounts")
        .delete()
        .eq("id", data.accountId)
        .in("owner_user_id", familyIds);
      if (error) throw error;
    }, "remove account");
    return { ok: true };
  });

// ============================================================
// Sandbox helpers (safe to call from the UI in development)
// ============================================================

/**
 * Fire a test Plaid webhook for a given item.
 * Triggers the edge function (transaction-webhook) which then calls
 * /transactions/sync and persists results.
 *
 * webhookCode defaults to SYNC_UPDATES_AVAILABLE.
 */
export const fireSandboxWebhook = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { accessToken: string; plaidItemId: string; webhookCode?: string }) => {
      if (!input?.accessToken) throw new Error("Please sign in again.");
      if (!input?.plaidItemId) throw new Error("Missing plaidItemId.");
      return input;
    },
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin, parentId } = await requireParent(data.accessToken);
    const creds = plaidCreds();

    const { data: childRows } = await supabaseAdmin
      .from("users").select("id").eq("parent_id", parentId);
    const familyIds = [parentId, ...(childRows ?? []).map((c) => c.id)];

    const account = await withRetry(async () => {
      const { data: row, error } = await supabaseAdmin
        .from("bank_accounts")
        .select("plaid_access_token")
        .eq("plaid_item_id", data.plaidItemId)
        .in("owner_user_id", familyIds)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return row;
    }, "look up bank account");

    if (!account?.plaid_access_token) throw new Error("Account not found.");

    const result = await plaidPost<{ webhook_fired: boolean; request_id: string }>(
      "/sandbox/item/fire_webhook",
      {
        ...creds,
        access_token: account.plaid_access_token,
        webhook_type: "TRANSACTIONS",
        webhook_code: data.webhookCode ?? "SYNC_UPDATES_AVAILABLE",
      },
    );
    return { ok: true, ...result };
  });

/**
 * Full pipeline test: inject a transaction into Plaid sandbox, then fire a
 * SYNC_UPDATES_AVAILABLE webhook so the transaction-webhook edge function
 * picks it up (sync → flag → SMS). Tests the real production webhook path.
 */
export const injectAndFireWebhook = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { accessToken: string; plaidItemId: string; merchant: string; amount: number }) => {
      if (!input?.accessToken) throw new Error("Please sign in again.");
      if (!input?.plaidItemId) throw new Error("Missing plaidItemId.");
      if (!input?.merchant?.trim()) throw new Error("Merchant name is required.");
      if (!input?.amount || input.amount <= 0) throw new Error("Amount must be positive.");
      return input;
    },
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin, parentId } = await requireParent(data.accessToken);
    const creds = plaidCreds();

    const { data: childRows } = await supabaseAdmin
      .from("users").select("id").eq("parent_id", parentId);
    const familyIds = [parentId, ...(childRows ?? []).map((c) => c.id)];

    const account = await withRetry(async () => {
      const { data: row, error } = await supabaseAdmin
        .from("bank_accounts")
        .select("plaid_access_token")
        .eq("plaid_item_id", data.plaidItemId)
        .in("owner_user_id", familyIds)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return row;
    }, "look up bank account");

    if (!account?.plaid_access_token) throw new Error("Account not found.");

    const today = new Date().toISOString().split("T")[0];

    // Step 1: inject transaction into Plaid sandbox
    await plaidPost("/sandbox/transactions/create", {
      ...creds,
      access_token: account.plaid_access_token,
      transactions: [{
        amount:            data.amount,
        date_transacted:   today,
        date_posted:       today,
        description:       data.merchant.trim(),
        iso_currency_code: "USD",
      }],
    });

    // Step 2: fire webhook → transaction-webhook edge function syncs, flags, SMS
    const webhookResult = await plaidPost<{ webhook_fired: boolean; request_id: string }>(
      "/sandbox/item/fire_webhook",
      {
        ...creds,
        access_token: account.plaid_access_token,
        webhook_type: "TRANSACTIONS",
        webhook_code: "SYNC_UPDATES_AVAILABLE",
      },
    );

    return { ok: true, injected: 1, webhook_fired: webhookResult.webhook_fired };
  });

/**
 * Inject synthetic transactions into a sandbox item.
 * Only works for items created with the user_transactions_dynamic test username.
 * After injecting, Plaid fires webhooks automatically (edge fn picks them up).
 */
export const createSandboxTransactions = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      accessToken: string;
      plaidItemId: string;
      transactions: Array<{ amount: number; date: string; description: string }>;
    }) => {
      if (!input?.accessToken) throw new Error("Please sign in again.");
      if (!input?.plaidItemId) throw new Error("Missing plaidItemId.");
      if (!input?.transactions?.length) throw new Error("Provide at least one transaction.");
      if (input.transactions.length > 10) throw new Error("Max 10 transactions per request.");
      return input;
    },
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin, parentId } = await requireParent(data.accessToken);
    const creds = plaidCreds();

    const { data: childRows } = await supabaseAdmin
      .from("users").select("id").eq("parent_id", parentId);
    const familyIds = [parentId, ...(childRows ?? []).map((c) => c.id)];

    const account = await withRetry(async () => {
      const { data: row, error } = await supabaseAdmin
        .from("bank_accounts")
        .select("plaid_access_token, transactions_sync_cursor")
        .eq("plaid_item_id", data.plaidItemId)
        .in("owner_user_id", familyIds)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return row;
    }, "look up bank account");

    if (!account?.plaid_access_token) throw new Error("Account not found.");

    // Ensure a cursor exists before injection.
    // initCursor returns the cursor so we use it immediately — calling
    // /transactions/sync without a cursor after initCursor may miss
    // transactions injected after the first cursor initialisation.
    let cursor = account.transactions_sync_cursor ?? "";
    if (!cursor) {
      console.log("[createSandbox] No cursor yet — initialising first");
      cursor = await initCursor(supabaseAdmin, account.plaid_access_token, data.plaidItemId, creds);
    }

    const today = new Date().toISOString().split("T")[0];

    // Note: Plaid docs confirm NO account_id field exists for this endpoint.
    // Transactions always land on the first depository account of the item.
    const transactions = data.transactions.map((t) => ({
      amount:           t.amount,
      date_transacted:  today,
      date_posted:      today,
      description:      t.description,
      iso_currency_code: "USD",
    }));

    await plaidPost<{ request_id: string }>("/sandbox/transactions/create", {
      ...creds,
      access_token: account.plaid_access_token,
      transactions,
    });

    // Sync from the cursor established before injection so the newly
    // created transaction appears in the `added` array.
    const result = await syncAndStoreFlagged(
      supabaseAdmin, account.plaid_access_token, data.plaidItemId,
      cursor, creds, parentId,
    );

    return { ok: true, injected: data.transactions.length, ...result };
  });

/**
 * Manually trigger a /transactions/sync for an item (bypasses webhook).
 * Useful for the first sync after linking an account or during development.
 */
export const syncTransactionsManually = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string; plaidItemId: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    if (!input?.plaidItemId) throw new Error("Missing plaidItemId.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin, parentId } = await requireParent(data.accessToken);
    const creds = plaidCreds();

    const { data: childRows } = await supabaseAdmin
      .from("users").select("id").eq("parent_id", parentId);
    const familyIds = [parentId, ...(childRows ?? []).map((c) => c.id)];

    const account = await withRetry(async () => {
      const { data: row, error } = await supabaseAdmin
        .from("bank_accounts")
        .select("plaid_access_token, transactions_sync_cursor")
        .eq("plaid_item_id", data.plaidItemId)
        .in("owner_user_id", familyIds)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return row;
    }, "look up bank account");

    if (!account?.plaid_access_token) throw new Error("Account not found.");

    console.log("[syncManually] item:", data.plaidItemId);

    const result = await syncAndStoreFlagged(
      supabaseAdmin, account.plaid_access_token, data.plaidItemId,
      account.transactions_sync_cursor ?? "", creds, parentId,
    );

    return { ok: true, ...result };
  });

// ── Core sync helper ─────────────────────────────────────────────────────────
// Architecture: check FIRST, store ONLY flagged transactions.
// We never write non-flagged transactions to the DB.

type PlaidCreds = { client_id: string; secret: string };
type Merchant   = { name: string; category: string; risk_level: string };

interface SyncResult { checked: number; flagged: number }

/**
 * Drain /transactions/sync pages, check every added transaction against the
 * flagged-merchants list, and INSERT only the ones that match.
 * Modified rows: update only if already in DB (already flagged).
 * Removed rows:  delete from DB if present.
 * Cursor is persisted after every page.
 */
async function syncAndStoreFlagged(
  supabaseAdmin: SupabaseClient,
  accessToken: string,
  plaidItemId: string,
  startCursor: string,
  creds: PlaidCreds,
  parentId: string,
): Promise<SyncResult> {
  // Load merchants + parent phone + opt-out status once before the loop
  const [merchantRes, parentRes] = await Promise.all([
    supabaseAdmin.from("merchants").select("name, category, risk_level"),
    supabaseAdmin.from("users").select("phone, sms_opted_out").eq("id", parentId).maybeSingle(),
  ]);
  const merchants: Merchant[] = (merchantRes.data ?? []) as Merchant[];
  const parentPhone: string | null  = (parentRes.data as any)?.phone       ?? null;
  const smsOptedOut: boolean        = (parentRes.data as any)?.sms_opted_out ?? false;

  let cursor  = startCursor;
  let hasMore = true;
  let totalChecked = 0;
  let totalFlagged = 0;

  while (hasMore) {
    const reqBody: Record<string, unknown> = { ...creds, access_token: accessToken };
    if (cursor) reqBody.cursor = cursor;

    const page = await plaidPost<{
      added: any[]; modified: any[]; removed: any[];
      next_cursor: string; has_more: boolean;
    }>("/transactions/sync", reqBody);

    console.log(`[sync] page: +${page.added.length} added, ~${page.modified.length} modified, -${page.removed.length} removed`);

    // ── Added: check each against merchants, store only matches ──────────────
    if (page.added.length > 0) {
      // Bulk-enrich bank_account_id + owner_user_id
      const acctIds = [...new Set(page.added.map((t: any) => t.account_id as string))];
      const { data: accts } = await supabaseAdmin
        .from("bank_accounts")
        .select("id, plaid_account_id, owner_user_id")
        .in("plaid_account_id", acctIds);
      const acctMap = new Map((accts ?? []).map((a: any) => [a.plaid_account_id, a]));

      for (const txn of page.added) {
        totalChecked++;
        const search = ((txn.merchant_name || txn.name) ?? "").toLowerCase().trim();
        if (!search) continue;

        const match = merchants.find(
          (m) => search.includes(m.name.toLowerCase()) || m.name.toLowerCase().includes(search),
        );

        let flagReason: string;
        let flagCategory: string;

        if (match) {
          flagReason   = `${match.category.replace(/_/g, " ")} – ${match.name}`;
          flagCategory = match.category;
        } else {
          // No merchant-list match — ask AI
          const ai = await analyzeTransactionWithAI({
            name:                    txn.name,
            merchant_name:           txn.merchant_name,
            amount:                  txn.amount,
            category:                txn.category,
            personal_finance_category: txn.personal_finance_category?.primary ?? null,
          });

          if (!ai || !ai.is_fraud) continue; // AI says safe (or unreachable) — skip

          const safeCat = safeCategory(ai.category);
          flagReason   = `${safeCat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} – ${ai.risk_level.charAt(0).toUpperCase() + ai.risk_level.slice(1)} Risk`;
          flagCategory = safeCat;

          // Persist the newly discovered merchant so future rule-based checks catch it
          await addDetectedMerchant(supabaseAdmin, ai.merchant_name || (txn.merchant_name ?? txn.name ?? "Unknown"), safeCat, ai.risk_level);
        }

        const acct = acctMap.get(txn.account_id);

        const { error: insErr } = await supabaseAdmin.from("transactions").upsert({
          id:                       txn.transaction_id,
          account_id:               txn.account_id,
          bank_account_id:          acct?.id          ?? null,
          owner_user_id:            acct?.owner_user_id ?? null,
          amount:                   txn.amount,
          iso_currency_code:        txn.iso_currency_code ?? "USD",
          name:                     txn.name          ?? null,
          merchant_name:            txn.merchant_name ?? null,
          category:                 txn.category      ?? [],
          personal_finance_category: txn.personal_finance_category?.primary ?? null,
          date:                     txn.date,
          pending:                  txn.pending       ?? false,
          plaid_item_id:            plaidItemId,
          raw_json:                 txn,
          is_flagged:               true,
          flag_reason:              flagReason,
          flag_category:            flagCategory,
          updated_at:               new Date().toISOString(),
        }, { onConflict: "id" });

        if (insErr) { console.error("[sync] insert error:", insErr.message); continue; }

        // Send SMS alert — skip if parent has opted out via STOP
        // 10DLC requirement: every message must include opt-out instruction
        const msgBody = `Buffr Alert: ${txn.merchant_name || txn.name} — $${Math.abs(txn.amount).toFixed(2)} flagged (${flagReason}). View your dashboard for details. Msg&data rates may apply. Reply STOP to opt out.`;
        let smsStatus = "pending", twilioSid: string | null = null;
        if (parentPhone && !smsOptedOut) {
          const r = await sendTwilioSms(parentPhone, msgBody);
          smsStatus = r.success ? "delivered" : "failed";
          twilioSid = r.sid ?? null;
        } else if (smsOptedOut) {
          smsStatus = "opted_out";
        }
        const msg = msgBody;
        await supabaseAdmin.from("sms_logs").insert({
          parent_id: parentId, transaction_id: txn.transaction_id,
          phone: parentPhone ?? "unknown", message: msg,
          status: smsStatus, twilio_sid: twilioSid,
        });

        totalFlagged++;
        console.log(`[sync] flagged: ${txn.merchant_name || txn.name} $${txn.amount}`);
      }
    }

    // ── Modified: update amount/pending if row exists in DB (was flagged) ────
    if (page.modified.length > 0) {
      const modIds = page.modified.map((t: any) => t.transaction_id as string);
      const { data: existing } = await supabaseAdmin
        .from("transactions").select("id").in("id", modIds);
      const existingSet = new Set((existing ?? []).map((e: any) => e.id as string));
      for (const txn of page.modified) {
        if (!existingSet.has(txn.transaction_id)) continue;
        await supabaseAdmin.from("transactions").update({
          amount:       txn.amount,
          pending:      txn.pending ?? false,
          name:         txn.name    ?? null,
          merchant_name: txn.merchant_name ?? null,
          raw_json:     txn,
          updated_at:   new Date().toISOString(),
        }).eq("id", txn.transaction_id);
      }
    }

    // ── Removed: delete from DB if present ───────────────────────────────────
    if (page.removed.length > 0) {
      await supabaseAdmin
        .from("transactions")
        .delete()
        .in("id", page.removed.map((r: any) => r.transaction_id as string));
    }

    cursor  = page.next_cursor;
    hasMore = page.has_more;

    // Persist cursor after every page (safe resume on failure)
    if (cursor) {
      await supabaseAdmin
        .from("bank_accounts")
        .update({ transactions_sync_cursor: cursor })
        .eq("plaid_item_id", plaidItemId);
    }
  }

  return { checked: totalChecked, flagged: totalFlagged };
}

/**
 * One-shot cursor initialisation for a brand-new item.
 * Plaid requires at least one /transactions/sync call before
 * SYNC_UPDATES_AVAILABLE webhooks will fire for that item.
 */
async function initCursor(
  supabaseAdmin: SupabaseClient,
  accessToken: string,
  plaidItemId: string,
  creds: PlaidCreds,
): Promise<string> {
  const page = await plaidPost<{ next_cursor: string; has_more: boolean }>(
    "/transactions/sync",
    { ...creds, access_token: accessToken },
  );
  if (page.next_cursor) {
    await supabaseAdmin
      .from("bank_accounts")
      .update({ transactions_sync_cursor: page.next_cursor })
      .eq("plaid_item_id", plaidItemId);
    console.log("[initCursor] initialised for item:", plaidItemId);
  }
  return page.next_cursor ?? "";
}

async function sendTwilioSms(to: string, body: string) {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    console.warn("[twilio] Not configured — SMS skipped.");
    return { success: false };
  }
  const toNorm   = to.startsWith("+")   ? to   : `+1${to.replace(/\D/g, "")}`;
  const fromNorm = from.startsWith("+") ? from : `+1${from.replace(/\D/g, "")}`;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
    },
    body: new URLSearchParams({ To: toNorm, From: fromNorm, Body: body }).toString(),
  });
  const data: any = await res.json();
  if (!res.ok) { console.error("[twilio] error:", data); return { success: false }; }
  return { success: true, sid: data.sid as string };
}

// ── Student (child) bank account functions ───────────────────────────────────
// Mirror of the parent functions above but scoped to the child's own user ID.

export const createPlaidLinkTokenForStudent = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    return input;
  })
  .handler(async ({ data }) => {
    const { childId } = await requireAdultChild(data.accessToken);
    const creds = plaidCreds();
    const result = await plaidPost<{ link_token: string }>("/link/token/create", {
      ...creds,
      user: { client_user_id: childId },
      client_name: "Buffr",
      products: ["transactions"],
      country_codes: ["US"],
      language: "en",
      webhook: WEBHOOK_EDGE_FN,
    });
    return { link_token: result.link_token };
  });

export const exchangePlaidPublicTokenForStudent = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string; publicToken: string; institutionName?: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    if (!input?.publicToken) throw new Error("Missing Plaid public token.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin, childId } = await requireAdultChild(data.accessToken);
    const creds = plaidCreds();

    const exchange = await plaidPost<{ access_token: string; item_id: string }>(
      "/item/public_token/exchange",
      { ...creds, public_token: data.publicToken }
    );

    const accountsResp = await plaidPost<{ accounts: any[] }>("/accounts/get", {
      ...creds,
      access_token: exchange.access_token,
    });

    const rows = accountsResp.accounts.map((a) => ({
      owner_user_id: childId,
      linked_by_parent_id: null,          // child linked it themselves
      plaid_item_id: exchange.item_id,
      plaid_account_id: a.account_id,
      plaid_access_token: exchange.access_token,
      institution_name: data.institutionName ?? null,
      account_name: a.name ?? a.official_name ?? null,
      account_mask: a.mask ?? null,
      account_type: a.type ?? null,
      account_subtype: a.subtype ?? null,
      current_balance: a.balances?.current ?? null,
      available_balance: a.balances?.available ?? null,
      iso_currency_code: a.balances?.iso_currency_code ?? "USD",
    }));

    const inserted = await withRetry(async () => {
      const { data: r, error } = await supabaseAdmin
        .from("bank_accounts")
        .upsert(rows, { onConflict: "plaid_item_id,plaid_account_id" })
        .select("id,plaid_account_id,account_name,account_mask,account_type,institution_name,current_balance");
      if (error) throw error;
      return r ?? [];
    }, "save bank accounts");

    // Notify parent via SMS when their child completes bank connection
    try {
      const { data: childProfile } = await supabaseAdmin
        .from("users")
        .select("name, parent_id")
        .eq("id", childId)
        .single();

      if ((childProfile as any)?.parent_id) {
        const { data: parentProfile } = await supabaseAdmin
          .from("users")
          .select("phone, sms_opted_out")
          .eq("id", (childProfile as any).parent_id)
          .single();

        const childName   = (childProfile as any).name ?? "Your child";
        const institution = data.institutionName ?? "a bank account";

        if ((parentProfile as any)?.phone && !(parentProfile as any).sms_opted_out) {
          await sendTwilioSms(
            (parentProfile as any).phone,
            `Buffr: ${childName} has connected ${institution} and their account is now active. Log in to view their activity. Msg&data rates may apply. Reply STOP to opt out.`,
          );
        }

        // In-app notification
        await insertNotification({
          userId: (childProfile as any).parent_id,
          type:   "child_bank_connected",
          title:  "Child account connected",
          body:   `${childName} has connected ${institution}. Their transactions are now being monitored.`,
        });
      }
    } catch (e) {
      // Non-fatal — don't fail the bank link if the notification fails
      console.warn("[plaid] parent notification failed:", e);
    }

    return { accounts: inserted };
  });

export const listStudentBankAccounts = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin, childId } = await requireChild(data.accessToken);

    const [accounts, userProfile] = await Promise.all([
      withRetry(async () => {
        const { data: r, error } = await supabaseAdmin
          .from("bank_accounts")
          .select("id,owner_user_id,plaid_item_id,institution_name,account_name,account_mask,account_type,account_subtype,current_balance,iso_currency_code,created_at")
          .eq("owner_user_id", childId)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return r ?? [];
      }, "load bank accounts"),
      supabaseAdmin
        .from("users")
        .select("is_minor")
        .eq("id", childId)
        .single()
        .then(({ data }) => data),
    ]);

    return {
      accounts: accounts.map((a) => ({
        ...a,
        owner_name: null,
      })) as BankAccountRow[],
      isMinor: userProfile?.is_minor ?? false,
    };
  });

export const deleteStudentBankAccount = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string; accountId: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    if (!input?.accountId) throw new Error("Missing account ID.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin, childId } = await requireAdultChild(data.accessToken);

    await withRetry(async () => {
      const { error } = await supabaseAdmin
        .from("bank_accounts")
        .delete()
        .eq("id", data.accountId)
        .eq("owner_user_id", childId);   // child can only delete their own accounts
      if (error) throw error;
    }, "remove bank account");

    return { ok: true };
  });
