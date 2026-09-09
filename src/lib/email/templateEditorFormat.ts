import { RESERVATION_EMAIL_TAGS, TAG_PATTERN, type ReservationEmailTag } from "./reservationEmailTemplate";

/**
 * Japanese display labels for the Settings Textarea only - the DB always
 * stores {{tag}} form (see reservationEmailTemplate.ts). Kept here, not
 * there, because this module's whole job is UI display <-> storage
 * conversion, a concern the renderer itself doesn't need to know about.
 */
export const TOKEN_LABELS: Record<ReservationEmailTag, string> = {
  customerName: "お客様名",
  reservationDate: "予約日",
  startTime: "開始時間",
  endTime: "終了時間",
  reservationTime: "予約時間",
  reservationDateTime: "予約日時",
  salonName: "サロン名",
};

const LABEL_TO_TAG: Record<string, ReservationEmailTag> = Object.fromEntries(
  RESERVATION_EMAIL_TAGS.map((tag) => [TOKEN_LABELS[tag], tag]),
) as Record<string, ReservationEmailTag>;

function isKnownTag(tag: string): tag is ReservationEmailTag {
  return (RESERVATION_EMAIL_TAGS as readonly string[]).includes(tag);
}

const BRACKET_PATTERN = /【([^【】]+)】/g;

/**
 * DB template string ({{tag}}) -> Textarea display text (【label】), so a
 * staff member editing this never sees an internal key name. An unknown
 * {{tag}} (e.g. a hand-edited/legacy DB value) is left as literal text,
 * matching renderReservationEmailTemplate's own fallback - never crashes.
 */
export function templateToEditorText(body: string): string {
  return body.replace(TAG_PATTERN, (match, tag: string) => (isKnownTag(tag) ? `【${TOKEN_LABELS[tag]}】` : match));
}

/**
 * Textarea display text -> DB template string. Only converts a 【...】 whose
 * inner text is an EXACT match for one of the 7 known labels - an
 * incomplete/mistyped bracket (【お客様】, 【予約日時間】) or ordinary
 * Japanese prose using 【】 is left untouched rather than misread as a tag.
 * The inverse of templateToEditorText.
 */
export function editorTextToTemplate(text: string): string {
  return text.replace(BRACKET_PATTERN, (match, label: string) => {
    const tag = LABEL_TO_TAG[label];
    return tag ? `{{${tag}}}` : match;
  });
}
