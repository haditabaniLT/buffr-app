import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { flagCategoryLabel, type FlagCategory } from "@/lib/mock-data";
import {
  listMerchants,
  createMerchant,
  updateMerchant,
  deleteMerchant,
  type MerchantRow,
} from "@/lib/admin-server";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/merchants")({ component: AdminMerchants });

type FormState = {
  name: string;
  category: FlagCategory;
  risk_level: "low" | "medium" | "high";
  notes: string;
};

const emptyForm: FormState = { name: "", category: "gambling", risk_level: "high", notes: "" };

function riskClasses(r: MerchantRow["risk_level"]) {
  if (r === "high") return "bg-destructive/10 text-destructive border border-destructive/20";
  if (r === "medium") return "bg-warning/15 text-warning-foreground border border-warning/30";
  return "bg-muted text-muted-foreground";
}

function AdminMerchants() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? "";
  const listFn = useServerFn(listMerchants);
  const createFn = useServerFn(createMerchant);
  const updateFn = useServerFn(updateMerchant);
  const deleteFn = useServerFn(deleteMerchant);

  const [merchants, setMerchants] = useState<MerchantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MerchantRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<MerchantRow | null>(null);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await listFn({ data: { accessToken } });
      setMerchants(res.merchants);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load merchants");
    } finally {
      setLoading(false);
    }
  }, [accessToken, listFn]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(
    () =>
      merchants.filter((m) =>
        q ? m.name.toLowerCase().includes(q.toLowerCase()) : true,
      ),
    [merchants, q],
  );

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (m: MerchantRow) => {
    setEditing(m);
    setForm({
      name: m.name,
      category: m.category,
      risk_level: m.risk_level,
      notes: m.notes ?? "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        const res = await updateFn({ data: { accessToken, id: editing.id, ...form } });
        setMerchants((p) => p.map((m) => (m.id === editing.id ? res.merchant : m)));
        toast.success("Merchant updated");
      } else {
        const res = await createFn({ data: { accessToken, ...form } });
        setMerchants((p) => [res.merchant, ...p]);
        toast.success("Merchant added");
      }
      setDialogOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save merchant");
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    setSubmitting(true);
    try {
      await deleteFn({ data: { accessToken, id: pendingDelete.id } });
      setMerchants((p) => p.filter((m) => m.id !== pendingDelete.id));
      toast.success("Merchant removed");
      setPendingDelete(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove merchant");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Flagged merchants"
        description="Manage the database that powers BetShield's flagging engine."
        actions={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Add merchant</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editing ? "Edit merchant" : "Add merchant"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. DraftKings"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <Select
                    value={form.category}
                    onValueChange={(v) => setForm({ ...form, category: v as FlagCategory })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(flagCategoryLabel) as FlagCategory[]).map((k) => (
                        <SelectItem key={k} value={k}>{flagCategoryLabel[k]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Risk level</Label>
                  <Select
                    value={form.risk_level}
                    onValueChange={(v) => setForm({ ...form, risk_level: v as "low" | "medium" | "high" })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Notes (optional)</Label>
                  <Textarea
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    placeholder="Any context for the flagging engine"
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>Cancel</Button>
                <Button onClick={handleSubmit} disabled={submitting}>
                  {submitting ? "Saving..." : editing ? "Save changes" : "Add merchant"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Search merchants..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Risk</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                  No flagged merchants yet. Add one to get started.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell>{flagCategoryLabel[m.category]}</TableCell>
                  <TableCell>
                    <Badge className={riskClasses(m.risk_level)}>{m.risk_level}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-xs truncate">
                    {m.notes ?? "—"}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(m)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setPendingDelete(m)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this merchant?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `“${pendingDelete.name}” will no longer be checked by the flagging engine. Existing flagged transactions will not be affected.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} disabled={submitting}>
              {submitting ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
