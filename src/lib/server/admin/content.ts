import { createAdminServerFn } from "@/lib/server/admin/server-fn";

// ---------------------------------------------------------------------------
// Content pages (Terms / Privacy)
// ---------------------------------------------------------------------------

export type ContentPageRow = {
  id: string;
  slug: string;
  title: string;
  body: string;
  updated_at: string;
};

export const adminListContentPages = createAdminServerFn()
  .handler(async ({ context }) => {
    const { supabaseAdmin } = context;
    const { data: rows, error } = await (supabaseAdmin as any)
      .from("content_pages").select("*").order("slug");
    if (error) throw new Error(error.message);
    return { pages: (rows ?? []) as unknown as ContentPageRow[] };
  });

export const adminUpdateContentPage = createAdminServerFn()
  .inputValidator((input: { accessToken: string; slug: string; body: string }) => {
    if (!input.slug) throw new Error("Missing page slug.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = context;
    const { data: row, error } = await (supabaseAdmin as any)
      .from("content_pages")
      .update({ body: data.body })
      .eq("slug", data.slug)
      .select("*").single();
    if (error) throw new Error(error.message);
    return { page: row as unknown as ContentPageRow };
  });
