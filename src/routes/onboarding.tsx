/**
 * Post-signup onboarding flow — 3 steps:
 *  1. Confirm email / sign in  (shown only when not yet authenticated)
 *  2. Add child account        (skip available)
 *  3. Connect bank account     (skip available)
 *
 * After completing or skipping both optional steps the parent lands on /parent.
 */
import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { usePlaidLink } from "react-plaid-link";
import { useAuth } from "@/lib/auth";
import { createParentChild } from "@/lib/children-server";
import { createPlaidLinkToken, exchangePlaidPublicToken } from "@/lib/plaid-server";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Logo } from "@/components/Logo";
import { toast } from "sonner";
import { CheckCircle2, ArrowRight, Building2, UserPlus } from "lucide-react";

export const Route = createFileRoute("/onboarding")({ component: Onboarding });

type Step = "confirm" | "add_child" | "bank" | "done";

async function getAccessToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

// ── Step indicator ────────────────────────────────────────────────────────────
function StepDots({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {([1, 2, 3] as const).map((n) => (
        <div
          key={n}
          className={`h-2 rounded-full transition-all ${
            n === current ? "w-6 bg-primary" : n < current ? "w-2 bg-primary/50" : "w-2 bg-muted"
          }`}
        />
      ))}
    </div>
  );
}

