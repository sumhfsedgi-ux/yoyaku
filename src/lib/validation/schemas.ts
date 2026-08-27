import { z } from "zod";

const PHONE_DIGITS_MIN = 10;
const PHONE_DIGITS_MAX = 15;

export const phoneSchema = z
  .string()
  .trim()
  .min(1, "電話番号を入力してください")
  .refine((value) => /^[0-9()+\-\s]+$/.test(value), "電話番号の形式が正しくありません")
  .refine((value) => {
    const digits = value.replace(/\D/g, "");
    return digits.length >= PHONE_DIGITS_MIN && digits.length <= PHONE_DIGITS_MAX;
  }, "電話番号の桁数が正しくありません");

export const customerInputSchema = z.object({
  name: z.string().trim().min(1, "お名前を入力してください").max(100),
  email: z.string().trim().min(1, "メールアドレスを入力してください").email("メールアドレスの形式が正しくありません").max(254),
  phone: phoneSchema,
});

export type CustomerInput = z.infer<typeof customerInputSchema>;

export const createReservationInputSchema = z
  .object({
    staffId: z.string().min(1),
    startAtUtcIso: z.string().datetime({ message: "日時の形式が正しくありません" }),
    source: z.enum(["CUSTOMER_ONLINE", "STAFF_MANUAL"]),
    createdByStaffId: z.string().min(1).optional(),
    /** New-customer path (unchanged): create-or-update-by-email under the caller's own staffId. */
    customer: customerInputSchema.optional(),
    /** Existing-customer path: select a customer already owned by the caller, never mutating it. */
    customerId: z.string().min(1).optional(),
    /** Only meaningful alongside customerId - "this booking's contact info only", not a master-record edit. */
    contactOverride: customerInputSchema.optional(),
    /** Honeypot field - must always be empty for a genuine submission. See actions/booking.ts. */
    website: z.string().max(0).optional().or(z.literal("")),
  })
  .refine((v) => (v.customer ? 1 : 0) + (v.customerId ? 1 : 0) === 1, {
    message: "顧客情報を指定してください",
    path: ["customer"],
  })
  .refine((v) => !v.contactOverride || v.customerId, {
    message: "contactOverrideはcustomerId指定時のみ有効です",
    path: ["contactOverride"],
  });

export const rescheduleReservationInputSchema = z.object({
  reservationId: z.string().min(1),
  newStartAtUtcIso: z.string().datetime({ message: "日時の形式が正しくありません" }),
});

export const weeklyAvailabilityRangeSchema = z
  .object({
    startMinute: z.number().int().min(0).max(24 * 60).multipleOf(15),
    endMinute: z.number().int().min(0).max(24 * 60).multipleOf(15),
  })
  .refine((r) => r.endMinute > r.startMinute, { message: "終了時刻は開始時刻より後にしてください" });

/**
 * Validates a set of ranges that all belong to the same day (a single
 * ScheduleOverride date, or one weekday of WeeklyAvailability) don't overlap
 * each other. Half-open intervals, matching lib/availability/rules.ts's
 * intervalsOverlap - two ranges that merely touch (aEnd === bStart) are not
 * considered overlapping.
 */
export const nonOverlappingRangesSchema = z.array(weeklyAvailabilityRangeSchema).refine(
  (ranges) => ranges.every((a, i) => ranges.every((b, j) => i === j || a.startMinute >= b.endMinute || a.endMinute <= b.startMinute)),
  { message: "時間帯が重複しています" },
);

/** isClosed=false with zero ranges would silently save a day with no bookable time slots. */
export const upsertScheduleOverrideInputSchema = z
  .object({
    isClosed: z.boolean(),
    ranges: nonOverlappingRangesSchema,
  })
  .refine((v) => v.isClosed || v.ranges.length > 0, {
    message: "時間帯を1つ以上追加するか、終日休みにしてください",
    path: ["ranges"],
  });

export const bookingCutoffSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("HOURS_BEFORE"), hours: z.number().int().min(0).max(24 * 30) }),
  z.object({
    type: z.literal("DAY_BEFORE_AT_TIME"),
    daysBefore: z.number().int().min(1).max(30),
    atMinute: z.number().int().min(0).max(24 * 60).multipleOf(15),
  }),
]);

export const staffSettingsInputSchema = z.object({
  bookingCutoff: bookingCutoffSchema,
  bookingWindowDays: z.number().int().min(1).max(365),
});

export const updateMySalonNameInputSchema = z.object({
  salonName: z.string().trim().max(100),
});

export const updateOwnCredentialsInputSchema = z
  .object({
    currentPassword: z.string().min(1, "現在のパスワードを入力してください"),
    newLoginEmail: z.string().trim().email().max(254).optional(),
    newPassword: z.string().min(8, "パスワードは8文字以上にしてください").max(200).optional(),
  })
  .refine((v) => v.newLoginEmail || v.newPassword, { message: "変更する項目を入力してください" });

