import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/dashboard")({
  component: DashboardRedirect,
  head: () => ({ meta: [{ title: "Redirecting… — Buffr" }] }),
});

function DashboardRedirect() {
  const { user, role, profile, loading, authError, refresh, signOut } = useAuth();
  const router = useRouter();
  const [retryCount, setRetryCount] = useState(0);
  const [timedOut, setTimedOut] = useState(false);

  // Resolve an effective role. If role column is missing for any reason, infer
  // from the profile (parent_id => child, otherwise parent) so we don't dead-end.
  const effectiveRole = role ?? (profile ? (profile.parent_id ? "child" : "parent") : null);

  // If role doesn't arrive quickly, retry once and then show a real error instead of spinning forever.
  useEffect(() => {
    if (loading || !user || effectiveRole) return;
    const t = setTimeout(() => {
      if (retryCount === 0) {
        setRetryCount(1);
        void refresh().catch(() => setTimedOut(true));
      } else {
        setTimedOut(true);
      }
    }, retryCount === 0 ? 1500 : 5000);
    return () => clearTimeout(t);
  }, [loading, user, effectiveRole, retryCount, refresh]);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.navigate({ to: "/login" });
      return;
    }
    if (!effectiveRole) return;
    if (effectiveRole === "admin") router.navigate({ to: "/admin" });
    else if (effectiveRole === "child") router.navigate({ to: "/student" });
    else router.navigate({ to: "/parent" });
  }, [user, effectiveRole, loading, router]);

  return (
    <div className="min-h-screen grid place-items-center px-4 text-sm text-muted-foreground">
      {timedOut || authError ? (
        <div className="max-w-md space-y-4 text-center">
          <div>
            <h1 className="text-lg font-semibold text-foreground">We couldn't load your dashboard</h1>
            <p className="mt-2">{authError || "Your account role is still unavailable. Please retry or sign in again."}</p>
          </div>
          <div className="flex justify-center gap-2">
            <Button onClick={() => { setTimedOut(false); setRetryCount(0); void refresh(); }}>Retry</Button>
            <Button variant="outline" onClick={() => { void signOut().then(() => router.navigate({ to: "/login" })); }}>Sign in again</Button>
          </div>
        </div>
      ) : (
        "Loading your dashboard…"
      )}
    </div>
  );
}
