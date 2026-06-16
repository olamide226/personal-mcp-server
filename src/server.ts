import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import type { Services } from "./runtime.js";
import { emailDraftSchema, mailSearchSchema, toolHandlers } from "./tools.js";

export function createMcpServer(config: AppConfig, services: Services): McpServer {
  const server = new McpServer(
    {
      name: config.MCP_NAME,
      version: config.MCP_VERSION
    },
    {
      capabilities: {
        logging: {}
      }
    }
  );

  const handlers = toolHandlers(services);

  server.registerTool(
    "gmail_search_messages",
    {
      title: "Search Gmail messages",
      description: "Search Gmail using Gmail query semantics built from typed filters.",
      inputSchema: mailSearchSchema
    },
    handlers.gmailSearchMessages
  );

  server.registerTool(
    "gmail_get_message",
    {
      title: "Get Gmail message",
      description: "Fetch a Gmail message by id.",
      inputSchema: {
        id: z.string().min(1)
      }
    },
    handlers.gmailGetMessage
  );

  server.registerTool(
    "custom_mail_search_messages",
    {
      title: "Search custom mailbox",
      description: "Search the configured custom IMAP mailbox.",
      inputSchema: mailSearchSchema
    },
    handlers.customMailSearchMessages
  );

  server.registerTool(
    "custom_mail_get_message",
    {
      title: "Get custom mailbox message",
      description: "Fetch a message from the configured custom IMAP mailbox by UID.",
      inputSchema: {
        uid: z.number().int().positive()
      }
    },
    handlers.customMailGetMessage
  );

  server.registerTool(
    "email_prepare_send",
    {
      title: "Prepare email send",
      description: "Validate and stage an email. Returns a confirmation id; does not send.",
      inputSchema: emailDraftSchema
    },
    handlers.emailPrepareSend
  );

  server.registerTool(
    "email_confirm_send",
    {
      title: "Confirm email send",
      description: "Send a previously prepared email using its confirmation id.",
      inputSchema: {
        confirmationId: z.string().uuid()
      }
    },
    handlers.emailConfirmSend
  );

  server.registerTool(
    "send_slack_notification",
    {
      title: "Send Slack notification",
      description: "Send a notification to the configured Slack incoming webhook.",
      inputSchema: {
        text: z.string().min(1),
        blocks: z.array(z.unknown()).optional()
      }
    },
    handlers.sendSlackNotification
  );

  server.registerTool(
    "get_my_soul_docs",
    {
      title: "Get soul docs",
      description: "Read/search personal soul docs stored in the remote SQLite-compatible DB.",
      inputSchema: {
        query: z.string().optional(),
        tag: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(20)
      }
    },
    handlers.getMySoulDocs
  );

  server.registerTool(
    "write_my_soul_doc",
    {
      title: "Write soul doc",
      description: "Create or update a personal soul doc in the remote SQLite-compatible DB.",
      inputSchema: {
        id: z.string().uuid().optional(),
        title: z.string().min(1),
        content: z.string().min(1),
        tags: z.array(z.string().min(1)).default([]),
        source: z.string().optional(),
        metadata: z.record(z.unknown()).default({})
      }
    },
    handlers.writeMySoulDoc
  );

  return server;
}
