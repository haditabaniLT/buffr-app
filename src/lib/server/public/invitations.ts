import { createServerFn } from "@tanstack/react-start";

// Validates an invite token server-side and returns the associated email.
// Account creation is intentionally left to the client (supabase.auth.signUp)
// so Supabase sends a real verification email through its standard email flow.
// The handle_new_user trigger detects the pending invite and assigns 'child' role.
// No session role: the invitee is not signed in yet.
export const createInvitedChild = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string; name: string; password: string }) => {
    if (!input?.token) throw new Error("Missing invitation token.");
    if (!input.name?.trim()) throw new Error("Full name is required.");
    if (!input.password || input.password.length < 6) throw new Error("Password must be at least 6 characters.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Validate the token exists and is still pending
    const { data: rows, error: tokenErr } = await supabaseAdmin.rpc("get_invitation_by_token", { _token: data.token });
    if (tokenErr || !rows?.length) throw new Error("Invalid or expired invitation.");
    const invite = rows[0] as { email: string; status: string; expires_at: string };
    if (invite.status !== "pending") throw new Error("This invitation has already been used.");
    if (new Date(invite.expires_at) < new Date()) throw new Error("This invitation has expired.");

    // Return email so the client can call supabase.auth.signUp() with it.
    // We do NOT create the user here — admin.createUser() does not send a
    // verification email. The client signUp() flow does.
    return { email: invite.email };
  });
