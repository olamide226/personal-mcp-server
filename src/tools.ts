import { z } from "zod";
import type { Services } from "./runtime.js";
import { errorMessage } from "./errors.js";
import { assertValidDraft } from "./utils/email.js";
import { jsonText } from "./utils/mcp.js";
import type { EmailDraft, JsonRecord } from "./types.js";

const limitSchema = z.number().int().min(1).max(50).default(10)
  .describe("Maximum number of results (1-50).");

export const mailSearchSchema = {
  account: z.string().optional()
    .describe("Mail account label (defaults to 'default'). Use with custom IMAP mailboxes."),
  from: z.string().optional().describe("Sender email/name filter."),
  to: z.string().optional().describe("Recipient email/name filter."),
  subject: z.string().optional().describe("Subject filter."),
  text: z.string().optional().describe("Free text/body query."),
  label: z.string().optional().describe("Gmail label or IMAP keyword."),
  unread: z.boolean().optional().describe("true for unread, false for read."),
  after: z.string().optional().describe("Provider-supported date string, e.g. 2026/06/01."),
  before: z.string().optional().describe("Provider-supported date string, e.g. 2026/06/16."),
  limit: limitSchema
};

export const emailDraftSchema = {
  provider: z.enum(["gmail", "smtp"]).describe("Use gmail for Gmail API, smtp for custom SMTP."),
  account: z.string().optional()
    .describe("Mail account label for SMTP routing (defaults to 'default'). Ignored for gmail."),
  from: z.string().email().optional().describe("Sender email address."),
  to: z.array(z.string().email()).min(1).describe("Recipient email addresses (1+)."),
  cc: z.array(z.string().email()).optional().describe("CC recipient email addresses."),
  bcc: z.array(z.string().email()).optional().describe("BCC recipient email addresses."),
  subject: z.string().min(1).describe("Email subject line."),
  text: z.string().optional().describe("Plain text body."),
  html: z.string().optional().describe("HTML body."),
  replyTo: z.string().email().optional().describe("Reply-to email address.")
};

export function toolHandlers(services: Services) {
  return {
    gmailSearchMessages: audited(services, "gmail_search_messages", async (input) => {
      const messages = await services.gmail.searchMessages(input as never);
      return jsonText({ messages });
    }),

    gmailGetMessage: audited(services, "gmail_get_message", async ({ id }: { id: string }) => {
      const message = await services.gmail.getMessage(id);
      return jsonText({ message });
    }),

    customMailSearchMessages: audited(services, "custom_mail_search_messages", async (input) => {
      const messages = await services.customMail.searchMessages(input as never);
      return jsonText({ messages });
    }),

    customMailGetMessage: audited(
      services,
      "custom_mail_get_message",
      async ({ uid, account }: { uid: number; account?: string }) => {
        const message = await services.customMail.getMessage(uid, account);
        return jsonText({ message });
      }
    ),

    emailPrepareSend: audited(services, "email_prepare_send", async (draft: EmailDraft) => {
      assertValidDraft(draft);
      const prepared = await services.db.createConfirmation(draft);
      return jsonText({
        confirmation: {
          id: prepared.id,
          expiresAt: prepared.expiresAt,
          provider: prepared.provider,
          account: prepared.account,
          from: prepared.from,
          to: prepared.to,
          cc: prepared.cc,
          bcc: prepared.bcc,
          subject: prepared.subject,
          textPreview: prepared.text?.slice(0, 1000),
          htmlPreview: prepared.html?.slice(0, 1000)
        }
      });
    }),

    emailConfirmSend: audited(
      services,
      "email_confirm_send",
      async ({ confirmationId }: { confirmationId: string }) => {
        const draft = await services.db.consumeConfirmation(confirmationId);
        assertValidDraft(draft);
        const result = await services.emailSender.send(draft);
        return jsonText({ sent: true, provider: draft.provider, result });
      }
    ),

    sendSlackNotification: audited(
      services,
      "send_slack_notification",
      async ({ text, blocks }: { text: string; blocks?: unknown[] }) => {
        const result = await services.slack.sendNotification({ text, blocks });
        return jsonText(result);
      }
    ),

    getMySoulDocs: audited(
      services,
      "get_my_soul_docs",
      async ({ query, tag, limit }: { query?: string; tag?: string; limit: number }) => {
        const docs = await services.db.getSoulDocs({ query, tag, limit });
        return jsonText({ docs });
      }
    ),

    writeMySoulDoc: audited(
      services,
      "write_my_soul_doc",
      async (input: {
        id?: string;
        title: string;
        content: string;
        tags?: string[];
        source?: string;
        metadata?: JsonRecord;
      }) => {
        const doc = await services.db.writeSoulDoc(input);
        return jsonText({ doc });
      }
    )
  };
}

export function audited<TArgs>(
  services: Services,
  toolName: string,
  fn: (args: TArgs) => Promise<ReturnType<typeof jsonText>>
) {
  return async (args: TArgs) => {
    try {
      const result = await fn(args);
      await services.db
        .audit({
          toolName,
          success: true,
          metadata: summarizeArgs(args)
        })
        .catch(() => undefined);
      return result;
    } catch (error) {
      await services.db
        .audit({
          toolName,
          success: false,
          metadata: summarizeArgs(args),
          error: errorMessage(error)
        })
        .catch(() => undefined);
      return jsonText({
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: errorMessage(error)
        }
      });
    }
  };
}

function summarizeArgs(args: unknown): JsonRecord {
  if (!args || typeof args !== "object") {
    return {};
  }
  const record = args as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => {
      if (["text", "html", "content", "CUSTOM_IMAP_PASSWORD", "CUSTOM_SMTP_PASSWORD", "password", "clientSecret", "webhookUrl", "authToken"].includes(key)) {
        return [key, "[redacted]"];
      }
      if (Array.isArray(value)) {
        return [key, value.length > 5 ? [...value.slice(0, 5), "..."] : value];
      }
      if (typeof value === "string" && value.length > 160) {
        return [key, `${value.slice(0, 160)}...`];
      }
      return [key, value];
    })
  );
}
