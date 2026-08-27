export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Sends mail from the salon's single shared Gmail account. Never throws -
 * failures are always {ok:false}, since Gmail sending is a best-effort side
 * effect of booking (see reservations/service.ts) and must never be allowed to
 * fail the booking response to the customer.
 */
export interface GmailService {
  sendEmail(input: SendEmailInput): Promise<{ ok: true } | { ok: false; error: string }>;
}
