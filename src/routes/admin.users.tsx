import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/AppShell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/lib/auth";
import { adminListUsers, adminSetUserStatus, type AdminUserRow } from "@/lib/admin-server";
import { toast } from "sonner";
import { Ban, CheckCircle2, PauseCircle, User as UserIcon, Mail, Phone, Calendar } from "lucide-react";

export const Route = createFileRoute("/admin/users")({ component: AdminUsers });

type FilterRole = "all" | "parent" | "child";
type StatusAction = "active" | "suspended" | "blocked";

function statusClasses(s: AdminUserRow["status"]) {
  if (s === "active") return "bg-success/10 text-success border border-success/20";
  if (s === "blocked") return "bg-destructive/10 text-destructive border border-destructive/20";
  return "bg-warning/15 text-warning-foreground border border-warning/30";
}

function actionLabel(a: StatusAction) {
  return a === "active" ? "Activate" : a === "suspended" ? "Suspend" : "Block";
}

function actionDescription(a: StatusAction, name: string) {
  if (a === "blocked") {
    return `${name} will be signed out immediately and prevented from logging back in.`;
  }
  if (a === "suspended") {
    return `${name}'s access will be paused. They will be signed out and unable to sign back in until reactivated.`;
  }
  return `${name} will regain full access to their account.`;
}

function AdminUsers() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? "";
  const listFn = useServerFn(adminListUsers);
  const setStatusFn = useServerFn(adminSetUserStatus);

  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<FilterRole>("all");
  const [selected, setSelected] = useState<AdminUserRow | null>(null);
  const [pendingAction, setPendingAction] = useState<{ user: AdminUserRow; action: StatusAction } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await listFn({ data: { accessToken } });
      setUsers(res.users);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [accessToken, listFn]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(
    () =>
      users
        .filter((u) => (roleFilter === "all" ? true : u.role === roleFilter))
        .filter((u) => {
          if (!q) return true;
          const hay = `${u.name} ${u.email} ${u.parent_name ?? ""}`.toLowerCase();
          return hay.includes(q.toLowerCase());
        }),
    [users, q, roleFilter],
  );

  const handleConfirmStatus = async () => {
    if (!pendingAction) return;
    setSubmitting(true);
    try {
      await setStatusFn({
        data: { accessToken, userId: pendingAction.user.id, status: pendingAction.action },
      });
      setUsers((prev) =>
        prev.map((u) => (u.id === pendingAction.user.id ? { ...u, status: pendingAction.action } : u)),
      );
      if (selected?.id === pendingAction.user.id) {
        setSelected({ ...selected, status: pendingAction.action });
      }
      toast.success(`${pendingAction.user.name || pendingAction.user.email} ${
        pendingAction.action === "active" ? "activated" : pendingAction.action
      }`);
      setPendingAction(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setSubmitting(false);
    }
  };

  const initials = (name: string, email: string) => {
    const src = name?.trim() || email;
    return src
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join("");
  };

  return (
    <div className="space-y-6">
      <PageHeader title="User management" description="Search, filter, and moderate parent and student accounts." />

      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Search by name, email or parent..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        {(["all", "parent", "child"] as const).map((r) => (
          <Button
            key={r}
            size="sm"
            variant={roleFilter === r ? "default" : "outline"}
            onClick={() => setRoleFilter(r)}
            className="capitalize"
          >
            {r === "all" ? "All" : r === "parent" ? "Parents" : "Students"}
          </Button>
        ))}
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Parent</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                  No users found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((u) => (
                <TableRow
                  key={u.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => setSelected(u)}
                >
                  <TableCell className="font-medium">{u.name || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="capitalize">{u.role ?? "—"}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{u.parent_name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge className={statusClasses(u.status)}>{u.status}</Badge>
                  </TableCell>
                  <TableCell
                    className="text-right space-x-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {u.status !== "active" && (
                      <Button size="sm" variant="outline" onClick={() => setPendingAction({ user: u, action: "active" })}>
                        <CheckCircle2 className="h-4 w-4 mr-1" /> Activate
                      </Button>
                    )}
                    {u.status !== "suspended" && (
                      <Button size="sm" variant="ghost" onClick={() => setPendingAction({ user: u, action: "suspended" })}>
                        <PauseCircle className="h-4 w-4 mr-1" /> Suspend
                      </Button>
                    )}
                    {u.status !== "blocked" && (
                      <Button size="sm" variant="outline" onClick={() => setPendingAction({ user: u, action: "blocked" })}>
                        <Ban className="h-4 w-4 mr-1" /> Block
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Confirmation modal */}
      <AlertDialog open={!!pendingAction} onOpenChange={(o) => !o && setPendingAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction ? `${actionLabel(pendingAction.action)} this user?` : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction
                ? actionDescription(pendingAction.action, pendingAction.user.name || pendingAction.user.email)
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmStatus} disabled={submitting}>
              {submitting ? "Working..." : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* User profile drawer */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <div className="flex items-center gap-3">
                  <Avatar className="h-14 w-14">
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {initials(selected.name, selected.email)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <SheetTitle>{selected.name || selected.email}</SheetTitle>
                    <SheetDescription className="capitalize">
                      {selected.role ?? "user"}
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground">Profile</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" />{selected.email}</div>
                    <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" />{selected.phone || "—"}</div>
                    <div className="flex items-center gap-2"><Calendar className="h-4 w-4 text-muted-foreground" />Joined {new Date(selected.created_at).toLocaleDateString()}</div>
                    {selected.role === "child" && (
                      <div className="flex items-center gap-2"><UserIcon className="h-4 w-4 text-muted-foreground" />Parent: {selected.parent_name ?? "—"}</div>
                    )}
                    <div className="pt-1">
                      <Badge className={statusClasses(selected.status)}>{selected.status}</Badge>
                    </div>
                  </div>
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-muted-foreground">Actions</h3>
                  <div className="flex flex-wrap gap-2">
                    {selected.status !== "active" && (
                      <Button size="sm" variant="outline" onClick={() => setPendingAction({ user: selected, action: "active" })}>
                        <CheckCircle2 className="h-4 w-4 mr-1" /> Activate
                      </Button>
                    )}
                    {selected.status !== "suspended" && (
                      <Button size="sm" variant="ghost" onClick={() => setPendingAction({ user: selected, action: "suspended" })}>
                        <PauseCircle className="h-4 w-4 mr-1" /> Suspend
                      </Button>
                    )}
                    {selected.status !== "blocked" && (
                      <Button size="sm" variant="outline" onClick={() => setPendingAction({ user: selected, action: "blocked" })}>
                        <Ban className="h-4 w-4 mr-1" /> Block
                      </Button>
                    )}
                  </div>
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-muted-foreground">Recent transactions</h3>
                  <div className="rounded-md border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                    Transactions will appear here once the Plaid integration is connected.
                  </div>
                </section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