function masterListNameSchema(maxLen: number) {
  return z.string().trim().min(1, "名称を入力してください").max(maxLen, `${maxLen}文字以内で入力してください`);
}

export const createConcernMasterInputSchema = z.object({ name: masterListNameSchema(50) });
export const renameConcernMasterInputSchema = z.object({ id: z.string().min(1), name: masterListNameSchema(50) });
export const createAcquisitionSourceInputSchema = z.object({ name: masterListNameSchema(30) });
export const renameAcquisitionSourceInputSchema = z.object({ id: z.string().min(1), name: masterListNameSchema(30) });
export const setMasterActiveInputSchema = z.object({ id: z.string().min(1), active: z.boolean() });
export const reorderMasterListInputSchema = z.object({ orderedIds: z.array(z.string().min(1)).min(1) });

/** Sanity ceiling for a single visit's amount, not a real business limit - see plan §5. */
export const VISIT_AMOUNT_MAX_YEN = 1_000_000;

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日付の形式が正しくありません");
const visitAmountSchema = z
  .number()
  .int("整数で入力してください")
  .min(0, "金額は0以上で入力してください")
  .max(VISIT_AMOUNT_MAX_YEN, "金額が大きすぎます。ご確認ください。");

export const createVisitRecordInputSchema = z.object({
  customerId: z.string().min(1),
  reservationId: z.string().min(1).optional(),
  visitDateISO: isoDateSchema,
  amount: visitAmountSchema,
  concernIds: z.array(z.string().min(1)).max(50).default([]),
  concernDetail: z.string().trim().max(500).optional(),
  customerImpression: z.string().trim().max(1000).optional(),
  staffComment: z.string().trim().max(1000).optional(),
  nextVisitMemo: z.string().trim().max(1000).optional(),
  /**
   * Only applied when this turns out to be the customer's first-ever
   * VisitRecord (server-side check, see actions/visitRecords.ts) - ignored
   * otherwise. Lets the "first visit" chart form collect the acquisition
   * source in the same submission instead of a separate step.
   */
  firstVisitAcquisitionSourceId: z.string().min(1).optional(),
});

export const updateVisitRecordInputSchema = z.object({
  id: z.string().min(1),
  visitDateISO: isoDateSchema,
  amount: visitAmountSchema,
  concernIds: z.array(z.string().min(1)).max(50).default([]),
  concernDetail: z.string().trim().max(500).optional(),
  customerImpression: z.string().trim().max(1000).optional(),
  staffComment: z.string().trim().max(1000).optional(),
  nextVisitMemo: z.string().trim().max(1000).optional(),
});

export const updateCustomerFirstVisitInputSchema = z.object({
  customerId: z.string().min(1),
  firstVisitDateISO: isoDateSchema.nullable(),
  firstVisitAcquisitionSourceId: z.string().min(1).nullable(),
});

/** Sanity ceiling for one checkout's total, not a real business limit - same philosophy as VISIT_AMOUNT_MAX_YEN. */
export const RETAIL_TOTAL_AMOUNT_MAX_YEN = 1_000_000;

const retailSaleItemInputSchema = z.object({
  productName: z.string().trim().min(1, "商品名を入力してください").max(100),
  quantity: z.number().int("整数で入力してください").min(1, "数量は1以上で入力してください").max(9999),
});

export const createRetailSaleInputSchema = z.object({
  customerId: z.string().min(1).nullable(),
  soldAtISO: isoDateSchema,
  totalAmount: z
    .number()
    .int("整数で入力してください")
    .min(0, "金額は0以上で入力してください")
    .max(RETAIL_TOTAL_AMOUNT_MAX_YEN, "金額が大きすぎます。ご確認ください。"),
  memo: z.string().trim().max(1000).optional(),
  items: z.array(retailSaleItemInputSchema).min(1, "商品を1つ以上入力してください").max(50),
});

export const updateRetailSaleInputSchema = createRetailSaleInputSchema.extend({ id: z.string().min(1) });

/** Must stay URL-safe: this becomes the public /reserve/[slug] path segment. */
const bookingSlugSchema = z
  .string()
  .trim()
  .min(2, "2文字以上で入力してください")
  .max(60)
  .regex(/^[a-z0-9-]+$/, "半角英数とハイフンのみ使用できます");

export const createStaffInputSchema = z.object({
  displayName: z.string().trim().min(1, "表示名を入力してください").max(100),
  bookingSlug: bookingSlugSchema,
  loginEmail: z.string().trim().min(1, "メールアドレスを入力してください").email("メールアドレスの形式が正しくありません").max(254),
  initialPassword: z.string().min(8, "パスワードは8文字以上にしてください").max(200),
});

export const updateStaffProfileInputSchema = z.object({
  targetStaffId: z.string().min(1),
  displayName: z.string().trim().min(1, "表示名を入力してください").max(100).optional(),
  bookingSlug: bookingSlugSchema.optional(),
  active: z.boolean().optional(),
});
