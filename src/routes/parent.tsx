import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/parent")({ component: ParentLayout });

function ParentLayout() {
  const { user, role, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (!user) router.navigate({ to: "/login" });
    else if (role && role !== "parent") router.navigate({ to: role === "admin" ? "/admin" : "/student" }); /* /student URL serves child role */
  }, [user, role, loading, router]);
  if (loading || !user || role !== "parent") return null;
  return <AppShell><Outlet /></AppShell>;
}
