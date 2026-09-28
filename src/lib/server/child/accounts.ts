import { createServerFn } from "@tanstack/react-start";
import { withRetry, requireChild, requireAdultChild } from "@/lib/server-helpers";

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

// Child bank accounts. Scoped to the signed-in child. Adults may link and remove their own accounts.
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
      link_customization_name: "default",
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

        await (supabaseAdmin as any).from("notifications").insert({
          user_id: (childProfile as any).parent_id,
          type: "child_bank_connected",
          title: "Child account connected",
          body: `${childName} has connected ${institution}. Their transactions are now being monitored.`,
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
