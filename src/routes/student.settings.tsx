import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/student/settings")({ component: StudentSettings });

function StudentSettings() {
  const { profile, user, updateProfile, updatePassword } = useAuth();
  const [name,        setName]        = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPw,   setConfirmPw]   = useState("");
  const [savingPw,    setSavingPw]    = useState(false);

  useEffect(() => {
    if (profile) setName(profile.name ?? "");
  }, [profile]);

  if (!user || !profile) return null;

  const saveProfile = async () => {
    if (!name.trim()) { toast.error("Name cannot be empty."); return; }
    setSavingProfile(true);
    const { error } = await updateProfile({ name: name.trim() });
    setSavingProfile(false);
    if (error) toast.error(error.message); else toast.success("Name updated.");
  };

  const changePw = async () => {
    if (newPassword.length < 8) { toast.error("Password must be at least 8 characters."); return; }
    if (newPassword !== confirmPw) { toast.error("Passwords do not match."); return; }
    setSavingPw(true);
    const { error } = await updatePassword(newPassword);
    setSavingPw(false);
    if (error) toast.error(error.message);
    else { toast.success("Password updated."); setNewPassword(""); setConfirmPw(""); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Manage your account details and security." />

      <div className="grid lg:grid-cols-2 gap-4 max-w-2xl">
        <Card>
          <CardContent className="p-5 space-y-3">
            <h2 className="font-semibold">Profile</h2>
            <div className="space-y-1.5">
              <Label>Full name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={profile.email} disabled className="opacity-60" />
              <p className="text-xs text-muted-foreground">Email cannot be changed here.</p>
            </div>
            <Button onClick={saveProfile} disabled={savingProfile}>
              {savingProfile ? "Saving…" : "Save name"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-3">
            <h2 className="font-semibold">Change password</h2>
            <div className="space-y-1.5">
              <Label>New password</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Confirm password</Label>
              <Input
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
              />
            </div>
            <Button
              onClick={changePw}
              disabled={savingPw || !newPassword || !confirmPw}
            >
              {savingPw ? "Updating…" : "Update password"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
