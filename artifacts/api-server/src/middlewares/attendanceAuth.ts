import { db, employeesTable, type AuthSession, type Employee } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { findSession } from "../lib/localAuth";

export type AuthenticatedRequest = Request & {
  employee?: Employee;
  session?: AuthSession;
};

export async function requireAuthenticated(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = typeof req.cookies?.attendance_session === "string"
    ? req.cookies.attendance_session
    : "";
  if (!token) {
    res.status(401).json({ error: "Autenticación requerida" });
    return;
  }

  try {
    const found = await findSession(token);
    if (!found) {
      res.clearCookie("attendance_session", { path: "/" });
      res.status(401).json({ error: "La sesión expiró. Inicia sesión nuevamente." });
      return;
    }
    req.employee = found.employee;
    req.session = found.session;
    next();
  } catch (error) {
    req.log.error({ err: error }, "Local session lookup failed");
    res.status(500).json({ error: "No fue posible validar la sesión" });
  }
}

export async function requireAdministrator(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await requireAuthenticated(req, res, () => undefined);
  if (!req.employee) {
    return;
  }

  if (req.employee.role !== "admin") {
    res.status(403).json({ error: "Se requieren permisos de administrador" });
    return;
  }

  next();
}