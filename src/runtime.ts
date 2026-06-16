import type { AppConfig } from "./config.js";
import { CustomMailService } from "./services/custom-mail.js";
import { DatabaseService } from "./services/database.js";
import { EmailSenderService } from "./services/email-sender.js";
import { GmailService } from "./services/gmail.js";
import { SlackService } from "./services/slack.js";

export interface Services {
  db: DatabaseService;
  gmail: GmailService;
  customMail: CustomMailService;
  emailSender: EmailSenderService;
  slack: SlackService;
}

export function createServices(config: AppConfig): Services {
  const db = new DatabaseService(config);
  const gmail = new GmailService(config);
  const customMail = new CustomMailService(config);
  return {
    db,
    gmail,
    customMail,
    emailSender: new EmailSenderService(gmail, customMail),
    slack: new SlackService(config)
  };
}
