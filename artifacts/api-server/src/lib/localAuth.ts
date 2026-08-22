import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { authSessionsTable, db, employeesTable, loginEventsTable, type Employee } from "@workspace/db";
import { and, eq, gt, lt } from "drizzle-orm";
import type { Logger } from "pino";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PASSWORD_KEY_LENGTH = 64;
export const MIN_PASSWORD_LENGTH = 8;
const failedAttempts = new Map<string, { count: number; resetAt: number }>();

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, PASSWORD_KEY_LENGTH);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algorithm, saltEncoded, hashEncoded] = stored.split("$");
  if (algorithm !== "scrypt" || !saltEncoded || !hashEncoded) return false;
  const salt = Buffer.from(saltEncoded, "base64url");
  const expected = Buffer.from(hashEncoded, "base64url");
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function isValidPassword(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH;
}

export function getClientIp(headers: Record<string, unknown>, fallback?: string): string {
  const forwarded = headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return (typeof raw === "string" ? raw.split(",")[0]?.trim() : undefined) || fallback || "unknown";
}

export function canAttemptLogin(key: string): boolean {
  const current = failedAttempts.get(key);
  if (!current || current.resetAt < Date.now()) {
    failedAttempts.delete(key);
    return true;
  }
  return current.count < 5;
}

export function recordFailedLogin(key: string) {
  const current = failedAttempts.get(key);
  if (!current || current.resetAt < Date.now()) {
    failedAttempts.set(key, { count: 1, resetAt: Date.now() + 15 * 60 * 1000 });
    return;
  }
  current.count += 1;
}

export function clearFailedLogins(key: string) {
  failedAttempts.delete(key);
}

export async function createSession(employee: Employee) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const session = {
    id: randomUUID(),
    employeeId: employee.id,
    tokenHash: hashToken(token),
    loginAt: now,
    expiresAt,
    lastSeenAt: now,
  };
  await db.delete(authSessionsTable).where(lt(authSessionsTable.expiresAt, now));
  await db.insert(authSessionsTable).values(session);
  return { token, session };
}

export async function findSession(token: string) {
  const now = new Date();
  const [row] = await db
    .select({ session: authSessionsTable, employee: employeesTable })
    .from(authSessionsTable)
    .innerJoin(employeesTable, eq(authSessionsTable.employeeId, employeesTable.id))
    .where(
      and(
        eq(authSessionsTable.tokenHash, hashToken(token)),
        gt(authSessionsTable.expiresAt, now),
        eq(employeesTable.active, true),
      ),
    )
    .limit(1);
  if (!row) return null;
  await db
    .update(authSessionsTable)
    .set({ lastSeenAt: now })
    .where(eq(authSessionsTable.id, row.session.id));
  return row;
}

export async function bootstrapAdministrator(logger: Logger) {
  const [admin] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(eq(employeesTable.role, "admin"))
    .limit(1);
  if (admin) return;

  const username = normalizeUsername(process.env.INITIAL_ADMIN_USERNAME ?? "");
  const password = process.env.INITIAL_ADMIN_PASSWORD ?? "";
  const displayName = process.env.INITIAL_ADMIN_NAME?.trim() || "Administrador";
  if (!username || !isValidPassword(password)) {
    logger.warn(
      "No initial administrator exists. Set INITIAL_ADMIN_USERNAME and an INITIAL_ADMIN_PASSWORD with at least 8 characters before production use.",
    );
    return;
  }

  await db.insert(employeesTable).values({
    id: randomUUID(),
    username,
    passwordHash: hashPassword(password),
    displayName,
    role: "admin",
    active: true,
  });
  logger.info({ username }, "Initial local administrator created");
}

export async function recordLoginEvent(
  employeeId: string | null,
  success: boolean,
  ipAddress: string,
  deviceLabel: string | null,
) {
  await db.insert(loginEventsTable).values({
    id: randomUUID(),
    employeeId,
    success,
    ipAddress,
    deviceLabel,
  });
}