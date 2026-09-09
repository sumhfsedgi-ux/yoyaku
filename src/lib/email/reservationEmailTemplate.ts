import { formatClockTime, formatReservationDateForCustomer } from "@/lib/time/tz";

export const RESERVATION_EMAIL_TAGS = [
  "customerName",
  "reservationDate",
  "startTime",
  "endTime",
  "reservationTime",
  "reservationDateTime",
  "salonName",
] as const;

export type ReservationEmailTag = (typeof RESERVATION_EMAIL_TAGS)[number];
export type ReservationEmailVariables = Record<ReservationEmailTag, string>;

/** Exported so templateEditorFormat.ts can reuse the exact same tag-matching regex - one canonical pattern, not two. */
export const TAG_PATTERN = /\{\{(\w+)\}\}/g;

function isKnownTag(tag: string): tag is ReservationEmailTag {
  return (RESERVATION_EMAIL_TAGS as readonly string[]).includes(tag);
}

/** Every {{tag}} found in `text`, de-duplicated, in first-seen order. */
export function extractTags(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(TAG_PATTERN)) seen.add(match[1]);
  return [...seen];
}

/**
 * Pure substitution - the ONLY place {{tag}} replacement happens. Used
 * identically by the Settings preview (imported directly into the client
 * component) and the real Gmail send (buildCustomerConfirmationEmail), so
 * there is exactly one rendering rule and preview/send can never diverge. An
 * unknown tag is left as literal `{{tag}}` text rather than throwing -
 * validateReservationEmailTemplate() is what rejects those at save time; this
 * function must never crash on unexpected input (e.g. a hand-edited DB row).
 */
export function renderReservationEmailTemplate(template: string, variables: ReservationEmailVariables): string {
  return template.replace(TAG_PATTERN, (match, tag: string) => (isKnownTag(tag) ? variables[tag] : match));
}

/** Tags that alone establish "the date is known". */
const DATE_TAGS: ReservationEmailTag[] = ["reservationDate", "reservationDateTime"];
/** Tags that alone establish "the start time is known". */
const START_TIME_TAGS: ReservationEmailTag[] = ["startTime", "reservationTime", "reservationDateTime"];

function hasDateInfo(tags: string[]): boolean {
  return tags.some((t) => DATE_TAGS.includes(t as ReservationEmailTag));
}

function hasStartTimeInfo(tags: string[]): boolean {
  return tags.some((t) => START_TIME_TAGS.includes(t as ReservationEmailTag));
}

export type TemplateValidationResult =
  | { ok: true }
  | { ok: false; reason: "UNKNOWN_TAG"; tag: string }
  | { ok: false; reason: "MISSING_CUSTOMER_NAME" }
  | { ok: false; reason: "MISSING_DATETIME" };

/**
 * Shared by the Settings save action and the send-time defensive re-check
 * (see src/lib/email/emailTemplateSettings.ts). Requires {{customerName}} and
 * requires BOTH date info and start-time info to be derivable from the tags
 * present - a single tag like {{reservationTime}} (start-end, no date) or
 * {{reservationDate}} alone (date, no time) is not enough on its own.
 */
export function validateReservationEmailTemplate(body: string): TemplateValidationResult {
  const tags = extractTags(body);
  for (const tag of tags) {
    if (!isKnownTag(tag)) return { ok: false, reason: "UNKNOWN_TAG", tag };
  }
  if (!tags.includes("customerName")) return { ok: false, reason: "MISSING_CUSTOMER_NAME" };
  if (!(hasDateInfo(tags) && hasStartTimeInfo(tags))) return { ok: false, reason: "MISSING_DATETIME" };
  return { ok: true };
}

/**
 * Builds the real substitution values for one reservation. `startAt`/`endAt`
 * are always Reservation's own stored instants (the actual 60-minute service
 * window) - never re-derived from a fixed duration constant.
 */
export function buildReservationEmailVariables(params: {
  customerName: string;
  startAt: Date;
  endAt: Date;
  salonName: string | null;
}): ReservationEmailVariables {
  const reservationDate = formatReservationDateForCustomer(params.startAt);
  const startTime = formatClockTime(params.startAt);
  const endTime = formatClockTime(params.endAt);
  const reservationTime = `${startTime}〜${endTime}`;
  return {
    customerName: params.customerName,
    reservationDate,
    startTime,
    endTime,
    reservationTime,
    reservationDateTime: `${reservationDate}${reservationTime}`,
    salonName: params.salonName ?? "",
  };
}

/** Sample values for the Settings preview - never used for a real send. */
export const SAMPLE_RESERVATION_EMAIL_VARIABLES: ReservationEmailVariables = {
  customerName: "田中 花子",
  reservationDate: "9月22日（火）",
  startTime: "18:00",
  endTime: "19:00",
  reservationTime: "18:00〜19:00",
  reservationDateTime: "9月22日（火）18:00〜19:00",
  salonName: "",
};

export const DEFAULT_RESERVATION_CONFIRMATION_BODY = `{{customerName}} 様

この度はご予約ありがとうございます。
以下の内容でご予約を承りました。

■ ご予約日時
{{reservationDateTime}}

■ サロン
{{salonName}}

■ サロンの場所 🏠
東京都渋谷区東1-3-1 常盤松ロイアル706

■ アクセス 🚃
渋谷駅から徒歩8分

Googleマップ
https://maps.app.goo.gl/ZtDx6qirtUtmZJ9F8?g_st=ic

■ ご来店時のご注意
建物正面「カミニート」からは入れません。

建物北側の「常盤松ロイアルハイツ」と書かれた入口からお入りいただき、
エレベーターで7階までお上がりください。

エレベーターを降りて左側の706号室になります。

お会いできるのを楽しみにしております🌿`;
