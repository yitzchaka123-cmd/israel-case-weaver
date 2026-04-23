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
import { Sparkles, Send, Loader2, Bot, User, Wand2, CheckCircle2, Cpu, Image as ImageIcon, Settings2, Video, ChevronRight, ExternalLink, AlertCircle, Mic, MicOff, Sliders } from "lucide-react";
import { toast } from "sonner";
import { useVoiceInput } from "@/hooks/use-voice-input";

const PLANNING_MODELS = [
  { value: "lovable", label: "Gemini 3.1 Pro (default)" },
  { value: "gemini", label: "Gemini 2.5 Pro" },
  { value: "gemini-flash", label: "Gemini 2.5 Flash (fast)" },
  { value: "openai-5.2", label: "ChatGPT 5.2 (latest)" },
  { value: "openai", label: "ChatGPT 5" },
  { value: "openai-mini", label: "ChatGPT 5 mini" },
];

const IMAGE_MODELS = [
  { value: "nano-banana-2", label: "Nano Banana 2 (default — fast + pro)" },
  { value: "nano-banana-pro", label: "Nano Banana Pro (highest quality)" },
  { value: "nano-banana", label: "Nano Banana (Gemini 2.5 Flash Image)" },
];

type ToolCall = {
  name: string;
  args?: Record<string, unknown>;
  result: { ok: boolean; message: string; id?: string };
};

type QuickOption = { label: string; send: string };

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  metadata?: { tools?: ToolCall[]; options?: QuickOption[]; question?: string | null } | null;
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

export function AssistantSection({ projectId, phase }: { projectId: string; phase: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dictationBaseRef = useRef("");

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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || sending) return;
    setInput("");
    setSending(true);
    try {
      const convo = [...messages, { role: "user" as const, content }].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/assistant-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ projectId, messages: convo }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Request failed" }));
        if (resp.status === 429) toast.error("Rate limit — please wait a moment.");
        else if (resp.status === 402) toast.error("Out of AI credits. Top up in Settings → Workspace → Usage.");
        else toast.error(err.error ?? "Assistant error");
        return;
      }
      // Message is persisted by the edge function; realtime will refresh
      qc.invalidateQueries({ queryKey: ["chat", projectId] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["suspects", projectId] });
      qc.invalidateQueries({ queryKey: ["documents", projectId] });
      qc.invalidateQueries({ queryKey: ["nodes", projectId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Assistant error");
    } finally {
      setSending(false);
    }
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
                {PLANNING_MODELS.map((m) => (
                  <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
                ))}
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

            {messages.map((m, idx) => (
              <MessageBubble
                key={m.id}
                msg={m}
                isLast={idx === messages.length - 1}
                onPickOption={(text) => send(text)}
                disabled={sending}
              />
            ))}

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
                    send(input);
                  }
                }}
                placeholder={voice.listening ? "Listening… speak now" : "Describe what you want to build, approve a proposal, or ask for the next step…"}
                className="min-h-[80px] resize-none border-0 focus-visible:ring-0 bg-transparent pr-24"
                disabled={sending}
              />
              <Button
                type="button"
                size="icon"
                variant={voice.listening ? "destructive" : "ghost"}
                onClick={toggleVoice}
                disabled={sending}
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
  disabled,
}: {
  msg: Msg;
  isLast: boolean;
  onPickOption: (text: string) => void;
  disabled: boolean;
}) {
  const tools = msg.metadata?.tools ?? [];
  const options = msg.metadata?.options ?? [];
  const question = msg.metadata?.question ?? null;
  // Only render quick-reply buttons on the most recent assistant message —
  // older proposals are stale and clicking them would be confusing.
  const showOptions = msg.role === "assistant" && isLast && options.length > 0;

  return (
    <div className="flex gap-3 items-start">
      <Avatar role={msg.role} />
      <div className="flex-1 min-w-0 pt-1">
        <div className="text-xs font-medium mb-1 text-muted-foreground">
          {msg.role === "assistant" ? "Assistant" : "You"}
        </div>
        <div className="prose prose-sm max-w-none dark:prose-invert whitespace-pre-wrap leading-relaxed text-[14.5px]">
          {msg.content}
        </div>
        {showOptions && (
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
        {tools.length > 0 && <ToolReceipts tools={tools} />}
      </div>
    </div>
  );
}

// Maps a tool name to the workspace tab the user should jump to when clicking
// the receipt. Returns null for tools that have no obvious destination
// (e.g. update_project, which doesn't navigate anywhere meaningful).
function destinationFor(toolName: string): { tab: string; label: string } | null {
  switch (toolName) {
    case "add_document":
    case "update_document":
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

function ToolReceipts({ tools }: { tools: ToolCall[] }) {
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
        <ul className="mt-2 space-y-1 border-l-2 border-border/60 pl-3">
          {tools.map((t, i) => {
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
