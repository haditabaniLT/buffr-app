import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/student")({ component: StudentLayout });

function StudentLayout() {
  const { user, role, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (!user) router.navigate({ to: "/login" });
    else if (role && role !== "child") router.navigate({ to: role === "admin" ? "/admin" : "/parent" });
  }, [user, role, loading, router]);
  if (loading || !user || role !== "child") return null;
  return <AppShell><Outlet /></AppShell>;
}
