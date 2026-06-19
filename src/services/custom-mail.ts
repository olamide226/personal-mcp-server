import { ImapFlow, type SearchObject } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import type { AppConfig } from "../config.js";
import { ConfigError, NotFoundError } from "../errors.js";
import type {
  EmailDraft,
  MailAccount,
  MailAccountStatus,
  MailMessage,
  MailSearchInput,
  MailSummary
} from "../types.js";

const DEFAULT_LABEL = "default";

export class CustomMailService {
  private readonly config: AppConfig;
  private readonly accounts: Map<string, MailAccount>;

  constructor(config: AppConfig) {
    this.config = config;
    this.accounts = buildAccounts(config);
  }

  // ── Account management ──────────────────────────────────────

  /** Return status summaries for all configured accounts (no secrets). */
  listAccountLabels(): MailAccountStatus[] {
    const result: MailAccountStatus[] = [];
    for (const [label, account] of this.accounts) {
      result.push({
        label,
        imapConfigured: Boolean(account.imap?.host && account.imap.user && account.imap.password),
        smtpConfigured: Boolean(account.smtp?.host),
        defaultFrom: account.defaultFrom
      });
    }
    return result;
  }

  /** Add or update an account at runtime. The "default" label is reserved. */
  addOrUpdateAccount(account: MailAccount): void {
    if (account.label === DEFAULT_LABEL) {
      throw new ConfigError(
        `"${DEFAULT_LABEL}" is a reserved label. Use setup_custom_mail_imap/smtp without an account param to configure the default account.`
      );
    }
    const existing = this.accounts.get(account.label);
    this.accounts.set(account.label, {
      label: account.label,
      imap: account.imap ?? existing?.imap,
      smtp: account.smtp ?? existing?.smtp,
      defaultFrom: account.defaultFrom ?? existing?.defaultFrom
    });
  }

  /** Remove a non-default account. */
  removeAccount(label: string): void {
    if (label === DEFAULT_LABEL) {
      throw new ConfigError("Cannot remove the default account.");
    }
    if (!this.accounts.has(label)) {
      throw new NotFoundError(`Account "${label}" not found.`);
    }
    this.accounts.delete(label);
  }

  /** Resolve an account label to its config. Defaults to "default". */
  private getAccount(label?: string): MailAccount {
    const key = label ?? DEFAULT_LABEL;
    const account = this.accounts.get(key);
    if (!account) {
      throw new NotFoundError(
        `Mail account "${key}" not found. Available: ${[...this.accounts.keys()].join(", ")}.`
      );
    }
    return account;
  }

  // ── IMAP operations ─────────────────────────────────────────

