import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getAuthSnapshot } from "@/lib/auth-server";
import type { Session, User as SupaUser } from "@supabase/supabase-js";

export type AppRole = "admin" | "parent" | "child";

export type Profile = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  parent_id: string | null;
  is_minor: boolean;
  role?: "admin" | "parent" | "child";
  date_of_birth?: string | null;
  sms_opted_out?: boolean;
  status?: "active" | "suspended" | "blocked";
};

type AuthCtx = {
  user: SupaUser | null;
  session: Session | null;
  profile: Profile | null;
  role: AppRole | null;
  loading: boolean;
  authError: string | null;
  signUpParent: (args: {
    name: string;
    email: string;
    phone: string;
    password: string;
  }) => Promise<{ error: Error | null }>;
  signIn: (
    email: string,
    password: string,
  ) => Promise<{ error: Error | null; role: AppRole | null }>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<{ error: Error | null }>;
  updatePassword: (password: string) => Promise<{ error: Error | null }>;
  updateProfile: (
    patch: Partial<Pick<Profile, "name" | "phone" | "avatar_url" | "sms_opted_out">>,
  ) => Promise<{ error: Error | null }>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

const LS_PROFILE = "buffr.profile";
const LS_ROLE = "buffr.role";
const LS_UID = "buffr.uid";

const isBrowser = typeof window !== "undefined";

function readCache(uid: string | null | undefined): {
  profile: Profile | null;
  role: AppRole | null;
} {
  if (!isBrowser || !uid) return { profile: null, role: null };
  try {
    if (localStorage.getItem(LS_UID) !== uid) return { profile: null, role: null };
    const profile = JSON.parse(localStorage.getItem(LS_PROFILE) || "null") as Profile | null;
    const role = (localStorage.getItem(LS_ROLE) as AppRole | null) || null;
    return { profile, role };
  } catch {
    return { profile: null, role: null };
  }
}

function writeCache(uid: string, profile: Profile | null, role: AppRole | null) {
  if (!isBrowser) return;
  try {
    localStorage.setItem(LS_UID, uid);
    if (profile) localStorage.setItem(LS_PROFILE, JSON.stringify(profile));
    if (role) localStorage.setItem(LS_ROLE, role);
  } catch {
    /* ignore */
  }
}

function clearCache() {
  if (!isBrowser) return;
  try {
    localStorage.removeItem(LS_PROFILE);
    localStorage.removeItem(LS_ROLE);
    localStorage.removeItem(LS_UID);
  } catch {
    /* ignore */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const getAuthSnapshotFn = useServerFn(getAuthSnapshot);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<SupaUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const lastFetchedUid = useRef<string | null>(null);

  // Fetch profile + role and persist to localStorage. Returns the resolved role.
  // Throws on hard DB errors so callers can surface them.
  const loadProfileAndRole = async (uid: string, accessToken?: string): Promise<AppRole | null> => {
    const withTimeout = <T,>(p: PromiseLike<T>, ms = 8000): Promise<T> =>
      new Promise((resolve, reject) => {
        const t = setTimeout(
          () => reject(new Error("Database is taking too long to respond. Please try again.")),
          ms,
        );
        Promise.resolve(p).then(
          (v) => {
            clearTimeout(t);
            resolve(v);
          },
          (e) => {
            clearTimeout(t);
            reject(e);
          },
        );
      });

    const applySnapshot = (nextProfile: Profile | null, nextRole: AppRole | null) => {
      setProfile(nextProfile);
      setRole(nextRole);
      setAuthError(null);
      writeCache(uid, nextProfile, nextRole);
      lastFetchedUid.current = uid;
      return nextRole;
    };

    const token = accessToken ?? (await supabase.auth.getSession()).data.session?.access_token;
    if (token) {
      try {
        const snapshot = await withTimeout(
          getAuthSnapshotFn({ data: { accessToken: token } }),
          8000,
        );
        if (snapshot && (snapshot as { ok?: boolean }).ok !== false) {
          return applySnapshot(snapshot.profile as Profile | null, snapshot.role as AppRole | null);
        }
        if ((snapshot as { code?: string } | null)?.code === "INVALID_SESSION") {
          clearCache();
          setProfile(null);
          setRole(null);
          setUser(null);
          setSession(null);
          lastFetchedUid.current = null;
          await supabase.auth.signOut();
          return null;
        }
        console.warn(
          "[auth] server snapshot returned transient state, falling back to client queries",
        );
      } catch (e) {
        if (
          (e as any)?.code === "AUTH_EXPIRED" ||
          (e as Error)?.message?.includes("Auth session missing") ||
          (e as Error)?.message?.includes("session has expired")
        ) {
          clearCache();
          setProfile(null); setRole(null); setUser(null); setSession(null);
          lastFetchedUid.current = null;
          await supabase.auth.signOut();
          return null;
        }
        console.error("[auth] server auth snapshot failed, falling back to client queries:", e);
      }
    }

    const [profRes, roleRes] = await Promise.all([
      withTimeout(supabase.from("users").select("*").eq("id", uid).maybeSingle()),
      withTimeout(supabase.rpc("get_primary_role", { _user_id: uid })),
    ]);
    if (profRes.error) throw new Error(profRes.error.message || "Failed to load profile");
    if (roleRes.error) throw new Error(roleRes.error.message || "Failed to load role");

    return applySnapshot(
      (profRes.data as Profile) ?? null,
      (roleRes.data as AppRole) ?? null,
    );
  };

  useEffect(() => {
    // 1) Hydrate from localStorage synchronously so dashboards render instantly.
    let cachedUid: string | null = null;
    if (isBrowser) {
      cachedUid = localStorage.getItem(LS_UID);
      if (cachedUid) {
        const { profile: cp, role: cr } = readCache(cachedUid);
        if (cp) setProfile(cp);
        if (cr) setRole(cr);
      }
    }

    // 2) Set up listener BEFORE getSession.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      const uid = sess?.user?.id ?? null;
      if (!uid) {
        setProfile(null);
        setRole(null);
        setAuthError(null);
        clearCache();
        lastFetchedUid.current = null;
        return;
      }
      // Hydrate from cache instantly for this uid
      const { profile: cp, role: cr } = readCache(uid);
      if (cp) setProfile(cp);
      if (cr) setRole(cr);
      // Refresh from server in background (deferred to avoid auth callback deadlocks)
      if (lastFetchedUid.current !== uid) {
        setTimeout(() => {
          loadProfileAndRole(uid).catch((e) => {
            console.error("[auth] background profile refresh failed:", e);
            setAuthError(e instanceof Error ? e.message : "Failed to refresh your account data.");
          });
        }, 0);
      }
    });

    // 3) Get current session
    supabase.auth
      .getSession()
      .then(({ data: { session: sess } }) => {
        setSession(sess);
        setUser(sess?.user ?? null);
        const uid = sess?.user?.id ?? null;
        if (!uid) {
          clearCache();
          setAuthError(null);
          setLoading(false);
          return;
        }
        const cached = readCache(uid);
        if (cached.profile && cached.role) {
          // We can render immediately; refresh in background
          setProfile(cached.profile);
          setRole(cached.role);
          setLoading(false);
          loadProfileAndRole(uid, sess?.access_token).catch((e) =>
            console.error("[auth] background refresh failed:", e),
          );
        } else {
          loadProfileAndRole(uid, sess?.access_token)
            .catch((e) => {
              console.error("[auth] initial profile load failed:", e);
              setAuthError(e instanceof Error ? e.message : "Failed to load your account data.");
            })
            .finally(() => setLoading(false));
        }
      })
      .catch((e) => {
        console.error("[auth] getSession failed:", e);
        setLoading(false);
      });

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: AuthCtx = {
    user,
    session,
    profile,
    role,
    loading,
    authError,
    signUpParent: async ({ name, email, phone, password }) => {
      try {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/login`,
            data: { name, phone, role: "parent" },
          },
        });
        return { error };
      } catch (e) {
        return { error: e instanceof Error ? e : new Error("Network error during signup") };
      }
    },
    signIn: async (email, password) => {
      try {
        setAuthError(null);
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error || !data.user) return { error, role: null };
        // Eagerly load role so the caller can navigate to the right dashboard immediately.
        try {
          const r = await loadProfileAndRole(data.user.id, data.session?.access_token);
          // Block suspended / blocked accounts at sign-in.
          // Re-read the freshly cached profile from state via loadProfileAndRole's snapshot.
          const status = (await supabase.from("users").select("status").eq("id", data.user.id).maybeSingle())
            .data?.status as "active" | "suspended" | "blocked" | undefined;
          if (status === "blocked" || status === "suspended") {
            await supabase.auth.signOut();
            clearCache();
            setProfile(null);
            setRole(null);
            const msg =
              status === "blocked"
                ? "Your account has been blocked. Please contact support."
                : "Your account is suspended. Please contact support.";
            setAuthError(msg);
            return { error: new Error(msg), role: null };
          }
          return { error: null, role: r };
        } catch (e) {
          console.error("[auth] role lookup failed after sign in:", e);
          setAuthError(e instanceof Error ? e.message : "Failed to load your account data.");
          // Auth succeeded; let the dashboard redirector retry.
          return { error: null, role: null };
        }
      } catch (e) {
        return {
          error: e instanceof Error ? e : new Error("Network error during sign in"),
          role: null,
        };
      }
    },
    signOut: async () => {
      await supabase.auth.signOut();
      setProfile(null);
      setRole(null);
      setAuthError(null);
      clearCache();
    },
    sendPasswordReset: async (email) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      return { error };
    },
    updatePassword: async (password) => {
      const { error } = await supabase.auth.updateUser({ password });
      return { error };
    },
    updateProfile: async (patch) => {
      if (!user) return { error: new Error("Not authenticated") };
      // Cast needed: sms_opted_out not yet in generated Supabase types (migration pending)
      const { error } = await supabase.from("users").update(patch as any).eq("id", user.id);
      if (!error) {
        // Optimistically update cache + state
        const merged = {
          ...(profile ?? {
            id: user.id,
            name: "",
            email: user.email ?? "",
            phone: null,
            avatar_url: null,
            parent_id: null,
          }),
          ...patch,
        } as Profile;
        setProfile(merged);
        writeCache(user.id, merged, role);
        // Refresh from server in background
        void loadProfileAndRole(user.id, session?.access_token).catch((e) =>
          console.error("[auth] profile refresh after update failed:", e),
        );
      }
      return { error };
    },
    refresh: async () => {
      if (user) await loadProfileAndRole(user.id, session?.access_token);
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
