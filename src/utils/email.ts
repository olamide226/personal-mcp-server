import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { ValidationError } from "../errors.js";
import type { EmailDraft } from "../types.js";

export function assertValidDraft(draft: EmailDraft): void {
  if (draft.to.length === 0) {
    throw new ValidationError("At least one recipient is required.");
  }
  if (!draft.subject.trim()) {
    throw new ValidationError("Subject is required.");
  }
  if (!draft.text?.trim() && !draft.html?.trim()) {
    throw new ValidationError("Either text or html body is required.");
  }
}

export function base64UrlEncode(input: string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function buildMimeMessage(draft: EmailDraft, fallbackFrom?: string): string {
  const from = draft.from ?? fallbackFrom;
  if (!from) {
    throw new ValidationError("A from address is required. Set from or EMAIL_DEFAULT_FROM.");
  }

  const headers = [
    `From: ${from}`,
    `To: ${draft.to.join(", ")}`,
    draft.cc?.length ? `Cc: ${draft.cc.join(", ")}` : undefined,
    draft.bcc?.length ? `Bcc: ${draft.bcc.join(", ")}` : undefined,
    draft.replyTo ? `Reply-To: ${draft.replyTo}` : undefined,
    `Subject: ${draft.subject}`,
    "MIME-Version: 1.0"
  ].filter(Boolean);

  if (draft.html && draft.text) {
    const boundary = `personal-mcp-${randomUUID()}`;
    return [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      draft.text,
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "",
      draft.html,
      `--${boundary}--`,
      ""
    ].join("\r\n");
  }

  return [
    ...headers,
    `Content-Type: ${draft.html ? "text/html" : "text/plain"}; charset=UTF-8`,
    "",
    draft.html ?? draft.text ?? ""
  ].join("\r\n");
}

export function decodeBase64Url(data?: string | null): string {
  if (!data) {
    return "";
  }
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}
