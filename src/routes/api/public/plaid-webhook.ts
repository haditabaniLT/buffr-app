/**
 * DEPRECATED — this TanStack route is kept only as a fallback.
 *
 * All new Plaid webhook traffic should go to the Supabase Edge Function:
 *   https://vvdzfrmyuaqwxdpndkvu.supabase.co/functions/v1/transaction-webhook
 *
 * The edge function:
 *  - Verifies the Plaid-Verification ES256 JWT signature
 *  - Calls /transactions/sync and persists results to public.transactions
 *
 * The webhook URL registered in createPlaidLinkToken (plaid-server.ts) already
 * points to the edge function. This file handles any lingering legacy items
 * that still have the old URL registered and logs the raw payload only.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Plaid-Verification",
};

export const Route = createFileRoute("/api/public/plaid-webhook")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      POST: async ({ request }) => {
        const raw = await request.text();
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = {};
        }

        const itemId: string | null = (payload?.item_id as string) ?? null;

        console.warn(
          "[legacy-webhook] Received on deprecated route. " +
          "Update item webhook URL to the edge function. item_id:", itemId,
        );

        // Log raw event only — no transaction sync (no signature verification here)
        const { error } = await supabaseAdmin.from("plaid_webhook_events").insert({
          payload: raw,
          plaid_item_id: itemId,
        });
        if (error) console.error("plaid_webhook_events insert failed:", error);

        return new Response(JSON.stringify({ ok: true, legacy: true }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      },
    },
  },
});
