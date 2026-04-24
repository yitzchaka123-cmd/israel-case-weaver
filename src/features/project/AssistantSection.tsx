import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Sparkles, Send, Loader2, Bot, User, Wand2, CheckCircle2, Cpu, Image as ImageIcon, Settings2, Video, ChevronRight, ExternalLink, AlertCircle, Mic, MicOff, Sliders, Pencil, X, Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { useVoiceInput } from "@/hooks/use-voice-input";
import { AiOriginBadge } from "@/components/AiOriginBadge";
import { useAssistantRun } from "./assistant/useAssistantRun";
import { AssetLightbox, type LightboxAsset } from "./assistant/AssetLightbox";

const PLANNING_MODELS = [
  { value: "__hdr-lovable", label: "— Lovable AI (workspace credits) —", header: true },
  { value: "lovable", label: "Gemini 3.1 Pro (default)" },
  { value: "gemini-3-flash", label: "Gemini 3 Flash (preview)" },
  { value: "gemini", label: "Gemini 2.5 Pro" },
  { value: "gemini-flash", label: "Gemini 2.5 Flash" },
  { value: "gemini-flash-lite", label: "Gemini 2.5 Flash Lite" },
  { value: "__hdr-direct", label: "— Your Google AI key (direct) —", header: true },
  { value: "gemini-direct-3-pro", label: "Gemini 3.1 Pro preview (direct)" },
  { value: "gemini-direct-3-flash", label: "Gemini 3 Flash preview (direct)" },
  { value: "gemini-direct-pro", label: "Gemini 2.5 Pro (direct)" },
  { value: "gemini-direct-flash", label: "Gemini 2.5 Flash (direct)" },
  { value: "gemini-direct-flash-lite", label: "Gemini 2.5 Flash Lite (direct)" },
  { value: "__hdr-openai", label: "— OpenAI —", header: true },
  { value: "openai-5.4", label: "ChatGPT 5.4 (newest)" },
  { value: "openai-5.2", label: "ChatGPT 5.2" },
  { value: "openai", label: "ChatGPT 5" },
  { value: "openai-mini", label: "ChatGPT 5 mini" },
  { value: "__hdr-claude", label: "— Anthropic (your Claude key) —", header: true },
  { value: "claude", label: "Claude Sonnet 4.5" },
  { value: "claude-opus", label: "Claude Opus 4.5 (highest quality)" },
  { value: "claude-haiku", label: "Claude Haiku 4.5 (fast)" },
];

const IMAGE_MODELS = [
  { value: "nano-banana-2", label: "Nano Banana 2 (default — fast + pro)" },
  { value: "nano-banana-pro", label: "Nano Banana Pro (highest quality)" },
  { value: "nano-banana", label: "Nano Banana (Gemini 2.5 Flash Image)" },
];

type ToolCall = {
  name: string;
  args?: Record<string, unknown>;
  result: {
    ok: boolean;
    message: string;
    id?: string;
    hebrew_preview?: string;
    image_url?: string;
    document_url?: string;
    document_format?: string;
    document_model?: string;
    document_skill_id?: string;
    thumbnail_url?: string;
    alt_thumbnail_url?: string;
    cover_image_url?: string;
  };
};

type QuickOption = { label: string; send: string };

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  metadata?: { tools?: ToolCall[]; options?: QuickOption[]; question?: string | null; model?: string | null; effective_model?: string | null; fallback?: string | null; in_progress?: boolean | null } | null;
  created_at?: string;
};

const PHASES = [
  { key: "setup", label: "Setup" },
  { key: "summary", label: "Summary" },
  { key: "structure", label: "Structure" },
  { key: "documents", label: "Documents" },
  { key: "envelopes", label: "Envelopes" },
  { key: "hints", label: "Hints" },
  { key: "packaging", label: "Packaging" },
];

const STARTERS = [
  "Let's start a new case. Walk me through Phase 1 setup.",
  "Propose 5 Hebrew title options with strong Israeli flavor.",
  "Generate the detailed English case summary (Phase 2).",
  "Draft the suspect list and deduction structure.",
];

