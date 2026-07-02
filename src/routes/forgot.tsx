import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/forgot")({
  component: ForgotPage,
  head: () => ({ meta: [{ title: "Reset password — Buffr" }] }),
});

function ForgotPage() {
  const { sendPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setSubmitting(true);
    const { error } = await sendPasswordReset(email);
    setSubmitting(false);
    if (error) {
      toast.error(error.message || "Could not send reset email");
      return;
    }
    setSent(true);
    toast.success("Reset email sent");
  };

  return (
    <div className="min-h-screen grid place-items-center px-4" style={{ background: "var(--gradient-hero)" }}>
      <Card className="w-full max-w-md">
        <CardContent className="p-6 space-y-4">
          <h1 className="text-xl font-semibold">Reset your password</h1>
          {sent ? (
            <p className="text-sm text-muted-foreground">If an account exists for <strong>{email}</strong>, we've sent reset instructions. Check your inbox and follow the link.</p>
          ) : (
            <form className="space-y-3" onSubmit={submit}>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <Button className="w-full" disabled={submitting}>{submitting ? "Sending..." : "Send reset link"}</Button>
            </form>
          )}
          <Link to="/login" className="text-xs text-muted-foreground hover:underline">Back to sign in</Link>
        </CardContent>
      </Card>
    </div>
  );
}
