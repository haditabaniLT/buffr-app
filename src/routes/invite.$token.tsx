import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { createInvitedChild } from "@/lib/children-server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Mail, LogIn } from "lucide-react";
import { Logo } from "@/components/Logo";
import { toast } from "sonner";

export const Route = createFileRoute("/invite/$token")({
  component: InviteAccept,
  head: () => ({ meta: [{ title: "Accept invitation — Buffr" }] }),
});

type Invitation = {
  email: string;
  status: "pending" | "accepted" | "expired";
  parent_name: string | null;
  expires_at: string;
};

/**
 * Invite acceptance flow:
 *
 *  Step "create"  → child enters name + password → account created (email NOT auto-confirmed)
 *                   → Supabase sends a verification email
 *  Step "verify"  → child is told to check their email; a sign-in form is shown so
 *                   they can log in once they've clicked the verification link
 *  Step "done"    → invite accepted, child is redirected to /student
 *
 * If the child is ALREADY signed in when the page loads (e.g. after clicking the
 * Supabase email-confirmation link which redirects back to the app), we call
 * accept_invitation immediately and skip to "done".
 */
function InviteAccept() {
  const { token } = Route.useParams();
  const router = useRouter();
  const createInvitedChildFn = useServerFn(createInvitedChild);

  const [loading, setLoading]     = useState(true);
  const [invite, setInvite]       = useState<Invitation | null>(null);

  // "create" → "verify" → "done"
  const [step, setStep]           = useState<"create" | "verify" | "done">("create");
  const [name, setName]           = useState("");
  const [password, setPassword]   = useState("");
  const [signInPw, setSignInPw]   = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [signingIn, setSigningIn]   = useState(false);

  // ── Load invitation ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase.rpc("get_invitation_by_token", { _token: token });
      const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
      if (!cancelled) {
        setInvite(row as Invitation | null);
        setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [token]);

  // ── Auto-accept when already signed in ──────────────────────────────────────
  // Fires if the child clicks the Supabase email-verification link (which signs
  // them in automatically) and Supabase redirects back to this URL.
  useEffect(() => {
    const checkAndAccept = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !invite) return;
      if (invite.status !== "pending") return;
      // Email in session must match invite email
      if (session.user.email?.toLowerCase() !== invite.email.toLowerCase()) return;
      await acceptAndContinue();
    };
    if (!loading && invite) void checkAndAccept();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, invite]);

  // ── accept_invitation RPC + redirect ────────────────────────────────────────
  const acceptAndContinue = async () => {
    const { error } = await supabase.rpc("accept_invitation", { _token: token });
    if (error) {
      toast.error(error.message || "Could not accept invitation");
      return;
    }
    toast.success("You're linked with your advocate!");
    setStep("done");
    // Small delay so the success toast is visible before navigating
    setTimeout(() => router.navigate({ to: "/student" }), 1200);
  };

  // ── Step 1: Create account ───────────────────────────────────────────────────
  const createAccount = async () => {
    if (!invite) return;
    if (!name.trim()) { toast.error("Enter your full name."); return; }
    if (!password || password.length < 6) { toast.error("Password must be at least 6 characters."); return; }
    setSubmitting(true);
    try {
      // Validate token server-side first (security check)
      await createInvitedChildFn({ data: { token, name: name.trim(), password } });

      // Create the account client-side so Supabase sends a real verification email.
      // handle_new_user will detect the pending invitation and assign 'child' role.
      const { error: signUpErr } = await supabase.auth.signUp({
        email: invite.email,
        password,
        options: {
          data: { name: name.trim() },
          // After email verification Supabase redirects back here so we can
          // auto-complete the accept_invitation step.
          emailRedirectTo: `${window.location.origin}/invite/${token}`,
        },
      });
      if (signUpErr) {
        if (/already registered/i.test(signUpErr.message)) {
          throw new Error("An account with this email already exists. Sign in instead.");
        }
        throw new Error(signUpErr.message || "Failed to create account.");
      }

      setStep("verify");
      toast.success("Account created! Check your email for a verification link.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Step 2: Sign in after email is verified ──────────────────────────────────
  const signInAfterVerify = async () => {
    if (!invite) return;
    if (!signInPw) { toast.error("Enter your password."); return; }
    setSigningIn(true);
    try {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: invite.email,
        password: signInPw,
      });
      if (signInErr) {
        if (/not confirmed/i.test(signInErr.message)) {
          toast.error("Email not verified yet. Please click the link in the verification email first.");
        } else {
          toast.error(signInErr.message || "Sign-in failed.");
        }
        return;
      }
      await acceptAndContinue();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSigningIn(false);
    }
  };

  // ── Render: loading ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <Centered>
        <Card><CardContent className="p-6">
          <p className="text-sm text-muted-foreground">Loading invitation…</p>
        </CardContent></Card>
      </Centered>
    );
  }

  // ── Render: invite not found ─────────────────────────────────────────────────
  if (!invite) {
    return (
      <Centered>
        <Card><CardContent className="p-6 space-y-3">
          <h1 className="text-lg font-semibold">Invitation not found</h1>
          <p className="text-sm text-muted-foreground">
            This invitation link is invalid or has expired. Ask your advocate to send a new one.
          </p>
          <Button onClick={() => router.navigate({ to: "/" })}>Go home</Button>
        </CardContent></Card>
      </Centered>
    );
  }

  // ── Render: already accepted ─────────────────────────────────────────────────
  if (invite.status === "accepted") {
    return (
      <Centered>
        <Card><CardContent className="p-6 space-y-3">
          <h1 className="text-lg font-semibold">Invitation already used</h1>
          <p className="text-sm text-muted-foreground">
            This invitation has already been accepted. Sign in to access your dashboard.
          </p>
          <Button onClick={() => router.navigate({ to: "/login" })}>Sign in</Button>
        </CardContent></Card>
      </Centered>
    );
  }

  // ── Render: main flow ────────────────────────────────────────────────────────
  return (
    <Centered>
      <div className="flex items-center justify-center gap-2 mb-6">
        <Logo size={28} />
        <span className="font-semibold">Buffr invitation</span>
      </div>

      {/* Step 1 — Create account */}
      {step === "create" && (
        <Card><CardContent className="p-6 space-y-4">
          <div>
            <h1 className="text-xl font-semibold">You've been invited</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {invite.parent_name
                ? <><span className="font-medium text-foreground">{invite.parent_name}</span> invited you</>
                : "You were invited"}{" "}
              to join Buffr as a Student. Create your login to continue.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input value={invite.email} disabled />
          </div>
          <div className="space-y-1.5">
            <Label>Full name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Password</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              onKeyDown={(e) => { if (e.key === "Enter") createAccount(); }}
            />
          </div>

          <Button className="w-full" onClick={createAccount} disabled={submitting}>
            {submitting ? "Creating account…" : "Create account"}
          </Button>
        </CardContent></Card>
      )}

      {/* Step 2 — Verify email + sign in */}
      {step === "verify" && (
        <Card><CardContent className="p-6 space-y-5">
          <div className="flex flex-col items-center text-center gap-3">
            <Mail className="h-10 w-10 text-primary" />
            <div>
              <h2 className="text-xl font-semibold">Check your email</h2>
              <p className="text-sm text-muted-foreground mt-1">
                We sent a verification link to{" "}
                <span className="font-medium text-foreground">{invite.email}</span>.
                Click it to verify your email, then sign in below.
              </p>
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center gap-2">
              <LogIn className="h-4 w-4 text-muted-foreground shrink-0" />
              <p className="text-sm font-medium">Sign in after verifying</p>
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={invite.email} disabled />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input
                type="password"
                value={signInPw}
                onChange={(e) => setSignInPw(e.target.value)}
                placeholder="Your password"
                onKeyDown={(e) => { if (e.key === "Enter") signInAfterVerify(); }}
              />
            </div>
            <Button className="w-full" onClick={signInAfterVerify} disabled={signingIn}>
              {signingIn ? "Signing in…" : "Sign in & activate account"}
            </Button>
          </div>

          <p className="text-xs text-center text-muted-foreground">
            Didn't receive the email?{" "}
            <button
              className="underline hover:text-foreground"
              onClick={() => setStep("create")}
            >
              Go back
            </button>
          </p>
        </CardContent></Card>
      )}

      {/* Step 3 — Done */}
      {step === "done" && (
        <Card><CardContent className="p-6 space-y-4 text-center">
          <CheckCircle2 className="h-10 w-10 text-primary mx-auto" />
          <h2 className="text-lg font-semibold">You're all set!</h2>
          <p className="text-sm text-muted-foreground">
            Your account is linked with your advocate's monitoring dashboard.
          </p>
          <Button onClick={() => router.navigate({ to: "/student" })}>
            Go to your dashboard
          </Button>
        </CardContent></Card>
      )}
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen grid place-items-center px-4 py-10"
      style={{ background: "var(--gradient-hero)" }}
    >
      <div className="w-full max-w-xl">{children}</div>
    </div>
  );
}