  async searchMessages(input: MailSearchInput): Promise<MailSummary[]> {
    const account = this.getAccount(input.account);
    this.assertImapConfigured(account);
    return this.withImap(account, async (client) => {
      await client.mailboxOpen(account.imap!.mailbox);
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

  async getMessage(uid: number, accountLabel?: string): Promise<MailMessage> {
    const account = this.getAccount(accountLabel);
    this.assertImapConfigured(account);
    return this.withImap(account, async (client) => {
      await client.mailboxOpen(account.imap!.mailbox);
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

  // ── SMTP operations ─────────────────────────────────────────

  async send(
    draft: EmailDraft,
    accountLabel?: string
  ): Promise<{ messageId?: string; response?: string }> {
    const account = this.getAccount(draft.account ?? accountLabel);
    this.assertSmtpConfigured(account);
    const transporter = nodemailer.createTransport({
      host: account.smtp!.host,
      port: account.smtp!.port,
      secure: account.smtp!.secure,
      auth: account.smtp!.user
        ? { user: account.smtp!.user, pass: account.smtp!.password }
        : undefined
    } satisfies SMTPTransport.Options);

    const result = await transporter.sendMail({
      from: draft.from ?? account.defaultFrom ?? this.config.EMAIL_DEFAULT_FROM,
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

  // ── Connection tests ────────────────────────────────────────

  async testImapConnection(accountLabel?: string): Promise<void> {
    const account = this.getAccount(accountLabel);
    this.assertImapConfigured(account);
    await this.withImap(account, async () => undefined);
  }

  async testSmtpConnection(accountLabel?: string): Promise<void> {
    const account = this.getAccount(accountLabel);
    this.assertSmtpConfigured(account);
    const transporter = nodemailer.createTransport({
      host: account.smtp!.host,
      port: account.smtp!.port,
      secure: account.smtp!.secure,
      auth: account.smtp!.user
        ? { user: account.smtp!.user, pass: account.smtp!.password }
        : undefined
    } satisfies SMTPTransport.Options);
    await transporter.verify();
  }

  // ── Private helpers ──────────────────────────────────────────

  private async withImap<T>(
    account: MailAccount,
    fn: (client: ImapFlow) => Promise<T>
  ): Promise<T> {
    const imap = account.imap!;
    const client = new ImapFlow({
      host: imap.host,
      port: imap.port,
      secure: imap.secure,
      auth: { user: imap.user, pass: imap.password },
      logger: false
    });

    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  private assertImapConfigured(account: MailAccount): void {
    if (!account.imap?.host || !account.imap.user || !account.imap.password) {
      throw new ConfigError(
        `IMAP is not configured for account "${account.label}". ` +
        "Set IMAP credentials via .env or the setup_custom_mail_imap tool."
      );
    }
  }

  private assertSmtpConfigured(account: MailAccount): void {
    if (!account.smtp?.host) {
      throw new ConfigError(
        `SMTP is not configured for account "${account.label}". ` +
        "Set SMTP credentials via .env or the setup_custom_mail_smtp tool."
      );
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────

function buildAccounts(config: AppConfig): Map<string, MailAccount> {
  const map = new Map<string, MailAccount>();

  // Default account from flat env vars (backward compat)
  const defaultAccount: MailAccount = {
    label: DEFAULT_LABEL
  };

  if (config.CUSTOM_IMAP_HOST) {
    defaultAccount.imap = {
      host: config.CUSTOM_IMAP_HOST,
      port: config.CUSTOM_IMAP_PORT,
      secure: config.CUSTOM_IMAP_SECURE,
      user: config.CUSTOM_IMAP_USER ?? "",
      password: config.CUSTOM_IMAP_PASSWORD ?? "",
      mailbox: config.CUSTOM_IMAP_MAILBOX
    };
  }

  if (config.CUSTOM_SMTP_HOST) {
    defaultAccount.smtp = {
      host: config.CUSTOM_SMTP_HOST,
      port: config.CUSTOM_SMTP_PORT,
      secure: config.CUSTOM_SMTP_SECURE,
      user: config.CUSTOM_SMTP_USER,
      password: config.CUSTOM_SMTP_PASSWORD
    };
  }

  if (config.EMAIL_DEFAULT_FROM) {
    defaultAccount.defaultFrom = config.EMAIL_DEFAULT_FROM;
  }

  map.set(DEFAULT_LABEL, defaultAccount);

  // Additional accounts from JSON env var
  if (config.CUSTOM_MAIL_ACCOUNTS) {
    let raw: unknown;
    try {
      raw = JSON.parse(config.CUSTOM_MAIL_ACCOUNTS);
    } catch {
      throw new ConfigError("CUSTOM_MAIL_ACCOUNTS is not valid JSON.");
    }
    if (!Array.isArray(raw)) {
      throw new ConfigError("CUSTOM_MAIL_ACCOUNTS must be a JSON array.");
    }

    for (const item of raw) {
      const account = parseMailAccount(item);
      if (account.label === DEFAULT_LABEL) {
        throw new ConfigError(
          `"${DEFAULT_LABEL}" is a reserved label in CUSTOM_MAIL_ACCOUNTS. ` +
          "Use the CUSTOM_IMAP_* / CUSTOM_SMTP_* env vars for the default account."
        );
      }
      if (map.has(account.label)) {
        throw new ConfigError(
          `Duplicate mail account label "${account.label}" in CUSTOM_MAIL_ACCOUNTS.`
        );
      }
      map.set(account.label, account);
    }
  }

  return map;
}

function parseMailAccount(item: unknown): MailAccount {
  if (!item || typeof item !== "object") {
    throw new ConfigError("Each entry in CUSTOM_MAIL_ACCOUNTS must be an object.");
  }
  const o = item as Record<string, unknown>;

  if (typeof o.label !== "string" || !o.label) {
    throw new ConfigError("Each entry in CUSTOM_MAIL_ACCOUNTS requires a non-empty 'label' string.");
  }

  const account: MailAccount = { label: o.label };

  if (o.defaultFrom && typeof o.defaultFrom === "string") {
    account.defaultFrom = o.defaultFrom;
  }

  if (o.imap && typeof o.imap === "object") {
    const imap = o.imap as Record<string, unknown>;
    if (typeof imap.host !== "string" || !imap.host) {
      throw new ConfigError(`IMAP host is required for account "${o.label}".`);
    }
    account.imap = {
      host: imap.host as string,
      port: typeof imap.port === "number" ? imap.port : 993,
      secure: imap.secure !== false,
      user: typeof imap.user === "string" ? imap.user : "",
      password: typeof imap.password === "string" ? imap.password : "",
      mailbox: typeof imap.mailbox === "string" ? imap.mailbox : "INBOX"
    };
  }

  if (o.smtp && typeof o.smtp === "object") {
    const smtp = o.smtp as Record<string, unknown>;
    if (typeof smtp.host !== "string" || !smtp.host) {
      throw new ConfigError(`SMTP host is required for account "${o.label}".`);
    }
    account.smtp = {
      host: smtp.host as string,
      port: typeof smtp.port === "number" ? smtp.port : 587,
      secure: smtp.secure === true,
      user: typeof smtp.user === "string" ? smtp.user : undefined,
      password: typeof smtp.password === "string" ? smtp.password : undefined
    };
  }

  return account;
}

// ── IMAP helpers ───────────────────────────────────────────────

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

function formatAddressList(
  addresses?: Array<{ name?: string; address?: string }>
): string | undefined {
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
