import type { AppConfig } from "../config.js";
import { ConfigError } from "../errors.js";

export class SlackService {
  constructor(private readonly config: AppConfig) {}

  async sendNotification(input: { text: string; blocks?: unknown[] }): Promise<{ ok: true }> {
    if (!this.config.SLACK_WEBHOOK_URL) {
      throw new ConfigError("SLACK_WEBHOOK_URL is required for Slack notifications.");
    }

    const response = await fetch(this.config.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        text: input.text,
        blocks: input.blocks
      })
    });

    if (!response.ok) {
      throw new Error(`Slack webhook failed with HTTP ${response.status}: ${await response.text()}`);
    }

    return { ok: true };
  }
}
