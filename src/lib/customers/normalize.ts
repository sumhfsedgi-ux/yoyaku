/**
 * Pure normalization helpers for customer contact-info matching (search and
 * duplicate detection). Phone numbers only ever need digit-stripping - not
 * full/half-width conversion - because phoneSchema (lib/validation/schemas.ts)
 * already restricts stored phone values to ASCII digits/symbols, so a
 * full-width-typed number is rejected before it can ever reach the database.
 */

export function normalizePhoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
