import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Logo } from "@/components/Logo";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  head: () => ({ meta: [{ title: "Sign in — Buffr" }] }),
});

function friendlyAuthError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("email not confirmed")) return "Please verify your email first. Check your inbox for the confirmation link.";
  if (m.includes("invalid login") || m.includes("invalid credentials")) return "Incorrect email or password.";
  if (m.includes("network") || m.includes("failed to fetch")) return "Network error. Check your connection and try again.";
  if (m.includes("rate limit")) return "Too many attempts. Please wait a moment and try again.";
  return msg || "Sign in failed. Please try again.";
}

function LoginPage() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const { error, role } = await signIn(email, password);
      if (error) {
        const friendly = friendlyAuthError(error.message);
        setErrorMsg(friendly);
        toast.error(friendly);
        setSubmitting(false);
        return;
      }
      if (role === "admin") router.navigate({ to: "/admin" });
      else if (role === "child") router.navigate({ to: "/student" });
      else if (role === "parent") router.navigate({ to: "/parent" });
      else router.navigate({ to: "/dashboard" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unexpected error";
      setErrorMsg(msg);
      toast.error(msg);
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center px-4" style={{ background: "var(--gradient-hero)" }}>
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center justify-center gap-2 mb-6">
          <Logo size={36} />
          <span className="font-semibold tracking-tight text-lg">Buffr</span>
        </Link>
        <Card>
          <CardContent className="p-6 space-y-4">
            <div>
              <h1 className="text-xl font-semibold">Welcome back</h1>
              <p className="text-sm text-muted-foreground">Sign in to your Buffr account.</p>
            </div>
            {errorMsg && (
              <div role="alert" className="text-sm rounded-md border border-destructive/40 bg-destructive/10 text-destructive px-3 py-2">
                {errorMsg}
              </div>
            )}
            <form className="space-y-3" onSubmit={submit}>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required disabled={submitting} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw">Password</Label>
                <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required disabled={submitting} />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>{submitting ? "Signing in..." : "Sign in"}</Button>
            </form>
            <div className="text-xs text-muted-foreground text-center">
              <Link to="/forgot" className="hover:underline">Forgot password?</Link> · <Link to="/signup" className="hover:underline">Create account</Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