export function AssistantSection({ projectId, phase, focusMessageId }: { projectId: string; phase: string; focusMessageId?: string | null }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [input, setInput] = useState("");
  const { isRunning: sending, send: hookSend, cancel: cancelRun } = useAssistantRun(projectId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dictationBaseRef = useRef("");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<LightboxAsset | null>(null);

  const { data: tweakCount = 0 } = useQuery({
    queryKey: ["assistant-tweaks-count", user?.id],
    queryFn: async () => {
      if (!user) return 0;
      const { data } = await supabase.from("profiles").select("assistant_tweaks").eq("id", user.id).maybeSingle();
      const raw = (data as { assistant_tweaks?: unknown } | null)?.assistant_tweaks;
      return Array.isArray(raw) ? raw.length : 0;
    },
    enabled: !!user,
  });

  const voice = useVoiceInput({
    onTranscript: (text) => {
      // Append live transcript to whatever the user had typed before starting.
      setInput(dictationBaseRef.current ? `${dictationBaseRef.current} ${text}` : text);
    },
    onError: (msg) => toast.error(msg),
  });

  const toggleVoice = () => {
    if (voice.listening) {
      voice.stop();
      return;
    }
    if (!voice.supported) {
      toast.error("Voice input isn't supported in this browser. Try Chrome, Edge, or Safari.");
      return;
    }
    dictationBaseRef.current = input.trim();
    voice.start();
  };

  const { data: project } = useQuery({
    queryKey: ["project-ai", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("ai_provider_planning, ai_provider_images, image_prompt_instructions, video_prompt_instructions")
        .eq("id", projectId)
        .single();
      if (error) throw error;
      return data as {
        ai_provider_planning: string | null;
        ai_provider_images: string | null;
        image_prompt_instructions: string | null;
        video_prompt_instructions: string | null;
      };
    },
  });

  const planningModel = project?.ai_provider_planning ?? "lovable";
  const imageModel = project?.ai_provider_images ?? "nano-banana-2";

  const setProjectAi = async (patch: {
    ai_provider_planning?: string;
    ai_provider_images?: string;
    image_prompt_instructions?: string;
    video_prompt_instructions?: string;
  }) => {
    const { error } = await supabase.from("projects").update(patch).eq("id", projectId);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["project-ai", projectId] });
  };

  const { data: messages = [] } = useQuery<Msg[]>({
    queryKey: ["chat", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Msg[];
    },
  });

  // Realtime sync for chat messages
  useEffect(() => {
    const ch = supabase
      .channel(`chat-${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_messages", filter: `project_id=eq.${projectId}` },
        () => qc.invalidateQueries({ queryKey: ["chat", projectId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [projectId, qc]);

  // Track when an external focus request is in flight, so the
  // auto-scroll-to-bottom effect doesn't yank the user away from the
  // highlighted message they just clicked through to.
  const focusInFlightRef = useRef(false);

  useEffect(() => {
    if (focusInFlightRef.current) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  // Scroll-to and briefly highlight a message when an outside component
  // (e.g. the AssistantOriginBadge on a suspect/document) asks to focus it.
  // Retries a few times because the messages query may not have rendered yet
  // when the tab first switches in.
  useEffect(() => {
    if (!focusMessageId) return;
    focusInFlightRef.current = true;
    let cancelled = false;
    let attempts = 0;
    const tryFocus = () => {
      if (cancelled) return;
      const el = scrollRef.current?.querySelector<HTMLElement>(`[data-msg-id="${focusMessageId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlightedId(focusMessageId);
        window.setTimeout(() => setHighlightedId(null), 2400);
        // Release the auto-scroll lock a bit after the smooth-scroll completes.
        window.setTimeout(() => { focusInFlightRef.current = false; }, 800);
        return;
      }
      attempts += 1;
      if (attempts < 12) window.setTimeout(tryFocus, 100);
      else focusInFlightRef.current = false;
    };
    const t = window.setTimeout(tryFocus, 60);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [focusMessageId, messages]);

  // Listen for external "send this prompt" requests (from the notification panel).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ projectId: string; prompt: string }>).detail;
      if (!detail || detail.projectId !== projectId) return;
      const text = detail.prompt?.trim();
      if (!text) return;
      void send(text);
    };
    window.addEventListener("mystudio:assistant-prompt", handler as EventListener);
    return () => window.removeEventListener("mystudio:assistant-prompt", handler as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, messages, sending]);
  const send = async (text: string, baseMessages?: Msg[]) => {
    const content = text.trim();
    if (!content || sending) return;
    setInput("");
    const source = baseMessages ?? messages;
    const convo = source.map((m) => ({ role: m.role, content: m.content }));
    // Hook handles fire-and-forget background mode + realtime status flips.
    await hookSend(content, convo);
  };

  // Edit a previous user message: rewrite the conversation by deleting that
  // message and everything after it, then resend the new content. The
  // assistant's reply will continue from the same prior context as the
  // original turn — but with the edited prompt instead.
  const editAndResend = async (messageId: string, newContent: string) => {
    const trimmed = newContent.trim();
    if (!trimmed) return;
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    const target = messages[idx];
    if (target.role !== "user") return;

    // If the assistant is mid-reply, cancel it first. The orphaned background
    // task may still finish and write its assistant message, but the
    // delete-tail logic below clears the entire tail (including any later
    // arrival) so the user only sees the new turn.
    if (sending) cancelRun();

    const priorMessages = messages.slice(0, idx);
    const toDelete = messages.slice(idx).map((m) => m.id);

    try {
      const { error } = await supabase.from("chat_messages").delete().in("id", toDelete);
      if (error) {
        toast.error(error.message);
        return;
      }
      // Optimistically clear so UI doesn't flash the deleted tail
      qc.setQueryData<Msg[]>(["chat", projectId], priorMessages);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to edit message");
      return;
    }

    // Now resend with the prior context as the base
    await send(trimmed, priorMessages);
  };

  return (
    <div className="flex h-full">
      {/* Phase rail */}
      <aside className="hidden lg:flex w-64 shrink-0 border-r bg-surface/40 flex-col">
        <div className="p-5 border-b">
          <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
            <Sparkles className="h-3 w-3" /> Assistant
          </div>
          <div className="mt-1 font-display text-lg">Creative flow</div>
        </div>
        <div className="p-3 space-y-1 flex-1 overflow-auto">
          {PHASES.map((p, i) => {
            const currentIdx = PHASES.findIndex((x) => x.key === phase);
            const state = i < currentIdx ? "done" : i === currentIdx ? "active" : "todo";
            return (
              <div
                key={p.key}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm ${
                  state === "active"
                    ? "bg-accent/10 text-foreground border border-accent/20"
                    : state === "done"
                    ? "text-muted-foreground"
                    : "text-muted-foreground/70"
                }`}
              >
                <div
                  className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-semibold ${
                    state === "active"
                      ? "bg-accent text-accent-foreground"
                      : state === "done"
                      ? "bg-muted text-foreground"
                      : "bg-muted/50"
                  }`}
                >
                  {state === "done" ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                </div>
                <span className="flex-1">{p.label}</span>
              </div>
            );
          })}
        </div>
        <div className="p-3 border-t text-[11px] text-muted-foreground leading-relaxed">
          The assistant writes directly to your project — suspects, documents and canvas nodes update live as they're approved.
        </div>
      </aside>

      {/* Chat */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Model picker bar */}
        <div className="border-b bg-surface/40 px-4 md:px-6 py-2 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
            <Cpu className="h-3 w-3" /> Models
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Chat</span>
            <Select value={planningModel} onValueChange={(v) => setProjectAi({ ai_provider_planning: v })}>
              <SelectTrigger className="h-8 text-xs w-[210px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PLANNING_MODELS.map((m) => {
                  if ((m as { header?: boolean }).header) {
                    return (
                      <div key={m.value} className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {m.label}
                      </div>
                    );
                  }
                  return (
                    <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <ImageIcon className="h-3 w-3 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">Images</span>
            <Select value={imageModel} onValueChange={(v) => setProjectAi({ ai_provider_images: v })}>
              <SelectTrigger className="h-8 text-xs w-[260px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {IMAGE_MODELS.map((m) => (
                  <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <PromptInstructionsPopover
            imageInstructions={project?.image_prompt_instructions ?? ""}
            videoInstructions={project?.video_prompt_instructions ?? ""}
            onSave={(patch) => setProjectAi(patch)}
          />
          {tweakCount > 0 && (
            <Link
              to="/settings"
              className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-accent/10 hover:bg-accent/20 border border-accent/30 px-2.5 py-1 text-[11px] font-medium text-accent transition-colors"
              title="Your house rules are influencing the assistant. Click to manage."
            >
              <Sliders className="h-3 w-3" />
              {tweakCount} tweak{tweakCount === 1 ? "" : "s"} active
            </Link>
          )}
        </div>
        <div ref={scrollRef} className="flex-1 overflow-auto">
          <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
            {messages.length === 0 && (
              <div className="text-center py-12">
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-brand shadow-glow mb-5">
                  <Wand2 className="h-6 w-6 text-white" />
                </div>
                <h2 className="font-display text-3xl">Mystery Studio Assistant</h2>
                <p className="mt-2 text-muted-foreground max-w-md mx-auto">
                  I'll guide you phase by phase through creating a premium Israeli mystery game. Everything I create updates your project instantly.
                </p>
                <div className="mt-8 grid sm:grid-cols-2 gap-2.5 text-left">
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="rounded-lg border bg-surface hover:bg-muted/60 transition-colors p-4 text-sm text-left"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, idx) => {
              // Hide empty in-progress assistant bubbles — the placeholder
              // row exists only to satisfy FK constraints; client shows the
              // global "Thinking…" indicator instead.
              if (
                m.role === "assistant" &&
                !m.content?.trim() &&
                (m.metadata?.in_progress || (m.metadata?.tools ?? []).length === 0)
              ) {
                return null;
              }
              return (
                <MessageBubble
                  key={m.id}
                  msg={m}
                  isLast={idx === messages.length - 1}
                  onPickOption={(text) => send(text)}
                  onEdit={(newText) => editAndResend(m.id, newText)}
                  disabled={sending}
                  highlighted={m.id === highlightedId}
                  onOpenAsset={setLightbox}
                />
              );
            })}

            {sending && (
              <div className="flex gap-3 items-start">
                <Avatar role="assistant" />
                <div className="flex-1 pt-1.5">
                  <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="border-t bg-surface/60 backdrop-blur">
          <div className="max-w-3xl mx-auto px-6 py-4">
            <div className={`relative rounded-xl border bg-background shadow-sm focus-within:ring-2 focus-within:ring-accent/30 transition ${voice.listening ? "ring-2 ring-destructive/40" : ""}`}>
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!sending) send(input);
                  }
                }}
                placeholder={voice.listening ? "Listening… speak now" : sending ? "Assistant is thinking — keep typing your next message…" : "Describe what you want to build, approve a proposal, or ask for the next step…"}
                className="min-h-[80px] resize-none border-0 focus-visible:ring-0 bg-transparent pr-24"
              />
              <Button
                type="button"
                size="icon"
                variant={voice.listening ? "destructive" : "ghost"}
                onClick={toggleVoice}
                title={voice.supported ? (voice.listening ? "Stop recording" : "Dictate with voice") : "Voice not supported in this browser"}
                aria-label={voice.listening ? "Stop voice input" : "Start voice input"}
                className={`absolute bottom-2.5 right-14 h-9 w-9 rounded-lg ${voice.listening ? "animate-pulse" : ""}`}
              >
                {voice.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
              <Button
                size="icon"
                onClick={() => send(input)}
                disabled={sending || !input.trim()}
                className="absolute bottom-2.5 right-2.5 h-9 w-9 rounded-lg"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground text-center">
              {voice.listening ? (
                <span className="inline-flex items-center gap-1.5 text-destructive"><span className="inline-block h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" /> Recording — click the mic again to stop</span>
              ) : (
                "⏎ to send · Shift+⏎ for newline · 🎤 to dictate"
              )}
            </div>
          </div>
        </div>
      </div>
      <AssetLightbox asset={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

function Avatar({ role }: { role: "user" | "assistant" }) {
  return (
    <div
      className={`h-8 w-8 shrink-0 rounded-lg flex items-center justify-center ${
        role === "assistant" ? "bg-gradient-brand text-white shadow-glow" : "bg-muted text-foreground"
      }`}
    >
      {role === "assistant" ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
    </div>
  );
}

function MessageBubble({
  msg,
  isLast,
  onPickOption,
  onEdit,
  disabled,
  highlighted,
  onOpenAsset,
}: {
  msg: Msg;
  isLast: boolean;
  onPickOption: (text: string) => void;
  onEdit: (newText: string) => void;
  disabled: boolean;
  highlighted?: boolean;
  onOpenAsset: (asset: LightboxAsset) => void;
}) {
  const tools = msg.metadata?.tools ?? [];
  const rawMetaOptions = msg.metadata?.options ?? [];
  const metaQuestion = msg.metadata?.question ?? null;

  // Self-heal stale metadata.options: a previous bug had the model copying
  // the previous turn's `propose_options` arguments verbatim, so the buttons
  // shown didn't match the prose. Detect that mismatch on render and discard
  // the stale options — the synth fallback will derive the correct ones from
  // the actual prose.
  const metaOptions: QuickOption[] = (() => {
    if (rawMetaOptions.length === 0) return [];
    if (msg.role !== "assistant") return rawMetaOptions;
    const numberedItems = extractNumberedListItems(msg.content);
    if (numberedItems.length === 0) return rawMetaOptions;
    const haystack = numberedItems.join(" \n ").toLowerCase();
    const anyMatches = rawMetaOptions.some((o) =>
      o.label && haystack.includes(o.label.trim().toLowerCase()),
    );
    return anyMatches ? rawMetaOptions : [];
  })();

  // Client-side fallback: if the assistant wrote a numbered choice list in
  // prose but the server didn't attach any options (older messages, or model
  // forgot the tool call AND server fallback didn't catch it), synthesize
  // buttons from the prose so they still appear.
  const synth = msg.role === "assistant" && isLast && metaOptions.length === 0
    ? synthesizeOptionsFromProse(msg.content)
    : null;
  const options: QuickOption[] = metaOptions.length > 0 ? metaOptions : synth?.options ?? [];
  const question = metaQuestion ?? synth?.question ?? null;
  // Only render quick-reply buttons on the most recent assistant message —
  // older proposals are stale and clicking them would be confusing.
  const showOptions = msg.role === "assistant" && isLast && options.length > 0;

  // Dev-only diagnostic: flag latest assistant messages that look like a
  // numbered choice list but produced zero buttons (tool missed AND synth missed).
  if (
    import.meta.env.DEV &&
    msg.role === "assistant" &&
    isLast &&
    options.length === 0 &&
    /^\s*1[\.\)]\s+.+$/m.test(msg.content)
  ) {
    const model = (msg.metadata as { model?: string } | undefined)?.model ?? "unknown";
    // eslint-disable-next-line no-console
    console.warn(
      `[assistant] missed quick-reply: ${model} – numbered list detected but no propose_options tool call and prose synthesizer returned null`,
    );
  }

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);
  const isUser = msg.role === "user";

  const startEdit = () => {
    setDraft(msg.content);
    setEditing(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    setDraft(msg.content);
  };
  const submitEdit = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === msg.content.trim()) {
      cancelEdit();
      return;
    }
    setEditing(false);
    onEdit(trimmed);
  };

  const copyContent = async () => {
    try {
      await navigator.clipboard.writeText(msg.content);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Failed to copy");
    }
  };

  return (
    <div
      data-msg-id={msg.id}
      className={`group flex flex-col scroll-mt-24 rounded-xl transition-colors duration-700 ${
        isUser ? "items-end" : "items-start"
      } ${highlighted ? "bg-accent/15 ring-2 ring-accent/50 -mx-2 px-2 py-2" : ""}`}
    >
      {/* Header row: role label + timestamp + actions */}
      <div className={`flex items-center gap-2 mb-1 px-1 text-[11px] text-muted-foreground ${isUser ? "flex-row-reverse" : ""}`}>
        <span className={`inline-flex items-center gap-1.5 font-semibold tracking-wide uppercase text-[10px] ${isUser ? "text-accent" : "text-foreground/70"}`}>
          {isUser ? (
            <><User className="h-2.5 w-2.5" /> You</>
          ) : (
            <><Bot className="h-2.5 w-2.5" /> Assistant</>
          )}
        </span>
        {msg.created_at && (
          <span
            className="opacity-0 group-hover:opacity-100 transition-opacity"
            title={new Date(msg.created_at).toLocaleString()}
          >
            {formatRelativeTime(msg.created_at)}
          </span>
        )}
        {isUser && !editing && (
          <button
            type="button"
            onClick={startEdit}
            title={disabled ? "Cancel current reply and edit this message" : "Edit and re-run"}
            className="opacity-40 group-hover:opacity-100 focus:opacity-100 transition-opacity inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:text-foreground hover:bg-muted"
          >
            <Pencil className="h-3 w-3" /> Edit
          </button>
        )}
        {!isUser && !editing && (msg.metadata?.model || msg.metadata?.effective_model) && (
          <AiOriginBadge
            position="inline"
            info={{
              requested: msg.metadata?.model ?? null,
              effective: msg.metadata?.effective_model ?? msg.metadata?.model ?? null,
              fallback: msg.metadata?.fallback ?? "none",
            }}
          />
        )}
        {!isUser && !editing && msg.content.trim() && (
          <button
            type="button"
            onClick={copyContent}
            title="Copy reply"
            className="opacity-40 group-hover:opacity-100 focus:opacity-100 transition-opacity inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:text-foreground hover:bg-muted"
          >
            <Copy className="h-3 w-3" /> Copy
          </button>
        )}
      </div>

      {/* Message body row: avatar + bubble */}
      <div className={`flex gap-2.5 items-end w-full ${isUser ? "flex-row-reverse" : ""}`}>
        <Avatar role={msg.role} />
        <div className={`min-w-0 ${isUser ? "max-w-[82%]" : "flex-1"}`}>
          {editing ? (
            <div className="rounded-2xl border border-accent/40 bg-accent/5 p-2 space-y-2">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    submitEdit();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelEdit();
                  }
                }}
                autoFocus
                className="min-h-[80px] text-[14.5px] bg-background"
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10.5px] text-muted-foreground">
                  Re-running will delete the assistant's reply and any later messages.
                </p>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button type="button" variant="ghost" size="sm" onClick={cancelEdit} className="h-7 px-2 text-xs">
                    <X className="h-3.5 w-3.5 mr-1" /> Cancel
                  </Button>
                  <Button type="button" size="sm" onClick={submitEdit} disabled={!draft.trim()} className="h-7 px-2.5 text-xs">
                    <Check className="h-3.5 w-3.5 mr-1" /> Save & re-run
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div
              className={`prose prose-sm max-w-none dark:prose-invert whitespace-pre-wrap leading-relaxed text-[14.5px] px-4 py-2.5 ${
                isUser
                  ? "rounded-2xl rounded-tr-md bg-accent/10 border border-accent/20 text-foreground"
                  : "rounded-2xl rounded-tl-md bg-surface border border-border/60 text-foreground shadow-sm"
              }`}
            >
              {msg.content}
            </div>
          )}
          {!editing && showOptions && (
            <div className="mt-3 rounded-xl border border-accent/20 bg-accent/5 p-3">
              {question && (
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 font-medium">
                  {question}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {options.map((opt, i) => (
                  <button
                    key={i}
                    type="button"
                    disabled={disabled}
                    onClick={() => onPickOption(opt.send || opt.label)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-background hover:bg-accent hover:text-accent-foreground hover:border-accent transition-colors px-3.5 py-1.5 text-[13px] font-medium disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                  >
                    <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-accent/15 text-accent text-[10px] font-bold">
                      {i + 1}
                    </span>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!editing && tools.length > 0 && <ToolReceipts tools={tools} onOpenAsset={onOpenAsset} />}
          {!editing && tools.length > 0 && <GeneratedAssetsStrip tools={tools} onOpenAsset={onOpenAsset} />}
        </div>
      </div>
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Pull all "1. foo / 2. bar / …" items from prose. Used to validate that
// metadata.options labels actually appear in this turn's prose — guards
// against the model copying a previous turn's propose_options arguments.
function extractNumberedListItems(text: string): string[] {
  if (!text) return [];
  const itemLineRegex = /^\s*\d+[\.\)]\s+(.+?)\s*$/;
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const m = itemLineRegex.exec(line);
    if (m) out.push(m[1].trim());
  }
  return out;
}

// Mirror of the server-side fallback in supabase/functions/assistant-chat/index.ts.
// When the model wrote a numbered choice list in prose but no `options` were
// attached to the message metadata (e.g. older messages, or the server
// fallback also missed it), parse the prose and surface buttons.
function synthesizeOptionsFromProse(text: string): { options: QuickOption[]; question: string | null } | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const looksLikeQuestion =
    /\?\s*$/.test(trimmed) ||
    /\b(pick|choose|select|which|prefer|approve|confirm)\b/i.test(trimmed) ||
    /(בחר|בחרי|בחרו|איזה|איזו|תבחר|מעדיף|מעדיפה|לאשר)/.test(trimmed);
  if (!looksLikeQuestion) return null;

  // Scan the WHOLE message line-by-line for a contiguous run of numbered
  // items (1, 2, 3, …) — list may sit anywhere, not just last paragraph.
  const lines = trimmed.split("\n");
  const itemLineRegex = /^\s*(\d+)[\.\)]\s+(.+?)\s*$/;
  let bestRun: { startIdx: number; items: Array<{ n: number; text: string }> } | null = null;
  let i = 0;
  while (i < lines.length) {
    const first = itemLineRegex.exec(lines[i]);
    if (first && Number(first[1]) === 1) {
      const run: Array<{ n: number; text: string }> = [{ n: 1, text: first[2].trim() }];
      const startIdx = i;
      let j = i + 1;
      while (j < lines.length) {
        const next = itemLineRegex.exec(lines[j]);
        if (!next) break;
        const n = Number(next[1]);
        if (n !== run.length + 1) break;
        run.push({ n, text: next[2].trim() });
        j++;
      }
      if (run.length >= 2 && run.length <= 6) {
        if (!bestRun || run.length > bestRun.items.length) {
          bestRun = { startIdx, items: run };
        }
      }
      i = j;
      continue;
    }
    i++;
  }
  if (!bestRun) return null;
  for (const it of bestRun.items) {
    if (!it.text || it.text.length > 120) return null;
  }

  const toLabel = (s: string) => {
    const cleaned = s.replace(/\s+—\s+.*$/, "").replace(/\s*\(.*\)\s*$/, "").trim();
    const base = cleaned || s;
    return base.length > 60 ? `${base.slice(0, 57)}…` : base;
  };

  let questionLine: string | null = null;
  for (let k = bestRun.startIdx - 1; k >= 0; k--) {
    const candidate = lines[k].trim();
    if (candidate) {
      questionLine = candidate;
      break;
    }
  }

  return {
    options: bestRun.items.map((mm) => ({ label: toLabel(mm.text), send: mm.text })),
    question: questionLine && questionLine.length <= 140 ? questionLine : null,
  };
}

// Maps a tool name to the workspace tab the user should jump to when clicking
// the receipt. Returns null for tools that have no obvious destination.
function destinationFor(toolName: string): { tab: string; label: string } | null {
  switch (toolName) {
    case "add_document":
    case "update_document":
    case "generate_document_assets":
      return { tab: "documents", label: "Open in Documents" };
    case "add_suspect":
    case "update_suspect":
      return { tab: "suspects", label: "Open in Suspects" };
    case "add_canvas_node":
    case "add_canvas_edge":
    case "update_canvas_node":
      return { tab: "canvas", label: "Open in Case Board" };
    case "set_solution_summary":
      return { tab: "canvas", label: "Open Solution summary on Case Board" };
    case "update_project":
      return { tab: "overview", label: "Open in Overview" };
    case "generate_image":
    case "add_media":
      return { tab: "media", label: "Open in Media" };
    case "add_envelope":
    case "update_envelope":
      return { tab: "envelopes", label: "Open in Envelopes" };
    case "add_hint":
    case "update_hint":
      return { tab: "hints", label: "Open in Hints" };
    default:
      return null;
  }
}

// Friendly labels for the project field keys touched by `update_project`,
// so the receipt reads "Mystery type · Year · Difficulty" instead of the
// raw column names.
const PROJECT_FIELD_LABELS: Record<string, string> = {
  title: "Title",
  subtitle: "Subtitle",
  phase: "Phase",
  mystery_type: "Mystery type",
  genre: "Genre",
  year: "Year",
  difficulty: "Difficulty",
  player_role: "Player role",
  case_goal: "Case goal",
  setting: "Setting",
  selling_point: "Selling point",
  target_doc_count: "Target doc count",
  packaging_notes: "Packaging notes",
  image_prompt_instructions: "Image prompt style",
  video_prompt_instructions: "Video prompt style",
  hint_settings: "Hint settings",
  envelope_settings: "Envelope settings",
};

function formatFieldValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (!trimmed) return "—";
    return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  // Plain objects (e.g. hint_settings, envelope_settings jsonb): render as
  // "key: value, key2: value2" instead of raw JSON, capped to 80 chars.
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0) return "(empty)";
    const summary = entries
      .map(([k, val]) => {
        let s: string;
        if (val === null || val === undefined) s = "—";
        else if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") s = String(val);
        else { try { s = JSON.stringify(val); } catch { s = String(val); } }
        return `${k}: ${s}`;
      })
      .join(", ");
    return summary.length > 80 ? `${summary.slice(0, 77)}…` : summary;
  }
  try { return JSON.stringify(v); } catch { return String(v); }
}

