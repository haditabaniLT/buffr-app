import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Logo } from "@/components/Logo";
import { toast } from "sonner";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
  head: () => ({ meta: [{ title: "Sign up — Buffr" }] }),
});

function friendlySignupError(msg: string): string {
  if (!msg || msg === "{}" || msg === "[]" || /^\s*\{/.test(msg)) return "Signup failed. Please try again.";
  const m = msg.toLowerCase();
  if (m.includes("already registered") || m.includes("user already")) return "An account with this email already exists. Try signing in instead.";
  if (m.includes("email rate limit") || m.includes("email link")) return "Too many signup attempts. Please wait a few minutes and try again.";
  if (m.includes("invalid email")) return "Please enter a valid email address.";
  if (m.includes("password")) return msg;
  if (m.includes("network") || m.includes("failed to fetch")) return "Network error. Check your connection and try again.";
  if (m.includes("rate limit")) return "Too many attempts. Please wait a moment and try again.";
  return msg;
}

function SignupPage() {
  const { signUpParent } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [smsConsent, setSmsConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !phone || !password) return;
    if (!smsConsent) {
      const msg = "Please agree to receive SMS alerts to continue.";
      setErrorMsg(msg); toast.error(msg); return;
    }
    if (password.length < 8) {
      const msg = "Password must be at least 8 characters.";
      setErrorMsg(msg);
      toast.error(msg);
      return;
    }
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const { error } = await signUpParent({ name, email, phone, password });
      setSubmitting(false);
      if (error) {
        console.log("Signup error:", error);
        const friendly = friendlySignupError(error.message);
        setErrorMsg(friendly);
        toast.error(friendly);
        return;
      }
      toast.success("Account created! Check your email to confirm, then complete your setup.");
      router.navigate({ to: "/onboarding" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unexpected error during signup";
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
              <h1 className="text-xl font-semibold">Create your Advocate account</h1>
              <p className="text-sm text-muted-foreground">As the Parent (Advocate), you'll onboard, link accounts, and receive alerts.</p>
            </div>
            {errorMsg && (
              <div role="alert" className="text-sm rounded-md border border-destructive/40 bg-destructive/10 text-destructive px-3 py-2">
                {errorMsg}
              </div>
            )}
            <form className="space-y-3" onSubmit={submit}>
              <div className="space-y-1.5"><Label>Full name</Label><Input value={name} onChange={(e) => setName(e.target.value)} required disabled={submitting} /></div>
              <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={submitting} /></div>
              <div className="space-y-1.5"><Label>Phone number</Label><Input type="tel" placeholder="+1 (555) 555-5555" value={phone} onChange={(e) => setPhone(e.target.value)} required disabled={submitting} /></div>
              <div className="space-y-1.5"><Label>Password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={submitting} minLength={8} /></div>

              {/* SMS consent — required for A2P 10DLC compliance */}
              <div className="flex items-start gap-2 pt-1">
                <input
                  type="checkbox"
                  id="sms-consent"
                  checked={smsConsent}
                  onChange={(e) => setSmsConsent(e.target.checked)}
                  disabled={submitting}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border accent-primary cursor-pointer"
                />
                <label htmlFor="sms-consent" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
                  By providing your phone number, you agree to receive text alerts from{" "}
                  <span className="font-medium text-foreground">Buffr</span> when risky financial
                  activity is detected. Msg &amp; data rates may apply. Up to 10 msgs/mo.{" "}
                  Reply <span className="font-medium">STOP</span> to opt out,{" "}
                  <span className="font-medium">HELP</span> for help. See our{" "}
                  <Link to="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>{" "}
                  and{" "}
                  <Link to="/terms" className="underline hover:text-foreground">Terms of Service</Link>.
                </label>
              </div>

              <Button className="w-full" type="submit" disabled={submitting || !smsConsent}>{submitting ? "Creating..." : "Create account"}</Button>
            </form>
            <p className="text-xs text-muted-foreground text-center">
              Already have an account? <Link to="/login" className="hover:underline">Sign in</Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
