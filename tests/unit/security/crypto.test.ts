import { beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";

describe("encryptSecret / decryptSecret", () => {
  beforeEach(() => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  it("round-trips a plaintext secret", () => {
    const plaintext = "1//0gABCDEFGHIJKLMNOPQRSTUVWXYZ-refresh-token";
    const encrypted = encryptSecret(plaintext);
    expect(encrypted.startsWith("v1:")).toBe(true);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it("produces a different ciphertext each time (random IV) even for the same plaintext", () => {
    const plaintext = "same-secret";
    expect(encryptSecret(plaintext)).not.toBe(encryptSecret(plaintext));
  });

  it("throws when the encryption key is missing", () => {
    delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    expect(() => encryptSecret("x")).toThrow(/not set/);
  });

  it("throws when the encryption key is the wrong length", () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
  });

  it("throws on an unsupported version prefix", () => {
    const encrypted = encryptSecret("x");
    const tampered = encrypted.replace(/^v1:/, "v2:");
    expect(() => decryptSecret(tampered)).toThrow(/unsupported encryption version/);
  });

  it("throws on a malformed payload", () => {
    expect(() => decryptSecret("not-a-valid-payload")).toThrow(/malformed/);
  });
});
