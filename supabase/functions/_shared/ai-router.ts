// Shared AI router: sends OpenAI models (openai/*) directly to api.openai.com using
// the user's OpenAi secret, and Gemini / other models through the Lovable AI Gateway.
// Returns the underlying Response so callers can stream or read JSON.

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OpenAi") ?? Deno.env.get("OPENAI_API_KEY") ?? "";

export function isOpenAIModel(model: string): boolean {
  return typeof model === "string" && model.startsWith("openai/");
}

/**
 * Route a chat-completions request to the right provider based on model id.
 * - "openai/<id>" → https://api.openai.com/v1/chat/completions using OpenAI key (model id stripped of prefix)
 * - anything else → Lovable AI Gateway using LOVABLE_API_KEY
 *
 * The body is forwarded as-is, except the `model` field is rewritten when targeting OpenAI.
 */
export async function chatCompletions(body: Record<string, unknown>): Promise<Response> {
  const model = String(body.model ?? "");
  if (isOpenAIModel(model)) {
    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "OpenAI API key (OpenAi secret) is not configured" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    const openaiBody = { ...body, model: model.slice("openai/".length) };
    return await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(openaiBody),
    });
  }
  return await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export function providerLabel(model: string): string {
  return isOpenAIModel(model) ? "openai-direct" : "lovable-ai";
}
