import { createServerFn } from "@tanstack/react-start";
import { withRetry, requireParent } from "@/lib/server-helpers";

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
      link_customization_name: "default",
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
