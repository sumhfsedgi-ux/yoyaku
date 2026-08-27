/**
 * Single place that maps internal reason codes (returned by the availability
 * engine, reservation service, and other server-side services) to Japanese
 * copy that is safe to show to customers and staff. Client Components must
 * route every `{ok:false, reason}` result through toUserMessage() before
 * rendering it - never display a raw exception message, HTTP status, or
 * upstream API error string (e.g. "Google Calendar API error 403") in the UI.
 */

const USER_MESSAGES: Record<string, string> = {
  INVALID_START_TIME: "この時間はご予約いただけません。他の時間をお選びください。",
  OUT_OF_HOURS: "この時間はご予約いただけません。他の時間をお選びください。",
  PAST_CUTOFF: "この時間はご予約の受付を終了しました。他の時間をお選びください。",
  OUT_OF_WINDOW: "この日はまだご予約を受け付けておりません。",
  ROOM_CONFLICT: "この時間はご予約いただけません。他の時間をお選びください。",
  CALENDAR_BUSY: "この時間はご予約いただけません。他の時間をお選びください。",
  CALENDAR_UNAVAILABLE: "現在予約状況を確認できません。少し時間をおいて再度お試しください。",
  CONCURRENT_BOOKING: "申し訳ありません。この時間は先ほど予約が入りました。別の時間を選択してください。",
  VALIDATION_ERROR: "入力内容をご確認ください。",
  STAFF_NOT_FOUND: "ご指定のページが見つかりませんでした。",
  STAFF_INACTIVE: "現在このページからのご予約は受け付けておりません。",
  ROOM_NOT_FOUND: "現在予約状況を確認できません。少し時間をおいて再度お試しください。",
  NOT_FOUND: "対象の予約が見つかりませんでした。",
  CUSTOMER_NOT_FOUND: "該当するお客様が見つかりませんでした。画面を更新してもう一度お試しください。",
  DUPLICATE_EMAIL: "このメールアドレスは別の登録済みお客様が使用しています。",
  ALREADY_CANCELLED: "この予約は既にキャンセルされています。",
  ALREADY_RECORDED: "この予約には既に来店記録が登録されています。画面を更新してご確認ください。",
  RATE_LIMITED: "アクセスが集中しています。少し時間をおいて再度お試しください。",
  GOOGLE_NOT_CONFIGURED: "現在予約状況を確認できません。少し時間をおいて再度お試しください。",
  UNKNOWN: "エラーが発生しました。少し時間をおいて再度お試しください。",
};

export function toUserMessage(reason: string): string {
  return USER_MESSAGES[reason] ?? USER_MESSAGES.UNKNOWN;
}

export function hasUserMessage(reason: string): boolean {
  return reason in USER_MESSAGES;
}
