/**
 * Detects whether a caught error is a violation of the "reservation_no_room_overlap"
 * EXCLUDE constraint (see prisma/migrations/*_add_reservation_exclude_constraint).
 *
 * Empirically observed shape (Prisma 7.9.1 + @prisma/adapter-pg against Postgres 16):
 *   err.constructor.name === "PrismaClientKnownRequestError"
 *   err.code === "P2039"
 *   err.meta.driverAdapterError.cause.code === "23P01"  (Postgres SQLSTATE for exclusion_violation)
 *
 * Prisma's own error-code mapping for constraint failures has shifted across
 * versions in the past (this is a fast-moving part of the driver-adapter
 * architecture), so this checks the raw Postgres SQLSTATE 23P01 first - that's
 * the actually-stable signal, per Postgres's own error code reference - and
 * only falls back to Prisma's P-code as a secondary signal. If a future Prisma
 * version changes the meta shape, tests/integration/db/exclude-constraint.test.ts
 * will start failing here and should be the trigger to update this function.
 */
export function isExclusionConstraintViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as Record<string, unknown>;

  const driverCause = (anyErr.meta as Record<string, unknown> | undefined)?.driverAdapterError as
    | Record<string, unknown>
    | undefined;
  const cause = driverCause?.cause as Record<string, unknown> | undefined;
  if (cause?.code === "23P01" || cause?.originalCode === "23P01") return true;

  if (anyErr.code === "P2039") return true;

  const message = typeof anyErr.message === "string" ? anyErr.message : "";
  return message.includes("23P01") || message.includes("reservation_no_room_overlap");
}

/**
 * Detects a unique-constraint violation (Postgres SQLSTATE 23505), using the
 * same detection strategy as isExclusionConstraintViolation above: check the
 * raw Postgres SQLSTATE first (the stable signal), then Prisma's own P2002
 * code as a secondary signal. Used by the Customer.lineUserId upsert (see
 * lib/reservations/service.ts) to safely retry without lineUserId when a
 * race condition slips past the pre-check (@@unique([ownerStaffId,
 * lineUserId]) - see prisma/schema.prisma) - a LINE-linking conflict must
 * never fail the reservation itself.
 */
export function isUniqueConstraintViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as Record<string, unknown>;

  const driverCause = (anyErr.meta as Record<string, unknown> | undefined)?.driverAdapterError as
    | Record<string, unknown>
    | undefined;
  const cause = driverCause?.cause as Record<string, unknown> | undefined;
  if (cause?.code === "23505" || cause?.originalCode === "23505") return true;

  if (anyErr.code === "P2002") return true;

  const message = typeof anyErr.message === "string" ? anyErr.message : "";
  return message.includes("23505");
}
