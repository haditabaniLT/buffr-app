/**
 * Minimal Twilio REST helper for Supabase Edge Functions.
 * Uses the Messages API — no SDK dependency needed.
 */

export interface SmsResult {
  success: boolean;
  sid?: string;
  error?: string;
}

export async function sendSms(to: string, body: string): Promise<SmsResult> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken  = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from       = Deno.env.get("TWILIO_FROM_NUMBER");

  if (!accountSid || !authToken || !from) {
    console.warn("[twilio] Not configured — SMS skipped. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER.");
    return { success: false, error: "Twilio not configured" };
  }

  // Normalise: ensure leading +
  const toNorm   = to.startsWith("+") ? to : `+1${to.replace(/\D/g, "")}`;
  const fromNorm = from.startsWith("+") ? from : `+1${from.replace(/\D/g, "")}`;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${btoa(`${accountSid}:${authToken}`)}`,
    },
    body: new URLSearchParams({ To: toNorm, From: fromNorm, Body: body }).toString(),
  });

  const data = await res.json() as { sid?: string; message?: string };

  if (!res.ok) {
    console.error("[twilio] API error:", data);
    return { success: false, error: data.message ?? `HTTP ${res.status}` };
  }

  return { success: true, sid: data.sid };
}
