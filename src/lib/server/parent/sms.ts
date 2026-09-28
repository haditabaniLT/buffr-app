import { createServerFn } from "@tanstack/react-start";
import { withRetry, requireParent } from "@/lib/server-helpers";

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

export const listSmsLogs = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin, parentId } = await requireParent(data.accessToken);

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
