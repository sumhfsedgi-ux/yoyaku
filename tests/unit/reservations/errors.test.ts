import { describe, expect, it } from "vitest";
import { isExclusionConstraintViolation } from "@/lib/reservations/errors";

describe("isExclusionConstraintViolation", () => {
  it("recognizes the observed Prisma 7 + adapter-pg error shape", () => {
    const err = {
      constructor: { name: "PrismaClientKnownRequestError" },
      code: "P2039",
      message: "Database error. Code: `23P01`.",
      meta: {
        modelName: "Reservation",
        driverAdapterError: {
          name: "DriverAdapterError",
          cause: { originalCode: "23P01", code: "23P01", kind: "postgres" },
        },
      },
    };
    expect(isExclusionConstraintViolation(err)).toBe(true);
  });

  it("recognizes a bare P2039 code even without the nested driver adapter shape", () => {
    expect(isExclusionConstraintViolation({ code: "P2039" })).toBe(true);
  });

  it("recognizes the constraint name showing up in the message as a last resort", () => {
    expect(isExclusionConstraintViolation({ message: 'violates exclusion constraint "reservation_no_room_overlap"' })).toBe(
      true,
    );
  });

  it("does not misclassify an unrelated error", () => {
    expect(isExclusionConstraintViolation(new Error("network timeout"))).toBe(false);
    expect(isExclusionConstraintViolation({ code: "P2002", message: "unique constraint failed" })).toBe(false);
  });

  it("does not throw on non-error values", () => {
    expect(isExclusionConstraintViolation(null)).toBe(false);
    expect(isExclusionConstraintViolation(undefined)).toBe(false);
    expect(isExclusionConstraintViolation("plain string")).toBe(false);
  });
});