// ── Plaid connect button used in step 3 ──────────────────────────────────────
function PlaidConnectButton({ onSuccess }: { onSuccess: () => void }) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const createLinkTokenFn  = useServerFn(createPlaidLinkToken);
  const exchangeFn         = useServerFn(exchangePlaidPublicToken);

  const fetchToken = async () => {
    setLoading(true);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) { toast.error("Please sign in first."); return; }
      const res = await createLinkTokenFn({ data: { accessToken } });
      setLinkToken(res.link_token);
    } catch (err: any) {
      toast.error(err?.message ?? "Could not start bank linking.");
    } finally { setLoading(false); }
  };

  const handleSuccess = useCallback(async (publicToken: string, metadata: any) => {
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) { toast.error("Session expired. Please sign in."); return; }
      await exchangeFn({
        data: { accessToken, publicToken, institutionName: metadata?.institution?.name },
      });
      toast.success(`Bank connected successfully.`);
      setLinkToken(null);
      onSuccess();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to save bank account.");
    }
  }, [exchangeFn, onSuccess]);

  const { open, ready } = usePlaidLink({ token: linkToken ?? "", onSuccess: handleSuccess });

  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  return (
    <Button onClick={fetchToken} disabled={loading} className="w-full sm:w-auto">
      <Building2 className="h-4 w-4 mr-2" />
      {loading ? "Loading…" : "Connect bank account"}
    </Button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
function Onboarding() {
  const { user, signIn } = useAuth();
  const router = useRouter();
  const createParentChildFn = useServerFn(createParentChild);

  // Start at "confirm" if not authenticated, otherwise skip straight to add_child
  const [step, setStep] = useState<Step>(user ? "add_child" : "confirm");

  // Sign-in form state (for the "confirm" step)
  const [siEmail, setSiEmail]       = useState("");
  const [siPassword, setSiPassword] = useState("");
  const [siLoading, setSiLoading]   = useState(false);

  // Add child form state
  const [childName,  setChildName]  = useState("");
  const [childEmail, setChildEmail] = useState("");
  const [childDob,   setChildDob]   = useState("");
  const [addingChild, setAddingChild] = useState(false);

  // Sync step when auth state resolves (e.g. page loads while already logged in)
  useEffect(() => {
    if (user && step === "confirm") setStep("add_child");
  }, [user, step]);

  // ── Sign in ─────────────────────────────────────────────────────────────────
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setSiLoading(true);
    try {
      const { error } = await signIn(siEmail, siPassword);
      if (error) {
        toast.error(error.message || "Sign-in failed. Please try again.");
        return;
      }
      setStep("add_child");
    } finally {
      setSiLoading(false);
    }
  };

  // ── Add child ────────────────────────────────────────────────────────────────
  const handleAddChild = async () => {
    if (!childName.trim() || !childEmail.trim() || !childDob) {
      toast.error("Please fill in name, email, and date of birth.");
      return;
    }
    setAddingChild(true);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) { toast.error("Session expired. Please sign in."); return; }
      const result = await createParentChildFn({
        data: { accessToken, name: childName.trim(), email: childEmail.trim(), dob: childDob },
      });
      if (result.mode === "invitation") {
        toast.success(`Invitation sent to ${childEmail}.`);
      } else {
        toast.success("Child account created.");
      }
      setStep("bank");
    } catch (err: any) {
      toast.error(err?.message ?? "Could not add child account.");
    } finally {
      setAddingChild(false);
    }
  };

  return (
    <div
      className="min-h-screen grid place-items-center px-4 py-10"
      style={{ background: "var(--gradient-hero)" }}
    >
      <div className="w-full max-w-md">
        {/* Logo */}
        <Link to="/" className="flex items-center justify-center gap-2 mb-6">
          <Logo size={28} />
          <span className="font-semibold tracking-tight">Buffr</span>
        </Link>

        {/* ── Step 1: Confirm email / sign in ─────────────────────────────── */}
        {step === "confirm" && (
          <Card>
            <CardContent className="p-6 space-y-5">
              <div className="text-center space-y-1">
                <div className="h-12 w-12 rounded-full bg-accent grid place-items-center mx-auto mb-3">
                  <CheckCircle2 className="h-6 w-6 text-accent-foreground" />
                </div>
                <h1 className="text-xl font-semibold">Account created!</h1>
                <p className="text-sm text-muted-foreground">
                  Check your email to verify your address, then sign in below to complete your setup.
                </p>
              </div>

              <form className="space-y-3" onSubmit={handleSignIn}>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    placeholder="you@example.com"
                    value={siEmail}
                    onChange={(e) => setSiEmail(e.target.value)}
                    required
                    disabled={siLoading}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Password</Label>
                  <Input
                    type="password"
                    value={siPassword}
                    onChange={(e) => setSiPassword(e.target.value)}
                    required
                    disabled={siLoading}
                  />
                </div>
                <Button className="w-full" type="submit" disabled={siLoading}>
                  {siLoading ? "Signing in…" : "Sign in and continue"}
                </Button>
              </form>

              <p className="text-xs text-center text-muted-foreground">
                Already set up?{" "}
                <button
                  className="hover:underline text-foreground"
                  onClick={() => router.navigate({ to: "/parent" })}
                >
                  Go to dashboard
                </button>
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── Step 2: Add child ────────────────────────────────────────────── */}
        {step === "add_child" && (
          <Card>
            <CardContent className="p-6 space-y-5">
              <StepDots current={1} />
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-lg bg-accent grid place-items-center shrink-0">
                  <UserPlus className="h-5 w-5 text-accent-foreground" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Add your child's account</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    We'll set up monitoring for their transactions. You can always add more children later.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Full name</Label>
                  <Input
                    value={childName}
                    onChange={(e) => setChildName(e.target.value)}
                    placeholder="e.g. Alex Mitchell"
                    disabled={addingChild}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={childEmail}
                    onChange={(e) => setChildEmail(e.target.value)}
                    placeholder="teen@example.com"
                    disabled={addingChild}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Date of birth</Label>
                  <Input
                    type="date"
                    value={childDob}
                    onChange={(e) => setChildDob(e.target.value)}
                    disabled={addingChild}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  If your teen is 18+, they'll receive an email invitation to connect their own account.
                  Under 18? We'll create the account on their behalf.
                </p>
              </div>

              <div className="flex gap-2 pt-1">
                <Button onClick={handleAddChild} disabled={addingChild} className="flex-1">
                  <ArrowRight className="h-4 w-4 mr-1" />
                  {addingChild ? "Adding…" : "Add child"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setStep("bank")}
                  disabled={addingChild}
                >
                  Skip for now
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Step 3: Connect bank ─────────────────────────────────────────── */}
        {step === "bank" && (
          <Card>
            <CardContent className="p-6 space-y-5">
              <StepDots current={2} />
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-lg bg-accent grid place-items-center shrink-0">
                  <Building2 className="h-5 w-5 text-accent-foreground" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Connect a bank account</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Securely link a bank account via Plaid so Buffr can monitor transactions for
                    risk signals. You can connect more accounts from the dashboard at any time.
                  </p>
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <PlaidConnectButton onSuccess={() => setStep("done")} />
                <Button variant="outline" onClick={() => setStep("done")}>
                  Skip for now
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Done ────────────────────────────────────────────────────────────── */}
        {step === "done" && (
          <Card>
            <CardContent className="p-6 space-y-5 text-center">
              <StepDots current={3} />
              <div className="space-y-2">
                <div className="h-14 w-14 rounded-full bg-primary/10 grid place-items-center mx-auto">
                  <CheckCircle2 className="h-7 w-7 text-primary" />
                </div>
                <h2 className="text-xl font-semibold">You're all set!</h2>
                <p className="text-sm text-muted-foreground">
                  Buffr will notify you the moment any risky financial behavior is detected.
                  You can manage children, bank accounts, and alerts from your dashboard.
                </p>
              </div>
              <Button className="w-full" onClick={() => router.navigate({ to: "/parent" })}>
                Go to dashboard
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
