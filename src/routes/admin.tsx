import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/admin")({ component: AdminLayout });

function AdminLayout() {
  const { user, role, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (!user) router.navigate({ to: "/login" });
    else if (role && role !== "admin") router.navigate({ to: role === "child" ? "/student" : "/parent" });
  }, [user, role, loading, router]);
  if (loading || !user || role !== "admin") return null;
  return <AppShell><Outlet /></AppShell>;
}
