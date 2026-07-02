/**
 * POST /api/public/twilio-inbound
 *
 * Handles inbound SMS messages forwarded by Twilio.
 * A2P 10DLC compliance requires:
 *   - Honouring STOP (and variants) by persisting opt-out and NOT sending further alerts
 *   - Responding to HELP with brand name + support contact
 *   - Returning valid TwiML so Twilio marks the webhook as successful
 *
 * Configure this URL in the Twilio console under:
 *   Phone Numbers → Manage → Active Numbers → [your number]
 *   → Messaging → "A message comes in" → Webhook → POST
 *   → URL: https://your-domain.com/api/public/twilio-inbound
 */

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL         = process.env.SUPABASE_URL              ?? process.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// Keywords per CTIA/carrier standards
const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
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

function twimlEmpty(): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response/>`,
    { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } },
  );
}

export const Route = createFileRoute("/api/public/twilio-inbound")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS" },
        }),

      POST: async ({ request }: { request: Request }) => {
        // Twilio sends application/x-www-form-urlencoded
        let body: URLSearchParams;
        try {
          body = new URLSearchParams(await request.text());
        } catch {
          return new Response("Bad request", { status: 400 });
        }

        const from    = (body.get("From") ?? "").trim();
        const rawBody = (body.get("Body") ?? "").trim().toUpperCase();

        if (!from) return twimlEmpty();

        // Normalise E.164
        const normalisedFrom = from.startsWith("+") ? from : `+1${from.replace(/\D/g, "")}`;

        // ── STOP / opt-out ────────────────────────────────────────────────────
        if (STOP_KEYWORDS.has(rawBody)) {
          if (SUPABASE_SERVICE_KEY) {
            const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
            await (admin.from("users") as any)
              .update({ sms_opted_out: true })
              .eq("phone", normalisedFrom);
          }
          return twiml(
            "You have been unsubscribed from Buffr alerts. No further messages will be sent. " +
            "Reply START to re-subscribe.",
          );
        }

        // ── START / re-subscribe ──────────────────────────────────────────────
        if (rawBody === "START" || rawBody === "YES") {
          if (SUPABASE_SERVICE_KEY) {
            const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
            await (admin.from("users") as any)
              .update({ sms_opted_out: false })
              .eq("phone", normalisedFrom);
          }
          return twiml("You have re-subscribed to Buffr alerts. Reply STOP at any time to opt out.");
        }

        // ── HELP ─────────────────────────────────────────────────────────────
        if (HELP_KEYWORDS.has(rawBody)) {
          return twiml(
            "Buffr: Alerts for risky financial activity on linked accounts. " +
            "Support: support@usebuffr.com | usebuffr.com/privacy. " +
            "Msg&data rates may apply. Reply STOP to opt out.",
          );
        }

        // ── Any other message — acknowledge silently ──────────────────────────
        return twimlEmpty();
      },
    },
  },
});
