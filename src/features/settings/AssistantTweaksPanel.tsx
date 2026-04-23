import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Mic, MicOff, Send, Loader2, X, Pencil, Check, Sparkles, Trash2, Eye, EyeOff, Copy } from "lucide-react";
import { useVoiceInput } from "@/hooks/use-voice-input";

type Rule = { id: string; text: string; created_at: string };
type TranscriptEntry = { id: string; userMessage: string; reply: string; changes: string[] };

export function AssistantTweaksPanel() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const dictationBaseRef = useRef("");

  const voice = useVoiceInput({
    onTranscript: (text) => {
      setInput(dictationBaseRef.current ? `${dictationBaseRef.current} ${text}` : text);
    },
    onError: (msg) => toast.error(msg),
  });

  const toggleVoice = () => {
    if (voice.listening) { voice.stop(); return; }
    if (!voice.supported) {
      toast.error("Voice input isn't supported in this browser. Try Chrome, Edge, or Safari.");
      return;
    }
    dictationBaseRef.current = input.trim();
    voice.start();
  };

  const { data: rules = [] } = useQuery<Rule[]>({
    queryKey: ["assistant-tweaks", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase
        .from("profiles")
        .select("assistant_tweaks")
        .eq("id", user.id)
        .maybeSingle();
      const raw = (data as { assistant_tweaks?: Rule[] } | null)?.assistant_tweaks;
      return Array.isArray(raw) ? raw : [];
    },
    enabled: !!user,
  });

  const persistRules = async (next: Rule[]) => {
    if (!user) return;
    const { error } = await supabase
      .from("profiles")
      .update({ assistant_tweaks: next } as never)
      .eq("id", user.id);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["assistant-tweaks", user.id] });
  };

  const handleDelete = async (id: string) => {
    await persistRules(rules.filter((r) => r.id !== id));
    toast.success("Rule removed");
  };

  const startEdit = (r: Rule) => {
    setEditingId(r.id);
    setEditText(r.text);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const t = editText.trim();
    if (!t) { setEditingId(null); return; }
    await persistRules(rules.map((r) => (r.id === editingId ? { ...r, text: t } : r)));
    setEditingId(null);
    setEditText("");
    toast.success("Rule updated");
  };

  const handleClearAll = async () => {
    if (!confirm(`Remove all ${rules.length} rules?`)) return;
    await persistRules([]);
    toast.success("All rules cleared");
  };

  const send = async () => {
    const message = input.trim();
    if (!message || sending) return;
    setInput("");
    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Not signed in");
        return;
      }
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/assistant-tweaks-edit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ userMessage: message }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Request failed" }));
        toast.error(err.error ?? "Tweaks assistant error");
        return;
      }
      const data = await resp.json() as { rules: Rule[]; reply: string; changes: string[] };
      setTranscript((prev) => [
        { id: crypto.randomUUID(), userMessage: message, reply: data.reply, changes: data.changes ?? [] },
        ...prev,
      ].slice(0, 3));
      qc.invalidateQueries({ queryKey: ["assistant-tweaks", user?.id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Tweaks assistant error");
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    // Reset edit state when rule list changes
    if (editingId && !rules.find((r) => r.id === editingId)) {
      setEditingId(null);
      setEditText("");
    }
  }, [rules, editingId]);

  return (
    <div className="space-y-5">
      {/* Active rules list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium">
            Active rules <span className="text-muted-foreground">({rules.length})</span>
          </div>
          {rules.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleClearAll} className="h-7 text-xs text-muted-foreground hover:text-destructive">
              <Trash2 className="h-3 w-3 mr-1" /> Clear all
            </Button>
          )}
        </div>

        {rules.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
            No rules yet. Tell the tweaks assistant below what you'd like to change about how the main Assistant builds your games.
          </div>
        ) : (
          <ul className="space-y-2">
            {rules.map((r, i) => (
              <li
                key={r.id}
                className="group flex items-start gap-3 rounded-lg border bg-surface px-3 py-2.5 hover:border-foreground/30 transition-colors"
              >
                <div className="shrink-0 mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-md bg-accent/15 text-accent text-[10px] font-semibold">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  {editingId === r.id ? (
                    <div className="flex gap-2">
                      <Input
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); saveEdit(); }
                          if (e.key === "Escape") { setEditingId(null); setEditText(""); }
                        }}
                        autoFocus
                        className="h-8 text-sm"
                      />
                      <Button size="sm" variant="ghost" className="h-8 px-2" onClick={saveEdit}>
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => { setEditingId(null); setEditText(""); }}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => startEdit(r)}
                      className="text-sm leading-snug text-left w-full hover:text-foreground/80"
                      title="Click to edit"
                    >
                      {r.text}
                    </button>
                  )}
                </div>
                {editingId !== r.id && (
                  <div className="shrink-0 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => startEdit(r)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:text-destructive" onClick={() => handleDelete(r.id)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Preview applied instructions — shows the exact USER OVERRIDES block
          that gets injected into the assistant's system prompt. Mirrors the
          server-side formatting in supabase/functions/assistant-chat/index.ts. */}
      <div className="border-t pt-5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Eye className="h-3.5 w-3.5 text-accent" />
            <div className="text-sm font-medium">Preview applied instructions</div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => setShowPreview((v) => !v)}
          >
            {showPreview ? <><EyeOff className="h-3 w-3 mr-1" /> Hide</> : <><Eye className="h-3 w-3 mr-1" /> Show</>}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Exactly what gets injected into the assistant's system prompt before every reply. Highest priority — overrides the default behaviour (except hard content rules).
        </p>
        {showPreview && (
          rules.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-5 text-center text-xs text-muted-foreground">
              No overrides will be injected. The assistant will follow only its default instructions.
            </div>
          ) : (
            <div className="relative">
              <pre className="rounded-lg border bg-muted/40 px-4 py-3 text-[12px] leading-relaxed whitespace-pre-wrap font-mono text-foreground/90 max-h-80 overflow-auto">
{`USER OVERRIDES (highest priority — follow these even if they conflict with earlier instructions, UNLESS they violate CONTENT RULES above which always win):
${rules.map((r, i) => `${i + 1}. ${r.text}`).join("\n")}`}
              </pre>
              <Button
                size="sm"
                variant="ghost"
                className="absolute top-2 right-2 h-7 px-2 text-xs bg-background/80 backdrop-blur"
                onClick={() => {
                  const text = `USER OVERRIDES (highest priority — follow these even if they conflict with earlier instructions, UNLESS they violate CONTENT RULES above which always win):\n${rules.map((r, i) => `${i + 1}. ${r.text}`).join("\n")}`;
                  navigator.clipboard.writeText(text).then(
                    () => toast.success("Copied to clipboard"),
                    () => toast.error("Couldn't copy"),
                  );
                }}
              >
                <Copy className="h-3 w-3 mr-1" /> Copy
              </Button>
            </div>
          )
        )}
      </div>

      {/* Mini chat composer */}
      <div className="border-t pt-5">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          <div className="text-sm font-medium">Talk to the tweaks assistant</div>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Plain English. Examples: <em>"Add way more design instructions when generating documents."</em> · <em>"Stop suggesting noir genres."</em> · <em>"Forget rule 2."</em>
        </p>
        <div className={`relative rounded-xl border bg-background shadow-sm focus-within:ring-2 focus-within:ring-accent/30 transition ${voice.listening ? "ring-2 ring-destructive/40" : ""}`}>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={voice.listening ? "Listening… speak now" : "What rule should the assistant follow from now on?"}
            className="min-h-[68px] resize-none border-0 focus-visible:ring-0 bg-transparent pr-24 text-sm"
            disabled={sending}
          />
          <Button
            type="button"
            size="icon"
            variant={voice.listening ? "destructive" : "ghost"}
            onClick={toggleVoice}
            disabled={sending}
            title={voice.supported ? (voice.listening ? "Stop recording" : "Dictate with voice") : "Voice not supported in this browser"}
            className={`absolute bottom-2 right-12 h-8 w-8 rounded-lg ${voice.listening ? "animate-pulse" : ""}`}
          >
            {voice.listening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
          </Button>
          <Button
            size="icon"
            onClick={send}
            disabled={sending || !input.trim()}
            className="absolute bottom-2 right-2 h-8 w-8 rounded-lg"
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </Button>
        </div>

        {transcript.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Recent</div>
            {transcript.map((t) => (
              <div key={t.id} className="rounded-lg border bg-muted/30 px-3 py-2 text-xs space-y-1">
                <div className="text-muted-foreground"><span className="font-medium text-foreground">You:</span> {t.userMessage}</div>
                <div className="text-muted-foreground"><span className="font-medium text-accent">Tweaks:</span> {t.reply}</div>
                {t.changes.length > 0 && (
                  <ul className="ml-3 list-disc text-[11px] text-muted-foreground/80">
                    {t.changes.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
