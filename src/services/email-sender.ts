import { GmailService } from "./gmail.js";
import { CustomMailService } from "./custom-mail.js";
import { logInfo } from "../logger.js";
import type { EmailDraft } from "../types.js";

export class EmailSenderService {
  constructor(
    private readonly gmail: GmailService,
    private readonly customMail: CustomMailService
  ) {}

  async send(draft: EmailDraft): Promise<unknown> {
    logInfo("Sending email", {
      provider: draft.provider,
      account: draft.account,
      to: draft.to,
      cc: draft.cc,
      subject: draft.subject
    });
    const result =
      draft.provider === "gmail"
        ? await this.gmail.send(draft)
        : await this.customMail.send(draft, draft.account);
    logInfo("Email sent", {
      provider: draft.provider,
      account: draft.account,
      to: draft.to,
      subject: draft.subject,
      result
    });
    return result;
  }
}
