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
  signInWithInviteCode: (code: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

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

  // After session loads, fetch access + subscribe to changes.
  useEffect(() => {
    if (!session?.user) {
      setAccessStatus("unknown");
      setIsAdmin(false);
      return;
    }
    const uid = session.user.id;

    fetchAccess(uid);

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

  const signInWithInviteCode = async (code: string) => {
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-code-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || json.error) throw new Error(json.error ?? "Code login failed");
    const { error } = await supabase.auth.setSession(json.session);
    if (error) throw error;
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
        signInWithInviteCode,
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
