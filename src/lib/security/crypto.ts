import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

/**
 * AES-256-GCM encryption for secrets that must be persisted (currently: the
 * Google OAuth refresh token in GoogleCalendarIntegration.refreshTokenEncrypted).
 * The key lives only in GOOGLE_TOKEN_ENCRYPTION_KEY (deployment env vars), never
 * in the database. Payload format: "v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>" -
 * the version prefix lets a future key-rotation scheme add a "v2" without
 * breaking rows still encrypted under v1.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const KEY_LENGTH_BYTES = 32;
const CURRENT_VERSION = "v1";

function getKey(): Buffer {
  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY is not set");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(`GOOGLE_TOKEN_ENCRYPTION_KEY must decode to exactly ${KEY_LENGTH_BYTES} bytes`);
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [CURRENT_VERSION, iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(
    ":",
  );
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4) {
    throw new Error("malformed encrypted payload");
  }
  const [version, ivB64, tagB64, dataB64] = parts;
  if (version !== CURRENT_VERSION) {
    throw new Error(`unsupported encryption version: ${version}`);
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return decrypted.toString("utf8");
}
