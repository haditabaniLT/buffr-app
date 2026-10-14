/**
 * Minimal Twilio REST helper for Supabase Edge Functions.
 * Uses the Messages API — no SDK dependency needed.
 * Credentials are optional: a missing key records a failed alert instead of throwing.
 * Keep formatFlagAlert in sync with src/lib/server/twilio.ts.
 */

export interface SmsResult {
  success: boolean;
  sid?: string;
  error?: string;
}

export type AlertNotifyStatus = "sent" | "failed" | "skipped" | "opted_out";

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 3)}...`;
}

/** E.164. Ten-digit numbers are treated as US. */
export function normalizeE164(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export function formatFlagAlert(input: {
  merchant: string;
  amount: number;
  category: string;
  childName?: string | null;
}): string {
  const merchant = clip(input.merchant || "Unknown merchant", 40);
  const category = clip((input.category || "high risk").replace(/_/g, " "), 24);
  const dollars = Math.abs(input.amount).toFixed(2);
  const child = input.childName?.trim();
  const detail = child
    ? `${clip(child, 24)} spent $${dollars} at ${merchant}`
    : `$${dollars} at ${merchant}`;
  return `Buffr alert: ${detail}. Flagged as ${category}. Review it in the Buffr app. Msg & data rates may apply. Reply STOP to opt out.`;
}

export async function sendSms(to: string, body: string): Promise<SmsResult> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_FROM_NUMBER");

  if (!accountSid || !authToken || !from) {
    console.warn("[twilio] Not configured — SMS skipped. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER.");
    return { success: false, error: "Twilio not configured" };
  }

  const toNorm = normalizeE164(to);
  const fromNorm = normalizeE164(from);
  if (toNorm.length < 8) {
    return { success: false, error: "Invalid phone number" };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
    },
    body: new URLSearchParams({ To: toNorm, From: fromNorm, Body: body }).toString(),
  });

  const data = await res.json() as { sid?: string; message?: string };

  if (!res.ok) {
    console.error("[twilio] API error:", data.message ?? res.status);
    return { success: false, error: data.message ?? `HTTP ${res.status}` };
  }

  return { success: true, sid: data.sid };
}
