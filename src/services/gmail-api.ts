import { OAuth2Client } from "google-auth-library";
import type { AppConfig } from "../config.js";

// ── Auth ──

export function createOAuthClient(config: AppConfig): OAuth2Client {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = config;
  return new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

// ── Gmail REST API types (replaces gmail_v1 from googleapis) ──

export interface GmailMessagePartHeader {
  name?: string | null;
  value?: string | null;
}

export interface GmailMessagePartBody {
  size?: number | null;
  data?: string | null;
  attachmentId?: string | null;
}

export interface GmailMessagePart {
  partId?: string | null;
  mimeType?: string | null;
  headers?: GmailMessagePartHeader[] | null;
  body?: GmailMessagePartBody | null;
  parts?: GmailMessagePart[] | null;
}

export interface GmailMessage {
  id?: string | null;
  threadId?: string | null;
  labelIds?: string[] | null;
  snippet?: string | null;
  payload?: GmailMessagePart | null;
}

export interface GmailMessageListResponse {
  messages?: Array<{ id?: string | null; threadId?: string | null }> | null;
  resultSizeEstimate?: number | null;
}

export interface GmailSendResponse {
  id?: string | null;
  threadId?: string | null;
  labelIds?: string[] | null;
}

// ── HTTP helpers ──

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1";

async function gmailRequest<T>(
  auth: OAuth2Client,
  path: string,
  opts: {
    method?: string;
    qs?: Record<string, string | number | undefined>;
    body?: unknown;
  } = {},
): Promise<T> {
  const url = new URL(`${GMAIL_BASE}${path}`);
  if (opts.qs) {
    for (const [k, v] of Object.entries(opts.qs)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = await auth.getRequestHeaders();
  headers["Content-Type"] = "application/json";

  const response = await fetch(url.toString(), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gmail API ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}

// ── Public Gmail API ──

export async function listMessages(
  auth: OAuth2Client,
  params: { q?: string; maxResults?: number },
): Promise<GmailMessageListResponse> {
  return gmailRequest<GmailMessageListResponse>(auth, "/users/me/messages", {
    qs: { q: params.q, maxResults: params.maxResults },
  });
}

export async function getMessage(
  auth: OAuth2Client,
  id: string,
  format: "full" | "metadata" | "minimal" = "full",
  metadataHeaders?: string[],
): Promise<GmailMessage> {
  return gmailRequest<GmailMessage>(auth, `/users/me/messages/${id}`, {
    qs: {
      format,
      ...(metadataHeaders?.length ? { metadataHeaders: metadataHeaders.join(",") } : {}),
    },
  });
}

export async function sendMessage(
  auth: OAuth2Client,
  raw: string,
): Promise<GmailSendResponse> {
  return gmailRequest<GmailSendResponse>(auth, "/users/me/messages/send", {
    method: "POST",
    body: { raw },
  });
}
