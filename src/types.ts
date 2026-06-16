export type JsonRecord = Record<string, unknown>;

export interface MailSearchInput {
  from?: string;
  to?: string;
  subject?: string;
  text?: string;
  label?: string;
  unread?: boolean;
  after?: string;
  before?: string;
  limit: number;
}

export interface MailSummary {
  id: string;
  threadId?: string;
  uid?: number;
  subject?: string;
  from?: string;
  to?: string;
  date?: string;
  snippet?: string;
  labels?: string[];
  unread?: boolean;
}

export interface MailMessage extends MailSummary {
  bodyText?: string;
  bodyHtml?: string;
  headers?: Record<string, string>;
}

export interface EmailDraft {
  provider: "gmail" | "smtp";
  from?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
}

export interface PreparedEmail extends EmailDraft {
  id: string;
  expiresAt: string;
}

export interface SoulDoc {
  id: string;
  title: string;
  content: string;
  tags: string[];
  source?: string;
  metadata: JsonRecord;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  toolName: string;
  success: boolean;
  metadata?: JsonRecord;
  error?: string;
}
