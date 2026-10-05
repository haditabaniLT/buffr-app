import { createAdminServerFn } from "@/lib/server/admin/server-fn";

// ---------------------------------------------------------------------------
// FAQs
// ---------------------------------------------------------------------------

export type FaqRow = {
  id: string;
  question: string;
  answer: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export const adminListFaqs = createAdminServerFn()
  .handler(async ({ context }) => {
    const { supabaseAdmin } = context;
    const { data: rows, error } = await (supabaseAdmin as any)
      .from("faqs").select("*").order("sort_order").order("created_at");
    if (error) throw new Error(error.message);
    return { faqs: (rows ?? []) as unknown as FaqRow[] };
  });

export const adminCreateFaq = createAdminServerFn()
  .inputValidator((input: { accessToken: string; question: string; answer: string; sort_order?: number }) => {
    if (!input.question?.trim()) throw new Error("Question is required.");
    if (!input.answer?.trim()) throw new Error("Answer is required.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = context;
    const { data: row, error } = await (supabaseAdmin as any)
      .from("faqs")
      .insert({ question: data.question.trim(), answer: data.answer.trim(), sort_order: data.sort_order ?? 0 })
      .select("*").single();
    if (error) throw new Error(error.message);
    return { faq: row as unknown as FaqRow };
  });

export const adminUpdateFaq = createAdminServerFn()
  .inputValidator((input: { accessToken: string; id: string; question: string; answer: string; sort_order?: number }) => {
    if (!input.id) throw new Error("Missing FAQ id.");
    if (!input.question?.trim()) throw new Error("Question is required.");
    if (!input.answer?.trim()) throw new Error("Answer is required.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = context;
    const { data: row, error } = await (supabaseAdmin as any)
      .from("faqs")
      .update({ question: data.question.trim(), answer: data.answer.trim(), sort_order: data.sort_order ?? 0 })
      .eq("id", data.id).select("*").single();
    if (error) throw new Error(error.message);
    return { faq: row as unknown as FaqRow };
  });

export const adminDeleteFaq = createAdminServerFn()
  .inputValidator((input: { accessToken: string; id: string }) => {
    if (!input.id) throw new Error("Missing FAQ id.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = context;
    const { error } = await (supabaseAdmin as any).from("faqs").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
