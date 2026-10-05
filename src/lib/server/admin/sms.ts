import { createAdminServerFn } from "@/lib/server/admin/server-fn";
import { withRetry } from "@/lib/server-helpers";

export type SmsLogRow = {
  id: string;
  parent_id: string;
  transaction_id: string | null;
  phone: string;
  message: string;
  status: string;
  twilio_sid: string | null;
  created_at: string;
};

export const adminListSmsLogs = createAdminServerFn()
  .handler(async ({ context }) => {
    const { supabaseAdmin } = context;

    const rows = await withRetry(async () => {
      const { data: r, error } = await supabaseAdmin
        .from("sms_logs")
        .select("id,parent_id,transaction_id,phone,message,status,twilio_sid,created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return r ?? [];
    }, "admin load SMS logs");

    return { logs: rows as SmsLogRow[] };
  });
