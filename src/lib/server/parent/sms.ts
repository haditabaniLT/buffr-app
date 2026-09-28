import { createParentServerFn } from "@/lib/server/parent/server-fn";
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

export const listSmsLogs = createParentServerFn()
  .handler(async ({ context }) => {
    const { supabaseAdmin, parentId } = context;

    const rows = await withRetry(async () => {
      const { data: r, error } = await supabaseAdmin
        .from("sms_logs")
        .select("id,parent_id,transaction_id,phone,message,status,twilio_sid,created_at")
        .eq("parent_id", parentId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return r ?? [];
    }, "load SMS logs");

    return { logs: rows as SmsLogRow[] };
  });
