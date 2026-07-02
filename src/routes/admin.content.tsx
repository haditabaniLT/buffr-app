import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  adminListFaqs, adminCreateFaq, adminUpdateFaq, adminDeleteFaq,
  adminListContentPages, adminUpdateContentPage,
  type FaqRow, type ContentPageRow,
} from "@/lib/admin-server";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Pencil, Trash2, Plus, Save, FileText } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/content")({ component: AdminContent });

async function getToken() {
  return (await supabase.auth.getSession()).data.session?.access_token ?? null;
}

// ── FAQ form dialog ─────────────────────────────────────────────────────────
function FaqDialog({
  open, onClose, initial, onSave,
}: {
  open: boolean;
  onClose: () => void;
  initial?: FaqRow;
  onSave: (q: string, a: string) => Promise<void>;
}) {
  const [q, setQ] = useState(initial?.question ?? "");
  const [a, setA] = useState(initial?.answer ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setQ(initial?.question ?? ""); setA(initial?.answer ?? ""); }
  }, [open, initial]);

  const submit = async () => {
    if (!q.trim() || !a.trim()) { toast.error("Both fields are required."); return; }
    setSaving(true);
    try { await onSave(q.trim(), a.trim()); onClose(); }
    catch (e: any) { toast.error(e?.message ?? "Save failed."); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit FAQ" : "Add FAQ"}</DialogTitle>
          <DialogDescription>Fill in the question and its answer.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Question</Label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="What is Buffr?" />
          </div>
          <div className="space-y-1.5">
            <Label>Answer</Label>
            <Textarea rows={4} value={a} onChange={(e) => setA(e.target.value)} placeholder="Buffr is a parental financial monitoring app…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Content page editor ─────────────────────────────────────────────────────
function ContentEditor({ page, onSaved }: { page: ContentPageRow; onSaved: (updated: ContentPageRow) => void }) {
  const updateFn = useServerFn(adminUpdateContentPage);
  const [body, setBody] = useState(page.body);
  const [saving, setSaving] = useState(false);
  const dirty = body !== page.body;

  const save = async () => {
    setSaving(true);
    try {
      const token = await getToken();
      if (!token) { toast.error("Please sign in again."); return; }
      const res = await updateFn({ data: { accessToken: token, slug: page.slug, body } });
      onSaved(res.page);
      toast.success(`${page.title} saved.`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold">{page.title}</span>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-amber-500 font-medium">Unsaved changes</span>}
          <Button size="sm" onClick={save} disabled={saving || !dirty}>
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
      <Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} className="font-mono text-sm resize-y" />
      <p className="text-xs text-muted-foreground">Last updated: {new Date(page.updated_at).toLocaleString()}</p>
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────
function AdminContent() {
  const listFaqsFn  = useServerFn(adminListFaqs);
  const createFaqFn = useServerFn(adminCreateFaq);
  const updateFaqFn = useServerFn(adminUpdateFaq);
  const deleteFaqFn = useServerFn(adminDeleteFaq);
  const listPagesFn = useServerFn(adminListContentPages);

  const [faqs, setFaqs]   = useState<FaqRow[]>([]);
  const [pages, setPages] = useState<ContentPageRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [faqDialogOpen, setFaqDialogOpen] = useState(false);
  const [editingFaq, setEditingFaq]       = useState<FaqRow | undefined>(undefined);
  const [deletingFaqId, setDeletingFaqId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) { setLoading(false); return; }
    setLoading(true);
    try {
      const [faqRes, pagesRes] = await Promise.all([
        listFaqsFn({ data: { accessToken: token } }),
        listPagesFn({ data: { accessToken: token } }),
      ]);
      setFaqs(faqRes.faqs);
      setPages(pagesRes.pages);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load content.");
    } finally {
      setLoading(false);
    }
  }, [listFaqsFn, listPagesFn]);

  useEffect(() => { load(); }, [load]);

  const handleSaveFaq = async (question: string, answer: string) => {
    const token = await getToken();
    if (!token) throw new Error("Please sign in again.");
    if (editingFaq) {
      const res = await updateFaqFn({ data: { accessToken: token, id: editingFaq.id, question, answer } });
      setFaqs((prev) => prev.map((f) => f.id === res.faq.id ? res.faq : f));
      toast.success("FAQ updated.");
    } else {
      const res = await createFaqFn({ data: { accessToken: token, question, answer, sort_order: faqs.length } });
      setFaqs((prev) => [...prev, res.faq]);
      toast.success("FAQ added.");
    }
  };

  const handleDeleteFaq = async () => {
    if (!deletingFaqId) return;
    const token = await getToken();
    if (!token) { toast.error("Please sign in again."); return; }
    try {
      await deleteFaqFn({ data: { accessToken: token, id: deletingFaqId } });
      setFaqs((prev) => prev.filter((f) => f.id !== deletingFaqId));
      toast.success("FAQ deleted.");
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed.");
    } finally {
      setDeletingFaqId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Content management" description="FAQs, Terms of Service, and Privacy Policy." />

      {loading && (
        <div className="grid lg:grid-cols-2 gap-4">
          {[0, 1].map((i) => (
            <Card key={i}><CardContent className="p-5 space-y-3">
              <div className="h-4 w-32 bg-muted animate-pulse rounded" />
              <div className="h-24 bg-muted animate-pulse rounded" />
            </CardContent></Card>
          ))}
        </div>
      )}

      {!loading && (
        <div className="space-y-6">
          {/* FAQs */}
          <Card>
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">
                  FAQs <span className="text-muted-foreground font-normal text-sm">({faqs.length})</span>
                </h2>
                <Button size="sm" onClick={() => { setEditingFaq(undefined); setFaqDialogOpen(true); }}>
                  <Plus className="h-4 w-4 mr-1.5" /> Add FAQ
                </Button>
              </div>

              {faqs.length === 0 && (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No FAQs yet. Click "Add FAQ" to create one.
                </p>
              )}

              <div className="divide-y">
                {faqs.map((faq, idx) => (
                  <div key={faq.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex items-start gap-3">
                      <span className="text-xs text-muted-foreground mt-0.5 w-5 shrink-0 text-right tabular-nums">{idx + 1}.</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{faq.question}</p>
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{faq.answer}</p>
                        <p className="text-xs text-muted-foreground/60 mt-1.5">
                          Updated {new Date(faq.updated_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          size="sm" variant="ghost" className="h-8 w-8 p-0"
                          onClick={() => { setEditingFaq(faq); setFaqDialogOpen(true); }}
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          onClick={() => setDeletingFaqId(faq.id)}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Terms & Privacy */}
          <div className="grid lg:grid-cols-2 gap-4">
            {pages.map((page) => (
              <Card key={page.slug}>
                <CardContent className="p-5">
                  <ContentEditor page={page} onSaved={(updated) => setPages((prev) => prev.map((p) => p.slug === updated.slug ? updated : p))} />
                </CardContent>
              </Card>
            ))}
            {pages.length === 0 && (
              <Card className="lg:col-span-2">
                <CardContent className="p-5 text-sm text-muted-foreground">
                  No content pages found. Run <code className="bg-muted px-1 rounded">supabase db push</code> to apply the latest migration.
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* FAQ dialog */}
      <FaqDialog
        open={faqDialogOpen}
        onClose={() => { setFaqDialogOpen(false); setEditingFaq(undefined); }}
        initial={editingFaq}
        onSave={handleSaveFaq}
      />

      {/* Delete confirm */}
      <AlertDialog open={!!deletingFaqId} onOpenChange={(o) => !o && setDeletingFaqId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this FAQ?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteFaq}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
