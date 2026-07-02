import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/parent/settings")({ component: ParentSettings });

function ParentSettings() {
  const { profile, user, updateProfile, updatePassword } = useAuth();
  const [name,        setName]        = useState("");
  const [phone,       setPhone]       = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [savingPw,    setSavingPw]    = useState(false);

  // smsEnabled = true means the user wants alerts (sms_opted_out = false)
  const [smsEnabled,  setSmsEnabled]  = useState(true);
  const [savingSms,   setSavingSms]   = useState(false);

  useEffect(() => {
    if (profile) {
      setName(profile.name ?? "");
      setPhone(profile.phone ?? "");
      // Initialise toggle from DB value — default to enabled if column not yet present
      setSmsEnabled(!(profile.sms_opted_out ?? false));
    }
  }, [profile]);

  if (!user || !profile) return null;

  const saveProfile = async () => {
    setSavingProfile(true);
    const { error } = await updateProfile({ name, phone });
    setSavingProfile(false);
    if (error) toast.error(error.message); else toast.success("Profile updated.");
  };

  const changePw = async () => {
    if (newPassword.length < 6) { toast.error("Password must be at least 6 characters."); return; }
    setSavingPw(true);
    const { error } = await updatePassword(newPassword);
    setSavingPw(false);
    if (error) toast.error(error.message);
    else { toast.success("Password updated."); setNewPassword(""); }
  };

  const toggleSms = async (enabled: boolean) => {
    setSmsEnabled(enabled);
    setSavingSms(true);
    const { error } = await updateProfile({ sms_opted_out: !enabled });
    setSavingSms(false);
    if (error) {
      toast.error(error.message);
      setSmsEnabled(!enabled); // revert on failure
    } else {
      toast.success(enabled ? "SMS alerts enabled." : "SMS alerts disabled. Reply START to re-enable.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Account, security, and notification preferences." />
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-5 space-y-3">
            <h2 className="font-semibold">Profile</h2>
            <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Email</Label><Input value={profile.email} disabled /></div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 (555) 000-0000" />
            </div>
            <Button onClick={saveProfile} disabled={savingProfile}>{savingProfile ? "Saving…" : "Save"}</Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-3">
            <h2 className="font-semibold">Security</h2>
            <div className="space-y-1.5"><Label>New password</Label><Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></div>
            <Button onClick={changePw} disabled={savingPw || !newPassword}>{savingPw ? "Updating…" : "Update password"}</Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardContent className="p-5 space-y-4">
            <h2 className="font-semibold">Notifications</h2>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">SMS alerts</div>
                <div className="text-xs text-muted-foreground">
                  Receive a text when Buffr flags a transaction on a linked account.
                  {!smsEnabled && (
                    <span className="block mt-0.5 text-destructive">
                      Disabled — text START to your Buffr number or toggle on to re-enable.
                    </span>
                  )}
                </div>
              </div>
              <Switch checked={smsEnabled} onCheckedChange={toggleSms} disabled={savingSms} />
            </div>
            <p className="text-xs text-muted-foreground">
              You can also reply <strong>STOP</strong> to any Buffr SMS to opt out, or{" "}
              <strong>START</strong> to re-subscribe. Msg &amp; data rates may apply.{" "}
              See our{" "}
              <Link to="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
