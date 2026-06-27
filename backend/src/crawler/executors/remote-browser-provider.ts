import type { RemoteBrowserProvider, RemoteBrowserSession } from "./types.js";

interface BrowserbaseSessionResponse {
  id?: string;
  connectUrl?: string;
  websocketUrl?: string;
}

const BROWSERBASE_SESSIONS_URL = "https://api.browserbase.com/v1/sessions";

export class BrowserbaseProvider implements RemoteBrowserProvider {
  async createSession(): Promise<RemoteBrowserSession> {
    const apiKey = process.env.BROWSERBASE_API_KEY;
    const projectId = process.env.BROWSERBASE_PROJECT_ID;

    if (!apiKey || !projectId) {
      throw new Error(
        "Missing Browserbase credentials: BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID are required"
      );
    }

    const response = await fetch(BROWSERBASE_SESSIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BB-API-Key": apiKey
      },
      body: JSON.stringify({ projectId })
    });

    if (!response.ok) {
      throw new Error(
        `Browserbase session creation failed with HTTP ${response.status}`
      );
    }

    const data = (await response.json()) as BrowserbaseSessionResponse;
    const connectUrl = data.connectUrl ?? data.websocketUrl;

    if (!data.id || !connectUrl) {
      throw new Error("Browserbase session response missing id or connect URL");
    }

    return {
      sessionId: data.id,
      connectUrl
    };
  }

  async closeSession(sessionId: string): Promise<void> {
    void sessionId;
  }
}
