import { describe, expect, it } from "vitest";
import { normalizeEmail, normalizePhoneDigits } from "@/lib/customers/normalize";

describe("normalizePhoneDigits", () => {
  it("strips hyphens", () => {
    expect(normalizePhoneDigits("090-1234-5678")).toBe("09012345678");
  });

  it("matches the same number with and without hyphens", () => {
    expect(normalizePhoneDigits("090-1234-5678")).toBe(normalizePhoneDigits("09012345678"));
  });

  it("strips spaces and parentheses", () => {
    expect(normalizePhoneDigits("(090) 1234 5678")).toBe("09012345678");
  });

  it("returns an empty string for input with no digits", () => {
    expect(normalizePhoneDigits("---")).toBe("");
  });
});

describe("normalizeEmail", () => {
  it("lowercases", () => {
    expect(normalizeEmail("Customer@Example.com")).toBe("customer@example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeEmail("  customer@example.com  ")).toBe("customer@example.com");
  });

  it("treats differently-cased/whitespaced input as equal", () => {
    expect(normalizeEmail(" Customer@Example.com")).toBe(normalizeEmail("customer@example.com "));
  });
});
