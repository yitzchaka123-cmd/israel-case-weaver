import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

type AccessStatus = "unknown" | "pending" | "approved" | "blocked";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  accessStatus: AccessStatus;
  isAdmin: boolean;
  refreshAccess: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const INVITE_CODE_KEY = "mystudio:pending-invite-code";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessStatus, setAccessStatus] = useState<AccessStatus>("unknown");
  const [isAdmin, setIsAdmin] = useState(false);

  const fetchAccess = useCallback(async (uid: string) => {
    const [{ data: access }, { data: roles }] = await Promise.all([
      supabase.from("user_access").select("status").eq("user_id", uid).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", uid),
    ]);
    setAccessStatus((access?.status as AccessStatus | undefined) ?? "pending");
    setIsAdmin(!!roles?.some((r) => r.role === "admin"));
  }, []);

  const refreshAccess = useCallback(async () => {
    if (session?.user) await fetchAccess(session.user.id);
  }, [session, fetchAccess]);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // After session loads, redeem any pending invite code, then fetch access + subscribe to changes.
  useEffect(() => {
    if (!session?.user) {
      setAccessStatus("unknown");
      setIsAdmin(false);
      return;
    }
    const uid = session.user.id;

    (async () => {
      const code = typeof window !== "undefined" ? sessionStorage.getItem(INVITE_CODE_KEY) : null;
      if (code) {
        sessionStorage.removeItem(INVITE_CODE_KEY);
        try {
          await supabase.rpc("redeem_invite_code", { p_code: code });
        } catch {
          /* swallow — UI will show pending */
        }
      }
      await fetchAccess(uid);
    })();

    const channel = supabase
      .channel(`user-access-${uid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_access", filter: `user_id=eq.${uid}` },
        () => fetchAccess(uid),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_roles", filter: `user_id=eq.${uid}` },
        () => fetchAccess(uid),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session, fetchAccess]);

  const signInWithGoogle = async () => {
    await lovable.auth.signInWithOAuth("google", { redirect_uri: `${window.location.origin}/` });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        accessStatus,
        isAdmin,
        refreshAccess,
        signInWithGoogle,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function stashInviteCode(code: string) {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(INVITE_CODE_KEY, code.trim().toUpperCase());
  }
}
