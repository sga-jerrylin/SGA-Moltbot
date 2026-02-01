import { fetch } from "undici";

export interface SgaConfig {
  endpoint: string;
  token?: string;
}

export interface SgaMessagePayload {
  to: string;
  content: string;
  type: "text";
}

export class SgaClient {
  constructor(private config: SgaConfig) {}

  async sendMessage(to: string, text: string): Promise<void> {
    const url = new URL("/message/send", this.config.endpoint);

    // Determine payload based on sga-cow generic structure
    // Adjusting to a likely structure for "chatgpt-on-wechat" forks or similar
    const payload = {
      to_user_id: to,
      content: text,
      type: "text"
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.config.token) {
      headers["Authorization"] = `Bearer ${this.config.token}`;
    }

    const res = await fetch(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`SGA send failed: ${res.status} ${body}`);
    }
  }
}
