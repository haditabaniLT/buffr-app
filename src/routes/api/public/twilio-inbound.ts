/**
 * POST /api/public/twilio-inbound
 *
 * Handles inbound SMS messages forwarded by Twilio.
 * A2P 10DLC compliance requires:
 *   - Honouring STOP (and variants) by persisting opt-out and NOT sending further alerts
 *   - Responding to HELP with brand name + support contact
 *   - Returning valid TwiML so Twilio marks the webhook as successful
 *
 * Every POST must carry a valid X-Twilio-Signature. The signature is HMAC-SHA1
 * of the public webhook URL plus the form fields, keyed with TWILIO_AUTH_TOKEN.
 * Set TWILIO_WEBHOOK_URL to that exact public URL when the platform rewrites Host.
 *
 * Configure this URL in the Twilio console under:
 *   Phone Numbers → Manage → Active Numbers → [your number]
 *   → Messaging → "A message comes in" → Webhook → POST
 *   → URL: https://your-domain.com/api/public/twilio-inbound
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";

// Keywords per CTIA/carrier standards
const STOP_KEYWORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
]);
const HELP_KEYWORDS = new Set(["HELP", "INFO"]);

function twiml(message: string): Response {
  const safe = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`,
    { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } },
  );
}

async function setSmsOptOut(phone: string, optedOut: boolean) {
  if (!SUPABASE_SERVICE_KEY) return;
  const admin = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  await admin
    .from("users")
    .update({ sms_opted_out: optedOut })
    .eq("phone", phone);
}

function twimlEmpty(): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response/>`, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

/** HMAC-SHA1 signature Twilio sends in X-Twilio-Signature. */
export function twilioRequestSignature(
  authToken: string,
  url: string,
  params: URLSearchParams,
): string {
  const names = [...new Set(params.keys())].sort();
  let payload = url;
  for (const name of names) {
    for (const value of params.getAll(name)) payload += name + value;
  }
  return createHmac("sha1", authToken).update(payload, "utf8").digest("base64");
}

function signaturesMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function candidateWebhookUrls(request: Request): string[] {
  const url = new URL(request.url);
  const urls = new Set<string>();
  const configured = process.env.TWILIO_WEBHOOK_URL?.trim();
  if (configured) urls.add(configured);

  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const forwardedHost = (
    request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  )
    ?.split(",")[0]
    ?.trim();
  if (forwardedProto && forwardedHost) {
    urls.add(
      `${forwardedProto}://${forwardedHost}${url.pathname}${url.search}`,
    );
  }
  urls.add(`${url.protocol}//${url.host}${url.pathname}${url.search}`);
  return [...urls];
}

function hasValidTwilioSignature(
  request: Request,
  params: URLSearchParams,
): boolean {
  const received = request.headers.get("x-twilio-signature");
  if (!received || !TWILIO_AUTH_TOKEN) return false;
  return candidateWebhookUrls(request).some((url) =>
    signaturesMatch(
      twilioRequestSignature(TWILIO_AUTH_TOKEN, url, params),
      received,
    ),
  );
}

export const Route = createFileRoute("/api/public/twilio-inbound")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
          },
        }),

      POST: async ({ request }: { request: Request }) => {
        if (!TWILIO_AUTH_TOKEN) {
          console.error("[twilio-inbound] TWILIO_AUTH_TOKEN is not set");
          return new Response("Twilio is not configured", { status: 503 });
        }

        // Twilio sends application/x-www-form-urlencoded
        let body: URLSearchParams;
        try {
          body = new URLSearchParams(await request.text());
        } catch {
          return new Response("Bad request", { status: 400 });
        }

        if (!hasValidTwilioSignature(request, body)) {
          return new Response("Forbidden", { status: 403 });
        }

        const from = (body.get("From") ?? "").trim();
        const rawBody = (body.get("Body") ?? "").trim().toUpperCase();

        if (!from) return twimlEmpty();

        // Normalise E.164
        const normalisedFrom = from.startsWith("+")
          ? from
          : `+1${from.replace(/\D/g, "")}`;

        // ── STOP / opt-out ────────────────────────────────────────────────────
        if (STOP_KEYWORDS.has(rawBody)) {
          await setSmsOptOut(normalisedFrom, true);
          return twiml(
            "You have been unsubscribed from Buffr alerts. No further messages will be sent. " +
              "Reply START to re-subscribe.",
          );
        }

        // ── START / re-subscribe ──────────────────────────────────────────────
        if (rawBody === "START" || rawBody === "YES") {
          await setSmsOptOut(normalisedFrom, false);
          return twiml(
            "You have re-subscribed to Buffr alerts. Reply STOP at any time to opt out.",
          );
        }

        // ── HELP ─────────────────────────────────────────────────────────────
        if (HELP_KEYWORDS.has(rawBody)) {
          return twiml(
            "Buffr: Alerts for risky financial activity on linked accounts. " +
              "Support: support@buffr.app | buffr.app/privacy. " +
              "Msg&data rates may apply. Reply STOP to opt out.",
          );
        }

        // ── Any other message — acknowledge silently ──────────────────────────
        return twimlEmpty();
      },
    },
  },
});
