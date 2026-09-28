/**
 * DEPRECATED — Plaid webhooks belong on the Supabase Edge Function:
 *   https://vvdzfrmyuaqwxdpndkvu.supabase.co/functions/v1/transaction-webhook
 *
 * This route used to store the raw body with the service-role key and without
 * checking Plaid-Verification. It now accepts the request and writes nothing,
 * so a caller who does not have the Plaid signature cannot insert rows.
 * Plaid retries non-2xx responses, so the response stays 200.
 */
import { createFileRoute } from "@tanstack/react-router";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Plaid-Verification",
};

export const Route = createFileRoute("/api/public/plaid-webhook")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: corsHeaders }),

      POST: async () => {
        console.warn(
          "[legacy-webhook] Ignored request on deprecated route. " +
            "Point the Plaid webhook at the transaction-webhook edge function.",
        );

        return new Response(
          JSON.stringify({ ok: true, legacy: true, ignored: true }),
          {
            status: 200,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          },
        );
      },
    },
  },
});
