import { GmailService } from "./gmail.js";
import { CustomMailService } from "./custom-mail.js";
import type { EmailDraft } from "../types.js";

export class EmailSenderService {
  constructor(
    private readonly gmail: GmailService,
    private readonly customMail: CustomMailService
  ) {}

  async send(draft: EmailDraft): Promise<unknown> {
    if (draft.provider === "gmail") {
      return this.gmail.send(draft);
    }
    return this.customMail.send(draft, draft.account);
  }
}
