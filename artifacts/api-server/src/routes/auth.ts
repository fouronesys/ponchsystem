import { db, employeesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  canAttemptLogin,
  clearFailedLogins,
  createSession,
  getClientIp,
  normalizeUsername,
  recordFailedLogin,
  recordLoginEvent,
  verifyPassword,
} from "../lib/localAuth";
import { requireAuthenticated, type AuthenticatedRequest } from "../middlewares/attendanceAuth";

const router: IRouter = Router();
const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

function publicEmployee(employee: typeof employeesTable.$inferSelect) {
  return {
    id: employee.id,
    username: employee.username,
    displayName: employee.displayName,
    role: employee.role,
    profilePhotoUrl: employee.profilePhotoPath
      ? `/api/media/${employee.profilePhotoPath}`
      : null,
  };
}

router.post("/auth/login", async (req, res): Promise<void> => {
  const username = normalizeUsername(typeof req.body?.username === "string" ? req.body.username : "");
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const ipAddress = getClientIp(req.headers, req.ip);
  const deviceLabel = req.get("user-agent")?.slice(0, 180) ?? null;
  const attemptKey = `${username}:${ipAddress}`;

  if (!username || !password || !canAttemptLogin(attemptKey)) {
    res.status(429).json({ error: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." });
    return;
  }

  const [employee] = await db
    .select()
    .from(employeesTable)
    .where(and(eq(employeesTable.username, username), eq(employeesTable.active, true)))
    .limit(1);

  if (!employee || !verifyPassword(password, employee.passwordHash)) {
    recordFailedLogin(attemptKey);
    await recordLoginEvent(employee?.id ?? null, false, ipAddress, deviceLabel);
    res.status(401).json({ error: "Usuario o contraseña incorrectos." });
    return;
  }

  clearFailedLogins(attemptKey);
  const { token, session } = await createSession(employee);
  await recordLoginEvent(employee.id, true, ipAddress, deviceLabel);
  res.cookie("attendance_session", token, { ...cookieOptions, maxAge: session.expiresAt.getTime() - Date.now() });
  res.json({ employee: publicEmployee(employee), expiresAt: session.expiresAt });
});

router.post("/auth/logout", requireAuthenticated, async (req: AuthenticatedRequest, res): Promise<void> => {
  if (req.session) {
    const { authSessionsTable } = await import("@workspace/db");
    await db.delete(authSessionsTable).where(eq(authSessionsTable.id, req.session.id));
  }
  res.clearCookie("attendance_session", cookieOptions);
  res.status(204).end();
});

router.get("/auth/me", requireAuthenticated, (req: AuthenticatedRequest, res): void => {
  res.json({
    employee: publicEmployee(req.employee!),
    loginAt: req.session!.loginAt,
    expiresAt: req.session!.expiresAt,
  });
});

export default router;