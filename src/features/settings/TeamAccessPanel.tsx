import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Copy, Trash2, Check, X, ShieldCheck, ShieldOff, Plus } from "lucide-react";

type InviteCode = {
  id: string;
  code: string;
  label: string | null;
  max_uses: number | null;
  uses: number;
  expires_at: string | null;
  revoked_at: string | null;
  code_user_id: string | null;
  last_login_at: string | null;
  created_at: string;
};

type Member = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  status: string;
  invite_code_id: string | null;
  approved_at: string | null;
  created_at: string;
};

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const pick = (n: number) =>
    Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `MYST-${pick(4)}`;
}

export function TeamAccessPanel() {
  const { user } = useAuth();
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [adminIds, setAdminIds] = useState<Set<string>>(new Set());
  const [newLabel, setNewLabel] = useState("");
  const [newMaxUses, setNewMaxUses] = useState<string>("");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    const [codesRes, membersRes, rolesRes] = await Promise.all([
      supabase.from("invite_codes").select("*").order("created_at", { ascending: false }),
      supabase.from("user_access").select("*").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("user_id, role").eq("role", "admin"),
    ]);
    if (codesRes.data) setCodes(codesRes.data as InviteCode[]);
    if (membersRes.data) setMembers(membersRes.data as Member[]);
    if (rolesRes.data) setAdminIds(new Set(rolesRes.data.map((r: any) => r.user_id)));
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("team-access")
      .on("postgres_changes", { event: "*", schema: "public", table: "user_access" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_roles" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "invite_codes" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createCode = async () => {
    if (!user) return;
    setCreating(true);
    const code = generateCode();
    const max = newMaxUses ? parseInt(newMaxUses, 10) : null;
    const { error } = await supabase.from("invite_codes").insert({
      code,
      label: newLabel.trim() || null,
      max_uses: Number.isFinite(max as number) && (max as number) > 0 ? max : null,
      created_by: user.id,
    });
    setCreating(false);
    if (error) return toast.error(error.message);
    setNewLabel("");
    setNewMaxUses("");
    toast.success(`Created ${code}`);
  };

  const revoke = async (id: string) => {
    const { error } = await supabase
      .from("invite_codes")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast.error(error.message);
  };

  const deleteCode = async (id: string) => {
    if (!confirm("Delete this code permanently?")) return;
    const { error } = await supabase.from("invite_codes").delete().eq("id", id);
    if (error) toast.error(error.message);
  };

  const setStatus = async (uid: string, status: "approved" | "pending" | "blocked") => {
    const { error } = await supabase.rpc("admin_set_user_status", {
      p_user_id: uid,
      p_status: status,
    });
    if (error) toast.error(error.message);
    else toast.success(`User ${status}`);
  };

  const toggleAdmin = async (uid: string, grant: boolean) => {
    const { error } = await supabase.rpc("admin_set_role", {
      p_user_id: uid,
      p_role: "admin",
      p_grant: grant,
    });
    if (error) toast.error(error.message);
    else toast.success(grant ? "Admin granted" : "Admin removed");
  };

  return (
    <Tabs defaultValue="members">
      <TabsList>
        <TabsTrigger value="members">Members ({members.length})</TabsTrigger>
        <TabsTrigger value="codes">Code logins ({codes.filter((c) => !c.revoked_at).length})</TabsTrigger>
      </TabsList>

      <TabsContent value="members" className="mt-4 space-y-2">
        {members.length === 0 && (
          <p className="text-sm text-muted-foreground">No members yet.</p>
        )}
        {members.map((m) => {
          const isAdmin = adminIds.has(m.user_id);
          const isSelf = m.user_id === user?.id;
          return (
            <div key={m.user_id} className="flex flex-wrap items-center gap-3 border rounded-xl p-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{m.display_name || m.email}</div>
                <div className="text-xs text-muted-foreground truncate">{m.email}</div>
              </div>
              <StatusBadge status={m.status} />
              {isAdmin && <Badge variant="secondary" className="gap-1"><ShieldCheck className="h-3 w-3" />Admin</Badge>}
              <div className="flex gap-1">
                {m.status !== "approved" && (
                  <Button size="sm" variant="outline" onClick={() => setStatus(m.user_id, "approved")}>
                    <Check className="h-3 w-3 mr-1" />Approve
                  </Button>
                )}
                {m.status !== "blocked" && !isSelf && (
                  <Button size="sm" variant="outline" onClick={() => setStatus(m.user_id, "blocked")}>
                    <X className="h-3 w-3 mr-1" />Block
                  </Button>
                )}
                {!isSelf && (
                  isAdmin ? (
                    <Button size="sm" variant="ghost" onClick={() => toggleAdmin(m.user_id, false)}>
                      <ShieldOff className="h-3 w-3 mr-1" />Remove admin
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => toggleAdmin(m.user_id, true)}>
                      <ShieldCheck className="h-3 w-3 mr-1" />Make admin
                    </Button>
                  )
                )}
              </div>
            </div>
          );
        })}
      </TabsContent>

      <TabsContent value="codes" className="mt-4 space-y-4">
        <div className="border rounded-xl p-4 bg-muted/30">
          <div className="text-sm font-medium mb-1">Create code login</div>
          <p className="text-xs text-muted-foreground mb-3">
            A valid code signs in directly and saves work to that code’s own account.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr,140px,auto] gap-2">
            <div>
              <Label className="text-xs">Label (optional)</Label>
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. For Sarah"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Max logins</Label>
              <Input
                type="number"
                min={1}
                value={newMaxUses}
                onChange={(e) => setNewMaxUses(e.target.value)}
                placeholder="∞"
                className="mt-1"
              />
            </div>
            <div className="flex items-end">
              <Button onClick={createCode} disabled={creating} className="w-full sm:w-auto">
                <Plus className="h-4 w-4 mr-1" /> Create code
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          {codes.length === 0 && (
            <p className="text-sm text-muted-foreground">No code logins yet — create one above.</p>
          )}
          {codes.map((c) => {
            const exhausted = c.max_uses != null && c.uses >= c.max_uses;
            const expired = c.expires_at && new Date(c.expires_at) < new Date();
            const dead = !!c.revoked_at || !!expired || exhausted;
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-3 border rounded-xl p-3">
                <div className="font-mono text-sm font-semibold">{c.code}</div>
                {c.label && <div className="text-xs text-muted-foreground">{c.label}</div>}
                <div className="text-xs text-muted-foreground">
                  {c.uses}{c.max_uses ? ` / ${c.max_uses}` : ""} logins
                </div>
                {c.code_user_id && <Badge variant="outline">Account linked</Badge>}
                {c.last_login_at && (
                  <div className="text-xs text-muted-foreground">
                    Last login {new Date(c.last_login_at).toLocaleDateString()}
                  </div>
                )}
                {c.revoked_at && <Badge variant="destructive">Revoked</Badge>}
                {!c.revoked_at && expired && <Badge variant="destructive">Expired</Badge>}
                {!c.revoked_at && !expired && exhausted && <Badge variant="destructive">Used up</Badge>}
                {!dead && <Badge variant="secondary">Active</Badge>}
                <div className="ml-auto flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      navigator.clipboard.writeText(c.code);
                      toast.success("Copied");
                    }}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                  {!c.revoked_at && (
                    <Button size="sm" variant="ghost" onClick={() => revoke(c.id)}>
                      Revoke
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => deleteCode(c.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </TabsContent>
    </Tabs>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "approved") return <Badge variant="default">Approved</Badge>;
  if (status === "blocked") return <Badge variant="destructive">Blocked</Badge>;
  return <Badge variant="secondary">Pending</Badge>;
}
