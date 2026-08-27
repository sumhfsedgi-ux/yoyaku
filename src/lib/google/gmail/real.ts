import { google } from "googleapis";
import MailComposer from "nodemailer/lib/mail-composer";
import { getGoogleIntegration, getSalonOAuthClient } from "@/lib/google/oauthClient";
import type { GmailService, SendEmailInput } from "./port";

const NOT_CONFIGURED = "GOOGLE_NOT_CONFIGURED";

function describeError(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

async function buildRawMessage(from: string, input: SendEmailInput): Promise<string> {
  // nodemailer's MailComposer is used purely to build a correct RFC 2822 MIME
  // message - no SMTP transport is involved anywhere in this codebase. The
  // resulting buffer is base64url-encoded and handed to the Gmail API's own
  // send endpoint instead.
  const composer = new MailComposer({
    from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
  const message = await new Promise<Buffer>((resolve, reject) => {
    composer.compile().build((err: Error | null, buffer: Buffer) => (err ? reject(err) : resolve(buffer)));
  });
  return message.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Real Gmail sender, using the salon's Gmail-purpose Google account via the
 * Gmail API (not SMTP/app-passwords) - independent from the Calendar-purpose
 * account (see GoogleIntegrationPurpose in oauthClient.ts). Never throws -
 * callers (see reservations/service.ts) treat email as a best-effort side
 * effect of booking and must not let a send failure affect the booking response.
 */
export class RealGmailService implements GmailService {
  async sendEmail(input: SendEmailInput): Promise<{ ok: true } | { ok: false; error: string }> {
    const auth = await getSalonOAuthClient("gmail");
    if (!auth) return { ok: false, error: NOT_CONFIGURED };

    try {
      const integration = await getGoogleIntegration("gmail");
      const from = integration?.googleAccountEmail ?? "me";
      const raw = await buildRawMessage(from, input);
      const gmail = google.gmail({ version: "v1", auth });
      await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: describeError(err) };
    }
  }
}
