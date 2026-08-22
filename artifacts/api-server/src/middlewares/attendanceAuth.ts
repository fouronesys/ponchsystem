import { getAuth } from "@clerk/express";
import { db, employeesTable, type Employee } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";

export type AuthenticatedRequest = Request & {
  clerkUserId?: string;
  employee?: Employee;
};

function adminIds(): Set<string> {
  return new Set(
    (process.env.ADMIN_CLERK_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export async function ensureEmployee(clerkUserId: string): Promise<Employee> {
  await db
    .insert(employeesTable)
    .values({
      id: randomUUID(),
      clerkUserId,
      displayName: `Empleado ${clerkUserId.slice(-6)}`,
      role: adminIds().has(clerkUserId) ? "admin" : "employee",
    })
    .onConflictDoNothing({ target: employeesTable.clerkUserId });

  const [employee] = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.clerkUserId, clerkUserId));

  if (!employee) {
    throw new Error("Employee provisioning failed");
  }

  return employee;
}

export async function requireAuthenticated(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = getAuth(req);
  const candidateUserId = auth?.sessionClaims?.userId || auth?.userId;
  const clerkUserId =
    typeof candidateUserId === "string" ? candidateUserId : undefined;

  if (!clerkUserId) {
    res.status(401).json({ error: "Autenticación requerida" });
    return;
  }

  try {
    req.clerkUserId = clerkUserId;
    req.employee = await ensureEmployee(clerkUserId);
    next();
  } catch (error) {
    req.log.error({ err: error }, "Employee provisioning failed");
    res.status(500).json({ error: "No fue posible preparar el perfil" });
  }
}

export async function requireAdministrator(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await requireAuthenticated(req, res, () => undefined);
  if (!req.employee || !req.clerkUserId) {
    return;
  }

  if (
    req.employee.role !== "admin" &&
    !adminIds().has(req.clerkUserId)
  ) {
    res.status(403).json({ error: "Se requieren permisos de administrador" });
    return;
  }

  next();
}