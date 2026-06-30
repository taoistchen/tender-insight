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

/** HTTP statuses worth retrying (rate limit + transient server errors). */
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

/** Max retries on transient errors (network / 5xx / 429 / timeout). */
const TRANSIENT_RETRIES = 2;

/** Per-request hard timeout — a hung connection is a transient failure. */
const REQUEST_TIMEOUT_MS = 60_000;

function backoffMs(attempt: number): number {
  // 500ms, 1000ms, ... with ±20% jitter
  const base = 500 * 2 ** attempt;
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.round(base * jitter);
}

function isTransientError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return (
    msg.includes("abort") ||
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("fetch failed") ||
    msg.includes("socket hang up") ||
    msg.includes("network")
  );
}

/**
 * One AI call with two independent retry layers:
 *   1. Transient retry — network errors / HTTP 429/5xx / request timeout,
 *      same params, exponential backoff. So a flaky network moment no longer
 *      drops us straight into the regex fallback.
 *   2. Truncation retry — reasoning model exhausted the token budget on
 *      chain-of-thought and left `content` empty/truncated; retry once with
 *      doubled max_tokens.
 */
async function callOnce(
  apiKey: string,
  messages: AiChatMessage[],
  options: { temperature?: number; max_tokens?: number },
  maxTokens: number
): Promise<{ ok: true; content: string; finishReason?: string } | { ok: false; transient: boolean; status?: number }> {
  for (let attempt = 0; attempt <= TRANSIENT_RETRIES; attempt++) {
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
          max_tokens: maxTokens
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });

      if (response.ok) {
        const data = (await response.json()) as {
          choices?: {
            finish_reason?: string;
            message?: { content?: string };
          }[];
        };
        const choice = data.choices?.[0];
        return {
          ok: true,
          content: choice?.message?.content?.trim() ?? "",
          finishReason: choice?.finish_reason
        };
      }

      const transient = TRANSIENT_STATUSES.has(response.status);
      if (transient && attempt < TRANSIENT_RETRIES) {
        console.warn(
          `DeepSeek API HTTP ${response.status}, retry ${attempt + 1}/${TRANSIENT_RETRIES} in ${backoffMs(attempt)}ms`
        );
        await new Promise((r) => setTimeout(r, backoffMs(attempt)));
        continue;
      }
      console.warn(`DeepSeek API error: HTTP ${response.status}`);
      return { ok: false, transient, status: response.status };
    } catch (err) {
      const transient = isTransientError(err);
      if (transient && attempt < TRANSIENT_RETRIES) {
        console.warn(
          `DeepSeek API call failed: ${String(err)}, retry ${attempt + 1}/${TRANSIENT_RETRIES} in ${backoffMs(attempt)}ms`
        );
        await new Promise((r) => setTimeout(r, backoffMs(attempt)));
        continue;
      }
      console.warn(`DeepSeek API call failed: ${String(err)}`);
      return { ok: false, transient };
    }
  }
  return { ok: false, transient: true };
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

  let maxTokens = options.max_tokens ?? 1024;
  for (let truncAttempt = 0; truncAttempt < 2; truncAttempt++) {
    const result = await callOnce(apiKey, messages, options, maxTokens);

    if (!result.ok) {
      // Transient retries already exhausted inside callOnce; non-transient
      // (e.g. 401/400) is not recoverable by retrying.
      return null;
    }

    const { content, finishReason } = result;
    const truncated = finishReason === "length" || content === "";

    if (truncated && truncAttempt === 0) {
      console.warn(
        `DeepSeek AI: ${finishReason || "empty content"} at max_tokens=${maxTokens}, retrying with ${maxTokens * 2}`
      );
      maxTokens *= 2;
      continue;
    }
    if (content === "") {
      console.warn(
        `DeepSeek AI: empty content (finish=${finishReason ?? "?"}) after retry`
      );
      return null;
    }
    return content;
  }
  return null;
}
