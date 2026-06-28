/**
 * Configurable truncation and retry settings for AI extraction.
 *
 * Controls how much text is sent to DeepSeek for parsing.
 * Conservative defaults — auto-expands on retry if extraction fails.
 */

/** Maximum chars for page HTML preprocessing (before AI). */
export const MAX_PAGE_CHARS =
  Number(process.env["AI_MAX_PAGE_CHARS"]) || 15000;

/** Maximum chars for attachment text (PDF/DOCX) sent to AI. */
export const MAX_ATTACH_CHARS =
  Number(process.env["AI_MAX_ATTACH_CHARS"]) || 10000;

/** Maximum chars for page HTML in combined mode (page + attachment). */
export const MAX_COMBINED_PAGE_CHARS =
  Number(process.env["AI_COMBINED_PAGE_CHARS"]) || 8000;

/** Retry multiplier: if extraction fails, multiply limits by this for retry. */
const RETRY_MULTIPLIER = 2;

/** Max retries with expanding window. */
const MAX_RETRIES = 2;

/**
 * Auto-expanding extraction window.
 *
 * Called with a fn that takes (pageLimit, attachLimit) and returns
 * extracted fields. If the result is null or missing key fields,
 * retries with doubled limits up to MAX_RETRIES times.
 */
export async function withAdaptiveExtraction<T extends { budgetAmount?: number; deadlineTime?: string } | null>(
  fn: (pageLimit: number, attachLimit: number) => Promise<T>
): Promise<T> {
  let pageLimit = MAX_PAGE_CHARS;
  let attachLimit = MAX_ATTACH_CHARS;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await fn(pageLimit, attachLimit);

    // Success: got both key fields or this is the last attempt
    if (
      attempt === MAX_RETRIES ||
      (result && result.budgetAmount && result.deadlineTime)
    ) {
      return result;
    }

    // Partial success: got one field, only need to expand for the other
    const missingBudget = !result?.budgetAmount;
    const missingDeadline = !result?.deadlineTime;

    if (missingBudget || missingDeadline) {
      console.log(
        `AI extraction attempt ${attempt + 1}: ` +
        `${missingBudget ? 'budget missing' : ''} ${missingDeadline ? 'deadline missing' : ''}, ` +
        `retrying with ${pageLimit * RETRY_MULTIPLIER}/${attachLimit * RETRY_MULTIPLIER} chars`
      );
      pageLimit = pageLimit * RETRY_MULTIPLIER;
      attachLimit = attachLimit * RETRY_MULTIPLIER;
    } else {
      return result;
    }
  }

  // Should never reach here due to MAX_RETRIES check above
  return await fn(pageLimit, attachLimit);
}
