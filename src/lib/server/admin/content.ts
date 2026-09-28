import { createServerFn } from "@tanstack/react-start";
import { requireAdmin } from "@/lib/server-helpers";

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

export const adminListContentPages = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await requireAdmin(data.accessToken);
    const { data: rows, error } = await (supabaseAdmin as any)
      .from("content_pages").select("*").order("slug");
    if (error) throw new Error(error.message);
    return { pages: (rows ?? []) as unknown as ContentPageRow[] };
  });

export const adminUpdateContentPage = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string; slug: string; body: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again.");
    if (!input.slug) throw new Error("Missing page slug.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await requireAdmin(data.accessToken);
    const { data: row, error } = await (supabaseAdmin as any)
      .from("content_pages")
      .update({ body: data.body })
      .eq("slug", data.slug)
      .select("*").single();
    if (error) throw new Error(error.message);
    return { page: row as unknown as ContentPageRow };
  });
