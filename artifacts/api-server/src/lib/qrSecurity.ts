import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";

const TOKEN_TTL_MS = 90_000;
const MAX_ATTEMPTS = 6;
const ATTEMPT_WINDOW_MS = 5 * 60_000;

type ScanWindow = { startedAt: number; count: number };
const scanWindows = new Map<string, ScanWindow>();

function encryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is required for QR token encryption");
  }
  return createHmac("sha256", secret).update("attendance-qr-key").digest();
}

export function createRotatingToken(): string {
  return `att_${randomUUID()}_${randomBytes(32).toString("base64url")}`;
}

export function hashToken(token: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is required for QR token hashing");
  }
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptToken(encryptedToken: string): string {
  const [ivText, tagText, payloadText] = encryptedToken.split(".");
  if (!ivText || !tagText || !payloadText) {
    throw new Error("Malformed encrypted QR token");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivText, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(payloadText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function tokenExpiry(): Date {
  return new Date(Date.now() + TOKEN_TTL_MS);
}

export function secondsUntil(date: Date): number {
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
}

export function canAttemptScan(key: string): boolean {
  const now = Date.now();
  const current = scanWindows.get(key);
  if (!current || now - current.startedAt >= ATTEMPT_WINDOW_MS) {
    scanWindows.set(key, { startedAt: now, count: 1 });
    return true;
  }

  current.count += 1;
  return current.count <= MAX_ATTEMPTS;
}

export function clearScanAttempts(key: string): void {
  scanWindows.delete(key);
}