function ProjectUpdateReceipt({ args, ok, message }: { args: Record<string, unknown>; ok: boolean; message: string }) {
  const entries = Object.entries(args).filter(([, v]) => v !== undefined);
  const handleJump = () => {
    if (!ok) return;
    window.dispatchEvent(new CustomEvent("mystudio:navigate", { detail: { tab: "overview" } }));
  };
  if (entries.length === 0) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-foreground/90 font-medium">Project updated</span>
        <span className="text-[11px] text-muted-foreground">{message}</span>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5 space-y-1.5">
      <button
        type="button"
        onClick={handleJump}
        disabled={!ok}
        title={ok ? "Open in Overview" : message}
        className="flex w-full items-center justify-between gap-2 text-left text-foreground/90 font-medium hover:text-accent-foreground disabled:cursor-default disabled:hover:text-foreground/90"
      >
        <span className="inline-flex items-center gap-1.5">
          Case details updated
          <span className="rounded-full bg-accent/15 text-accent text-[10px] font-bold px-1.5 py-0.5 leading-none">
            {entries.length}
          </span>
        </span>
        {ok && <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />}
      </button>
      <dl className="grid grid-cols-1 sm:grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[12px] leading-snug">
        {entries.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground capitalize">{PROJECT_FIELD_LABELS[k] ?? k.replace(/_/g, " ")}</dt>
            <dd className="text-foreground/90 break-words">{formatFieldValue(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function GeneratedDocReceipt({
  message,
  hebrewPreview,
  imageUrl,
  documentId,
  onOpenAsset,
}: {
  message: string;
  hebrewPreview?: string;
  imageUrl?: string;
  documentId?: string;
  onOpenAsset?: (asset: LightboxAsset) => void;
}) {
  const handleJump = () => {
    window.dispatchEvent(
      new CustomEvent("mystudio:navigate", {
        detail: { tab: "documents", targetId: documentId },
      }),
    );
  };
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5 space-y-2">
      <button
        type="button"
        onClick={handleJump}
        title="Open in Documents"
        className="flex w-full items-center justify-between gap-2 text-left text-foreground/90 font-medium hover:text-accent-foreground"
      >
        <span className="inline-flex items-center gap-1.5">
          <ImageIcon className="h-3.5 w-3.5 opacity-70" />
          {message}
        </span>
        <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
      </button>
      <div className="flex gap-3">
        {imageUrl && (
          <button
            type="button"
            onClick={() => onOpenAsset?.({ url: imageUrl, title: message, openInTab: { tab: "documents", targetId: documentId, label: "Open in Documents" } })}
            className="shrink-0 block rounded-md overflow-hidden border border-border/60 bg-background hover:ring-2 hover:ring-accent/40 transition"
            title="View full size"
          >
            <img src={imageUrl} alt="Generated document preview" className="h-32 w-auto object-cover" loading="lazy" />
          </button>
        )}
        {hebrewPreview && (
          <div
            dir="rtl"
            lang="he"
            className="flex-1 min-w-0 text-[12.5px] leading-relaxed text-foreground/85 whitespace-pre-wrap font-sans bg-background/60 rounded-md border border-border/40 px-2.5 py-2 max-h-32 overflow-auto"
          >
            {hebrewPreview}
          </div>
        )}
      </div>
    </div>
  );
}

function ImageReceipt({
  imageUrl,
  title,
  subtitle,
  destTab,
  destLabel,
  targetId,
  onOpenAsset,
}: {
  imageUrl: string;
  title: string;
  subtitle?: string;
  destTab: string;
  destLabel: string;
  targetId?: string;
  onOpenAsset?: (asset: LightboxAsset) => void;
}) {
  const jump = () => window.dispatchEvent(new CustomEvent("mystudio:navigate", { detail: { tab: destTab, targetId } }));
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5 space-y-2">
      <button
        type="button"
        onClick={jump}
        title={destLabel}
        className="flex w-full items-center justify-between gap-2 text-left text-foreground/90 font-medium hover:text-accent-foreground"
      >
        <span className="inline-flex items-center gap-1.5 truncate">
          <ImageIcon className="h-3.5 w-3.5 opacity-70" />
          <span className="truncate">{title}</span>
        </span>
        <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
      </button>
      <div className="flex gap-3 items-start">
        <button
          type="button"
          onClick={() => onOpenAsset?.({ url: imageUrl, title, openInTab: { tab: destTab, targetId, label: destLabel } })}
          className="shrink-0 block rounded-md overflow-hidden border border-border/60 bg-background hover:ring-2 hover:ring-accent/40 transition"
          title="View full size"
        >
          <img src={imageUrl} alt={title} className="h-28 w-28 object-cover" loading="lazy" />
        </button>
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          {subtitle && <div className="text-[11.5px] text-muted-foreground">{subtitle}</div>}
          <button
            type="button"
            onClick={jump}
            className="self-start inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
          >
            View prompt → {destLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Aggregates every image generated in this turn into one horizontal strip.
function GeneratedAssetsStrip({ tools, onOpenAsset }: { tools: ToolCall[]; onOpenAsset: (asset: LightboxAsset) => void }) {
  const items: Array<{ key: string; url: string; title: string; tab: string; targetId?: string; label: string; mimeType?: string; previewUrl?: string }> = [];
  tools.forEach((t, i) => {
    if (!t.result?.ok) return;
    const id = t.result.id;
    if (t.result.image_url) items.push({ key: `${i}-img`, url: t.result.image_url, title: t.result.message || "Document", tab: "documents", targetId: id, label: "Open in Documents" });
    if (t.result.document_url) items.push({ key: `${i}-doc`, url: t.result.document_url, title: t.result.message || "Document file", tab: "documents", targetId: id, label: "Open in Documents", mimeType: t.result.document_format === "pdf" ? "application/pdf" : undefined, previewUrl: t.result.image_url });
    if (t.result.thumbnail_url) items.push({ key: `${i}-th`, url: t.result.thumbnail_url, title: t.result.message || "Suspect", tab: "suspects", targetId: id, label: "Open in Suspects" });
    if (t.result.alt_thumbnail_url) items.push({ key: `${i}-alt`, url: t.result.alt_thumbnail_url, title: `${t.result.message || "Suspect"} (alt)`, tab: "suspects", targetId: id, label: "Open in Suspects" });
    if (t.result.cover_image_url) items.push({ key: `${i}-cov`, url: t.result.cover_image_url, title: t.result.message || "Envelope cover", tab: "envelopes", targetId: id, label: "Open in Envelopes" });
  });
  if (items.length === 0) return null;
  return (
    <div className="mt-3 rounded-lg border border-border/60 bg-surface/50 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
        Generated assets ({items.length})
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            onClick={() => onOpenAsset({ url: it.url, title: it.title, mimeType: it.mimeType, previewUrl: it.previewUrl, openInTab: { tab: it.tab, targetId: it.targetId, label: it.label } })}
            className="group relative shrink-0 rounded-md overflow-hidden border border-border/60 hover:ring-2 hover:ring-accent/40 transition"
            title={it.title}
          >
            {it.mimeType === "application/pdf" && !it.previewUrl ? <FileText className="h-20 w-20 p-6 text-muted-foreground bg-background" /> : <img src={it.previewUrl ?? it.url} alt={it.title} className="h-20 w-20 object-cover" loading="lazy" />}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition flex items-end justify-end p-1">
              <ExternalLink className="h-3 w-3 text-white opacity-0 group-hover:opacity-100 transition" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}



function ToolReceipts({ tools, onOpenAsset }: { tools: ToolCall[]; onOpenAsset?: (asset: LightboxAsset) => void }) {
  const [open, setOpen] = useState(false);
  const okCount = tools.filter((t) => t.result.ok).length;
  const failCount = tools.length - okCount;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={open}
      >
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
        <span>
          {tools.length} action{tools.length === 1 ? "" : "s"} performed
          {failCount > 0 ? (
            <>
              {" "}
              <span className="text-accent-foreground/70">({okCount} ✓</span>
              <span className="text-destructive">, {failCount} ✗</span>
              <span className="text-accent-foreground/70">)</span>
            </>
          ) : (
            <span className="text-muted-foreground/70"> ({okCount} ✓)</span>
          )}
        </span>
      </button>

      {open && (
        <ul className="mt-2 space-y-1.5 border-l-2 border-border/60 pl-3">
          {tools.map((t, i) => {
            // Special-case update_project: render a structured field list
            // showing every property the assistant just changed, with values.
            if (t.name === "update_project") {
              return (
                <li key={i} className="flex items-start gap-2">
                  <span className={`mt-1 ${t.result.ok ? "text-accent-foreground/80" : "text-destructive"}`}>
                    {t.result.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <ProjectUpdateReceipt
                      args={(t.args ?? {}) as Record<string, unknown>}
                      ok={t.result.ok}
                      message={t.result.message}
                    />
                  </div>
                </li>
              );
            }

            // Special-case generate_document_assets: render an inline preview
            // card with the Hebrew snippet (RTL) and a clickable image thumbnail.
            if (t.name === "generate_document_assets" && t.result.ok && (t.result.hebrew_preview || t.result.image_url)) {
              return (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1 text-accent-foreground/80">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <GeneratedDocReceipt
                      message={t.result.message}
                      hebrewPreview={t.result.hebrew_preview}
                      imageUrl={t.result.image_url}
                      documentId={t.result.id}
                      onOpenAsset={onOpenAsset}
                    />
                  </div>
                </li>
              );
            }

            // Inline image receipts for suspect / envelope when their tool
            // call returned a thumbnail/cover URL — saves the user a tab hop
            // and links straight to the prompt textarea.
            if ((t.name === "add_suspect" || t.name === "update_suspect") && t.result.ok && (t.result.thumbnail_url || t.result.alt_thumbnail_url)) {
              const url = t.result.thumbnail_url ?? t.result.alt_thumbnail_url!;
              return (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1 text-accent-foreground/80"><CheckCircle2 className="h-3.5 w-3.5" /></span>
                  <div className="flex-1 min-w-0">
                    <ImageReceipt
                      imageUrl={url}
                      title={t.result.message}
                      subtitle="Suspect thumbnail"
                      destTab="suspects"
                      destLabel="Open in Suspects"
                      targetId={t.result.id}
                      onOpenAsset={onOpenAsset}
                    />
                  </div>
                </li>
              );
            }
            if ((t.name === "add_envelope" || t.name === "update_envelope") && t.result.ok && t.result.cover_image_url) {
              return (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1 text-accent-foreground/80"><CheckCircle2 className="h-3.5 w-3.5" /></span>
                  <div className="flex-1 min-w-0">
                    <ImageReceipt
                      imageUrl={t.result.cover_image_url}
                      title={t.result.message}
                      subtitle="Envelope cover"
                      destTab="envelopes"
                      destLabel="Open in Envelopes"
                      targetId={t.result.id}
                      onOpenAsset={onOpenAsset}
                    />
                  </div>
                </li>
              );
            }

            const dest = destinationFor(t.name);
            const clickable = t.result.ok && dest !== null;
            const handleClick = () => {
              if (!clickable || !dest) return;
              window.dispatchEvent(
                new CustomEvent("mystudio:navigate", {
                  detail: { tab: dest.tab, targetId: t.result.id },
                }),
              );
            };
            // Pull a friendly entity name out of result.message
            // (e.g. "Document created: Police Report (#3)" -> "Police Report (#3)")
            const entityName = (() => {
              if (!t.result.ok) return null;
              const m = t.result.message.match(/:\s*(.+)$/);
              return m?.[1]?.trim() || null;
            })();
            const verb = t.name.replace(/_/g, " ");
            return (
              <li key={i} className="flex items-start gap-2 text-[12px] leading-snug">
                <span className={`mt-0.5 ${t.result.ok ? "text-accent-foreground/80" : "text-destructive"}`}>
                  {t.result.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                </span>
                <div className="flex-1 min-w-0">
                  {t.result.ok && entityName ? (
                    clickable ? (
                      <button
                        type="button"
                        onClick={handleClick}
                        title={dest!.label}
                        className="inline-flex items-center gap-1.5 text-foreground/90 font-medium hover:text-accent-foreground hover:underline text-left"
                      >
                        <span className="truncate">{entityName}</span>
                        <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                      </button>
                    ) : (
                      <span className="text-foreground/90 font-medium">{entityName}</span>
                    )
                  ) : (
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-foreground/90 font-medium capitalize">{verb}</span>
                      <span className={`text-[11px] truncate ${t.result.ok ? "text-muted-foreground" : "text-destructive/90"}`}>
                        {t.result.message}
                      </span>
                    </div>
                  )}
                  {t.result.ok && entityName && (
                    <div className="text-[10.5px] text-muted-foreground/80 capitalize mt-0.5">{verb}</div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PromptInstructionsPopover({
  imageInstructions,
  videoInstructions,
  onSave,
}: {
  imageInstructions: string;
  videoInstructions: string;
  onSave: (patch: { image_prompt_instructions?: string; video_prompt_instructions?: string }) => void;
}) {
  const [imgDraft, setImgDraft] = useState(imageInstructions);
  const [vidDraft, setVidDraft] = useState(videoInstructions);
  useEffect(() => setImgDraft(imageInstructions), [imageInstructions]);
  useEffect(() => setVidDraft(videoInstructions), [videoInstructions]);

  const save = () => {
    onSave({ image_prompt_instructions: imgDraft, video_prompt_instructions: vidDraft });
    toast.success("Generation instructions saved");
  };

  const hasContent = (imageInstructions?.trim().length ?? 0) > 0 || (videoInstructions?.trim().length ?? 0) > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
          <Settings2 className="h-3.5 w-3.5" />
          Generation instructions
          {hasContent && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-accent" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[460px] p-4 space-y-4" align="end">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              Image generation instructions
            </Label>
          </div>
          <p className="text-[11px] text-muted-foreground mb-2 leading-relaxed">
            Prepended to every image prompt (covers, suspects, documents, media). Use this to lock in style,
            language, lighting, paper texture, do/don'ts. Applies to Nano Banana 2, Pro, OpenAI image, and any future model.
          </p>
          <Textarea
            rows={5}
            value={imgDraft}
            onChange={(e) => setImgDraft(e.target.value)}
            placeholder={`e.g. "All Hebrew text must be perfectly legible and right-to-left. Use authentic 1970s Israeli paper textures. Avoid modern fonts. No watermarks."`}
            className="text-xs"
          />
        </div>
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Video className="h-3.5 w-3.5 text-muted-foreground" />
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              Video generation instructions
            </Label>
          </div>
          <p className="text-[11px] text-muted-foreground mb-2 leading-relaxed">
            Prepended to every video prompt. Use this for camera motion, pacing, mood, color grading, aspect ratio guidance.
          </p>
          <Textarea
            rows={4}
            value={vidDraft}
            onChange={(e) => setVidDraft(e.target.value)}
            placeholder={`e.g. "Slow cinematic dolly-in. Cool teal/orange grade. No on-screen text. Subtle film grain."`}
            className="text-xs"
          />
        </div>
        <div className="flex justify-end pt-1">
          <Button size="sm" onClick={save}>Save instructions</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
