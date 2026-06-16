import { ImapFlow, type SearchObject } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import type { AppConfig } from "../config.js";
import { ConfigError, NotFoundError } from "../errors.js";
import type { EmailDraft, MailMessage, MailSearchInput, MailSummary } from "../types.js";

export class CustomMailService {
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  async searchMessages(input: MailSearchInput): Promise<MailSummary[]> {
    return this.withImap(async (client) => {
      await client.mailboxOpen(this.config.CUSTOM_IMAP_MAILBOX);
      const uids = await client.search(buildImapQuery(input), { uid: true });
      if (!uids) {
        return [];
      }
      const limited = uids.slice(-input.limit).reverse();
      const messages = await client.fetchAll(
        limited,
        {
          uid: true,
          envelope: true,
          flags: true,
          labels: true,
          internalDate: true
        },
        { uid: true }
      );
      return messages.map((message) => ({
        id: String(message.uid),
        uid: message.uid,
        subject: message.envelope?.subject,
        from: formatAddressList(message.envelope?.from),
        to: formatAddressList(message.envelope?.to),
        date: stringifyDate(message.internalDate),
        labels: message.labels ? [...message.labels] : undefined,
        unread: message.flags ? !message.flags.has("\\Seen") : undefined
      }));
    });
  }

  async getMessage(uid: number): Promise<MailMessage> {
    return this.withImap(async (client) => {
      await client.mailboxOpen(this.config.CUSTOM_IMAP_MAILBOX);
      const message = await client.fetchOne(
        String(uid),
        {
          uid: true,
          envelope: true,
          flags: true,
          labels: true,
          internalDate: true,
          source: true
        },
        { uid: true }
      );
      if (!message) {
        throw new NotFoundError("Custom mailbox message not found.");
      }
      const parsed = message.source ? await simpleParser(message.source) : undefined;
      return {
        id: String(message.uid),
        uid: message.uid,
        subject: parsed?.subject ?? message.envelope?.subject,
        from: parsed?.from?.text ?? formatAddressList(message.envelope?.from),
        to: parsedAddressText(parsed?.to) ?? formatAddressList(message.envelope?.to),
        date: stringifyDate(message.internalDate),
        labels: message.labels ? [...message.labels] : undefined,
        unread: message.flags ? !message.flags.has("\\Seen") : undefined,
        headers: parsed ? parsedHeadersToRecord(parsed.headers) : undefined,
        bodyText: parsed?.text,
        bodyHtml: typeof parsed?.html === "string" ? parsed.html : undefined
      };
    });
  }

  async send(draft: EmailDraft): Promise<{ messageId?: string; response?: string }> {
    this.assertSmtpConfigured();
    const transporter = nodemailer.createTransport({
      host: this.config.CUSTOM_SMTP_HOST,
      port: this.config.CUSTOM_SMTP_PORT,
      secure: this.config.CUSTOM_SMTP_SECURE,
      auth: this.config.CUSTOM_SMTP_USER
        ? {
            user: this.config.CUSTOM_SMTP_USER,
            pass: this.config.CUSTOM_SMTP_PASSWORD
          }
        : undefined
    } satisfies SMTPTransport.Options);

    const result = await transporter.sendMail({
      from: draft.from ?? this.config.EMAIL_DEFAULT_FROM,
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      replyTo: draft.replyTo,
      subject: draft.subject,
      text: draft.text,
      html: draft.html
    });

    return {
      messageId: result.messageId,
      response: result.response
    };
  }

  private async withImap<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    this.assertImapConfigured();
    const client = new ImapFlow({
      host: this.config.CUSTOM_IMAP_HOST!,
      port: this.config.CUSTOM_IMAP_PORT,
      secure: this.config.CUSTOM_IMAP_SECURE,
      auth: {
        user: this.config.CUSTOM_IMAP_USER!,
        pass: this.config.CUSTOM_IMAP_PASSWORD!
      },
      logger: false
    });

    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  private assertImapConfigured(): void {
    if (
      !this.config.CUSTOM_IMAP_HOST ||
      !this.config.CUSTOM_IMAP_USER ||
      !this.config.CUSTOM_IMAP_PASSWORD
    ) {
      throw new ConfigError(
        "Custom IMAP is not configured. Set CUSTOM_IMAP_HOST, CUSTOM_IMAP_USER, and CUSTOM_IMAP_PASSWORD."
      );
    }
  }

  private assertSmtpConfigured(): void {
    if (!this.config.CUSTOM_SMTP_HOST) {
      throw new ConfigError("Custom SMTP is not configured. Set CUSTOM_SMTP_HOST.");
    }
  }
}

function buildImapQuery(input: MailSearchInput): SearchObject {
  const query: SearchObject = { all: true };
  if (input.from) query.from = input.from;
  if (input.to) query.to = input.to;
  if (input.subject) query.subject = input.subject;
  if (input.text) query.text = input.text;
  if (input.unread !== undefined) query.seen = !input.unread;
  if (input.after) query.since = input.after;
  if (input.before) query.before = input.before;
  if (input.label) query.keyword = input.label;
  return query;
}

function formatAddressList(addresses?: Array<{ name?: string; address?: string }>): string | undefined {
  if (!addresses?.length) {
    return undefined;
  }
  return addresses
    .map((address) => (address.name ? `${address.name} <${address.address}>` : address.address))
    .filter(Boolean)
    .join(", ");
}

function stringifyDate(value?: Date | string): string | undefined {
  if (!value) {
    return undefined;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function parsedAddressText(
  value?: { text: string } | Array<{ text: string }>
): string | undefined {
  if (!value) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((item) => item.text).join(", ");
  }
  return value.text;
}

function parsedHeadersToRecord(headers: Map<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    [...headers.entries()].map(([key, value]) => [key, stringifyHeaderValue(value)])
  );
}

function stringifyHeaderValue(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => stringifyHeaderValue(item)).join(", ");
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value ?? "");
}
