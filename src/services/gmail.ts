import { google, gmail_v1 } from "googleapis";
import type { AppConfig } from "../config.js";
import { ConfigError, NotFoundError } from "../errors.js";
import type { EmailDraft, MailMessage, MailSearchInput, MailSummary } from "../types.js";
import { base64UrlEncode, buildMimeMessage, decodeBase64Url } from "../utils/email.js";

export class GmailService {
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  getOAuthClient() {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_REFRESH_TOKEN } =
      this.config;
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
      throw new ConfigError(
        "Gmail OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI."
      );
    }

    const client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );
    if (GOOGLE_REFRESH_TOKEN) {
      client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
    }
    return client;
  }

  async exchangeCode(code: string) {
    const client = this.getOAuthClient();
    const { tokens } = await client.getToken(code);
    return tokens;
  }

  getAuthorizationUrl(state?: string): string {
    const client = this.getOAuthClient();
    return client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.send"
      ],
      state
    });
  }

  private gmail(): gmail_v1.Gmail {
    if (!this.config.GOOGLE_REFRESH_TOKEN) {
      throw new ConfigError("GOOGLE_REFRESH_TOKEN is required for Gmail tools.");
    }
    return google.gmail({ version: "v1", auth: this.getOAuthClient() });
  }

  async searchMessages(input: MailSearchInput): Promise<MailSummary[]> {
    const gmail = this.gmail();
    const q = buildGmailQuery(input);
    const response = await gmail.users.messages.list({
      userId: "me",
      q,
      maxResults: input.limit
    });

    const messages = response.data.messages ?? [];
    const summaries = await Promise.all(
      messages.map(async (message) => {
        const detail = await gmail.users.messages.get({
          userId: "me",
          id: message.id ?? "",
          format: "metadata",
          metadataHeaders: ["From", "To", "Subject", "Date"]
        });
        return gmailMessageToSummary(detail.data);
      })
    );

    return summaries;
  }

  async getMessage(id: string): Promise<MailMessage> {
    const response = await this.gmail().users.messages.get({
      userId: "me",
      id,
      format: "full"
    });
    if (!response.data.id) {
      throw new NotFoundError("Gmail message not found.");
    }
    return gmailMessageToFullMessage(response.data);
  }

  async send(draft: EmailDraft): Promise<{ id?: string; threadId?: string }> {
    const raw = base64UrlEncode(buildMimeMessage(draft, this.config.EMAIL_DEFAULT_FROM));
    const response = await this.gmail().users.messages.send({
      userId: "me",
      requestBody: {
        raw
      }
    });
    return {
      id: response.data.id ?? undefined,
      threadId: response.data.threadId ?? undefined
    };
  }
}

function buildGmailQuery(input: MailSearchInput): string {
  const parts: string[] = [];
  if (input.from) parts.push(`from:${quoteIfNeeded(input.from)}`);
  if (input.to) parts.push(`to:${quoteIfNeeded(input.to)}`);
  if (input.subject) parts.push(`subject:${quoteIfNeeded(input.subject)}`);
  if (input.text) parts.push(quoteIfNeeded(input.text));
  if (input.label) parts.push(`label:${quoteIfNeeded(input.label)}`);
  if (input.unread !== undefined) parts.push(input.unread ? "is:unread" : "is:read");
  if (input.after) parts.push(`after:${input.after}`);
  if (input.before) parts.push(`before:${input.before}`);
  return parts.join(" ");
}

function quoteIfNeeded(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function gmailMessageToSummary(message: gmail_v1.Schema$Message): MailSummary {
  const headers = headersToRecord(message.payload?.headers);
  return {
    id: message.id ?? "",
    threadId: message.threadId ?? undefined,
    subject: headers.subject,
    from: headers.from,
    to: headers.to,
    date: headers.date,
    snippet: message.snippet ?? undefined,
    labels: message.labelIds ?? undefined,
    unread: message.labelIds?.includes("UNREAD")
  };
}

function gmailMessageToFullMessage(message: gmail_v1.Schema$Message): MailMessage {
  const summary = gmailMessageToSummary(message);
  const bodies = extractBodies(message.payload);
  return {
    ...summary,
    headers: headersToRecord(message.payload?.headers),
    bodyText: bodies.text || message.snippet || undefined,
    bodyHtml: bodies.html || undefined
  };
}

function headersToRecord(headers?: gmail_v1.Schema$MessagePartHeader[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const header of headers ?? []) {
    if (header.name && header.value) {
      record[header.name.toLowerCase()] = header.value;
    }
  }
  return record;
}

function extractBodies(part?: gmail_v1.Schema$MessagePart): { text: string; html: string } {
  if (!part) {
    return { text: "", html: "" };
  }

  let text = "";
  let html = "";
  const mimeType = part.mimeType ?? "";
  const data = decodeBase64Url(part.body?.data);
  if (mimeType === "text/plain") {
    text += data;
  } else if (mimeType === "text/html") {
    html += data;
  }

  for (const child of part.parts ?? []) {
    const childBodies = extractBodies(child);
    text += childBodies.text;
    html += childBodies.html;
  }

  return { text, html };
}
