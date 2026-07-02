import { createServerFn } from "@tanstack/react-start";
import { withRetry, requireParent } from "./server-helpers";

// Validates an invite token server-side and returns the associated email.
// Account creation is intentionally left to the client (supabase.auth.signUp)
// so Supabase sends a real verification email through its standard email flow.
// The handle_new_user trigger detects the pending invite and assigns 'child' role.
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

export type ParentChildRow = {
  id: string;
  name: string;
  email: string;
  status: "linked" | "pending" | "accepted" | "expired";
  type: "child" | "invitation";
  createdAt: string;
  under18?: boolean;
  inviteToken?: string;
};

type CreateChildInput = {
  accessToken: string;
  name: string;
  email: string;
  dob: string;
};

function generateToken() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function calcAge(dob: string): number {
  const date = new Date(dob);
  if (Number.isNaN(date.getTime())) return 0;
  const now = new Date();
  let age = now.getFullYear() - date.getFullYear();
  const monthDiff = now.getMonth() - date.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < date.getDate())) age--;
  return age;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function validateInput(input: CreateChildInput) {
  const name = input.name?.trim();
  const email = normalizeEmail(input.email ?? "");
  const age = calcAge(input.dob);

  if (!input.accessToken) throw new Error("Please sign in again before adding a child.");
  if (!name) throw new Error("Full name is required.");
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid email address.");
  if (age <= 0) throw new Error("Enter a valid date of birth.");

  return { name, email, age };
}

export const getParentChildren = createServerFn({ method: "POST" })
  .inputValidator((input: { accessToken: string }) => {
    if (!input?.accessToken) throw new Error("Please sign in again before loading children.");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin, parentId } = await requireParent(data.accessToken);

    const [childrenResult, invitationsResult] = await Promise.all([
      withRetry(async () => {
        const { data: rows, error } = await supabaseAdmin
          .from("users")
          .select("id,name,email,created_at")
          .eq("parent_id", parentId)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return rows ?? [];
      }, "load linked children"),
      withRetry(async () => {
        const { data: rows, error } = await supabaseAdmin
          .from("invitations")
          .select("id,token,email,status,expires_at,created_at")
          .eq("parent_id", parentId)
          .neq("status", "accepted")
          .order("created_at", { ascending: false });
        if (error) throw error;
        return rows ?? [];
      }, "load invitations"),
    ]);

    const linked = childrenResult.map((child) => ({
      id: child.id,
      name: child.name || child.email,
      email: child.email,
      status: "linked" as const,
      type: "child" as const,
      createdAt: child.created_at,
    }));

    const invited = invitationsResult.map((invite) => ({
      id: invite.id,
      name: invite.email,
      email: invite.email,
      status: invite.status === "pending" && new Date(invite.expires_at).getTime() < Date.now()
        ? "expired" as const
        : invite.status as "pending" | "accepted",
      type: "invitation" as const,
      createdAt: invite.created_at,
      inviteToken: invite.token,
    }));

    return { children: [...linked, ...invited].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)) };
  });

export const createParentChild = createServerFn({ method: "POST" })
  .inputValidator((input: CreateChildInput) => input)
  .handler(async ({ data }) => {
    const { name, email, age } = validateInput(data);
    const { supabaseAdmin, parentId } = await requireParent(data.accessToken);

    if (age >= 18) {
      const token = generateToken();
      const invitation = await withRetry(async () => {
        const { data: row, error } = await supabaseAdmin
          .from("invitations")
          .insert({ token, parent_id: parentId, email })
          .select("id,token,email,status,created_at")
          .single();
        if (error) throw error;
        return row;
      }, "create the invitation");

      return {
        mode: "invitation" as const,
        token,
        child: {
          id: invitation.id,
          name: email,
          email,
          status: invitation.status,
          type: "invitation" as const,
          createdAt: invitation.created_at,
          inviteToken: invitation.token,
        },
      };
    }

    // Create an auth user for the child so the handle_new_user trigger
    // creates the profile + user_roles row, then link to parent.
    // We set email_confirm:true (parent-verified) and generate a random temp
    // password — the child will set their own via the activation email below.
    const tempPassword = crypto.randomUUID() + crypto.randomUUID(); // 72-char random, never exposed
    const childUser = await withRetry(async () => {
      const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { name, role: "child" },
        // app_metadata.provisioned signals the handle_new_user trigger
        // to honor the role from user_metadata. Browser signups can't set this.
        app_metadata: { provisioned: true },
      });
      if (error) {
        if (/already (registered|exists)/i.test(error.message)) {
          throw new Error("A user with this email already exists.");
        }
        throw error;
      }
      if (!created.user) throw new Error("Failed to create child account.");
      return created.user;
    }, "create the child account");

    // Link the child profile to this parent, enforce child role, and mark as minor.
    const child = await withRetry(async () => {
      const { data: row, error } = await supabaseAdmin
        .from("users")
        .update({ parent_id: parentId, name, is_minor: true, role: "child", date_of_birth: data.dob } as any)
        .eq("id", childUser.id)
        .select("id,name,email,created_at")
        .single();
      if (error) throw error;
      return row;
    }, "link the child profile");

    // Send a password-reset / activation email so the child can set their own
    // password and log in. Uses Supabase's built-in recovery email flow.
    // Non-fatal: log the error but don't block account creation.
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const anonClient = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_PUBLISHABLE_KEY!,
      );
      // process.env.URL is injected automatically by Netlify with the site's primary URL.
      const siteUrl = process.env.URL ?? process.env.SITE_URL ?? process.env.VITE_SITE_URL ?? "http://localhost:3000";
      await anonClient.auth.resetPasswordForEmail(email, {
        redirectTo: `${siteUrl}/reset-password`,
      });
    } catch (emailErr) {
      console.error("[createParentChild] Could not send activation email:", emailErr);
    }

    return {
      mode: "linked" as const,
      child: {
        id: child.id,
        name: child.name || child.email,
        email: child.email,
        status: "linked" as const,
        type: "child" as const,
        createdAt: child.created_at,
        under18: true,
      },
    };
  });
