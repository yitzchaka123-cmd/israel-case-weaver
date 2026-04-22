// Assistant Tweaks editor — converts plain-English requests into structured
// edits to the user's profile.assistant_tweaks list. Uses Lovable AI Gateway
// (Gemini 2.5 Flash, JSON mode). Applies the actions server-side so the
// model can't write garbage shapes into the database.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

type Rule = { id: string; text: string; created_at: string };
type Action =
  | { op: "add"; text: string }
  | { op: "edit"; id: string; text: string }
  | { op: "remove"; id: string }
  | { op: "clear" };

function uid() {
  return crypto.randomUUID();
}

function applyActions(rules: Rule[], actions: Action[]): { next: Rule[]; changes: string[] } {
  let next = [...rules];
  const changes: string[] = [];
  for (const a of actions) {
    if (a.op === "add" && a.text?.trim()) {
      const r: Rule = { id: uid(), text: a.text.trim(), created_at: new Date().toISOString() };
      next.push(r);
      changes.push(`Added rule: "${r.text}"`);
    } else if (a.op === "edit" && a.id && a.text?.trim()) {
      const idx = next.findIndex((r) => r.id === a.id);
      if (idx >= 0) {
        const old = next[idx].text;
        next[idx] = { ...next[idx], text: a.text.trim() };
        changes.push(`Edited rule: "${old}" → "${a.text.trim()}"`);
      }
    } else if (a.op === "remove" && a.id) {
      const r = next.find((x) => x.id === a.id);
      if (r) {
        next = next.filter((x) => x.id !== a.id);
        changes.push(`Removed rule: "${r.text}"`);
      }
    } else if (a.op === "clear") {
      changes.push(`Cleared all ${next.length} rules`);
      next = [];
    }
  }
  return { next, changes };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { userMessage } = await req.json();
    if (!userMessage || typeof userMessage !== "string") {
      return new Response(JSON.stringify({ error: "userMessage is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Identify the calling user from the Authorization header
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const supaAuth = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await supaAuth.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Load current rules
    const { data: profile } = await supa
      .from("profiles")
      .select("assistant_tweaks")
      .eq("id", userId)
      .maybeSingle();
    const currentRules: Rule[] = Array.isArray(profile?.assistant_tweaks)
      ? (profile!.assistant_tweaks as Rule[])
      : [];

    // Build the prompt for the rule-editor model
    const systemPrompt = `You are a rule-list editor. The user has a numbered list of "house rules" that get injected into another AI assistant's system prompt. Your job is to convert each user request into ONE OR MORE atomic edit actions to that list, and return a short conversational reply.

Operations:
- add: append a NEW rule. Provide concise, imperative "text" (one sentence, max ~25 words). Phrase as a directive the assistant should follow.
- edit: replace an existing rule's text. Provide its "id" and the new "text".
- remove: delete an existing rule by "id".
- clear: remove all rules (use only if the user explicitly asks to wipe everything).

Rules:
- Be conservative. If unsure whether to add vs edit, prefer "add". If the user says "stop X" or "forget the rule about X", look for a matching existing rule and "remove" or "edit" it.
- Keep rule text SHORT and DIRECTIVE. Examples: "Always propose at least 6 suspects." / "Avoid noir genre suggestions." / "Documents must include at least 25 realism details."
- Never invent rules the user did not ask for.
- The "reply" must be 1-2 sentences confirming what you did. No preamble.

Existing rules (with ids):
${currentRules.length === 0 ? "(none yet)" : currentRules.map((r, i) => `${i + 1}. [id:${r.id}] ${r.text}`).join("\n")}`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        tools: [{
          type: "function",
          function: {
            name: "edit_rules",
            description: "Apply edits to the user's rule list and return a reply.",
            parameters: {
              type: "object",
              properties: {
                actions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      op: { type: "string", enum: ["add", "edit", "remove", "clear"] },
                      id: { type: "string" },
                      text: { type: "string" },
                    },
                    required: ["op"],
                    additionalProperties: false,
                  },
                },
                reply: { type: "string" },
              },
              required: ["actions", "reply"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "edit_rules" } },
      }),
    });

    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("AI gateway error", aiResp.status, t);
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit — try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "Out of AI credits. Top up in Settings → Workspace → Usage." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `AI error (${aiResp.status})` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await aiResp.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    let parsed: { actions: Action[]; reply: string } = { actions: [], reply: "Sorry, I didn't catch that — try rephrasing." };
    if (call?.function?.arguments) {
      try {
        parsed = JSON.parse(call.function.arguments);
      } catch (e) {
        console.error("Failed to parse tool args", e);
      }
    }

    const { next, changes } = applyActions(currentRules, parsed.actions ?? []);

    // Persist
    const { error: upErr } = await supa
      .from("profiles")
      .update({ assistant_tweaks: next })
      .eq("id", userId);
    if (upErr) {
      console.error("profile update error", upErr);
      return new Response(JSON.stringify({ error: upErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ rules: next, reply: parsed.reply, changes }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("assistant-tweaks-edit error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
