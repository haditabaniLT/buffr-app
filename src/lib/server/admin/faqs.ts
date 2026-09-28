import { createServerFn } from "@tanstack/react-start";
import { requireAdmin } from "@/lib/server-helpers";

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

export const adminListFaqs = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await requireAdmin(data.accessToken);
    const { data: rows, error } = await (supabaseAdmin as any)
      .from("faqs").select("*").order("sort_order").order("created_at");
    if (error) throw new Error(error.message);
    return { faqs: (rows ?? []) as unknown as FaqRow[] };
  });

export const adminCreateFaq = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string; question: string; answer: string; sort_order?: number }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    if (!input.question?.trim()) throw new Error("Question is required.");
    if (!input.answer?.trim()) throw new Error("Answer is required.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await requireAdmin(data.accessToken);
    const { data: row, error } = await (supabaseAdmin as any)
      .from("faqs")
      .insert({ question: data.question.trim(), answer: data.answer.trim(), sort_order: data.sort_order ?? 0 })
      .select("*").single();
    if (error) throw new Error(error.message);
    return { faq: row as unknown as FaqRow };
  });

export const adminUpdateFaq = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string; id: string; question: string; answer: string; sort_order?: number }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    if (!input.id) throw new Error("Missing FAQ id.");
    if (!input.question?.trim()) throw new Error("Question is required.");
    if (!input.answer?.trim()) throw new Error("Answer is required.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await requireAdmin(data.accessToken);
    const { data: row, error } = await (supabaseAdmin as any)
      .from("faqs")
      .update({ question: data.question.trim(), answer: data.answer.trim(), sort_order: data.sort_order ?? 0 })
      .eq("id", data.id).select("*").single();
    if (error) throw new Error(error.message);
    return { faq: row as unknown as FaqRow };
  });

export const adminDeleteFaq = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string; id: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    if (!input.id) throw new Error("Missing FAQ id.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await requireAdmin(data.accessToken);
    const { error } = await (supabaseAdmin as any).from("faqs").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
