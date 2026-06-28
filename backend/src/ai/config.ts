/**
 * Shared DeepSeek AI configuration.
 *
 * Used by qualification OCR, budget extraction, and match scoring.
 * All keys default from environment variables with sensible fallbacks.
 */

export const AI_MODEL =
  process.env["AI_MODEL"] ?? "deepseek-v4-flash";

export const AI_BASE_URL =
  process.env["AI_BASE_URL"] ??
  "https://api.deepseek.com/v1/chat/completions";

export function getAiApiKey(): string {
  return (
    process.env["AI_API_KEY"] ??
    process.env["DEEPSEEK_API_KEY"] ??
    process.env["KIMI_API_KEY"] ??
    ""
  );
}

export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function chat(
  messages: AiChatMessage[],
  options: { temperature?: number; max_tokens?: number } = {}
): Promise<string | null> {
  const apiKey = getAiApiKey();
  if (!apiKey) {
    console.warn("DeepSeek AI: no API key configured (AI_API_KEY)");
    return null;
  }

  try {
    const response = await fetch(AI_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages,
        temperature: options.temperature ?? 0.1,
        max_tokens: options.max_tokens ?? 1024
      })
    });

    if (!response.ok) {
      console.warn(`DeepSeek API error: HTTP ${response.status}`);
      return null;
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };

    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    console.warn("DeepSeek API call failed:", String(err));
    return null;
  }
}
