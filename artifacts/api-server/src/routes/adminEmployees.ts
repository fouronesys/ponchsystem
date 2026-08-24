import { db, employeesTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { saveImage } from "../lib/imageStorage";
import { hashPassword, isValidPassword, MIN_PASSWORD_LENGTH, normalizeUsername } from "../lib/localAuth";
import { requireAdministrator } from "../middlewares/attendanceAuth";
import { ensureWeeklySchedule } from "../lib/weeklySchedule";

const router: IRouter = Router();

function toEmployeeResponse(employee: typeof employeesTable.$inferSelect) {
  return {
    id: employee.id,
    username: employee.username,
    displayName: employee.displayName,
    documentNumber: employee.documentNumber,
    email: employee.email,
    phone: employee.phone,
    jobTitle: employee.jobTitle,
    active: employee.active,
    role: employee.role,
    profilePhotoUrl: employee.profilePhotoPath ? `/api/media/${employee.profilePhotoPath}` : null,
    createdAt: employee.createdAt,
  };
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

router.get("/admin/employees", requireAdministrator, async (_req, res): Promise<void> => {
  const employees = await db.select().from(employeesTable).orderBy(desc(employeesTable.createdAt));
  res.json(employees.map(toEmployeeResponse));
});

router.post("/admin/employees", requireAdministrator, async (req, res): Promise<void> => {
  const username = normalizeUsername(typeof req.body?.username === "string" ? req.body.username : "");
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const displayName = optionalText(req.body?.displayName);
  if (!username || !displayName || !isValidPassword(password)) {
    res.status(400).json({
      error: `Nombre, usuario y una contraseña de al menos ${MIN_PASSWORD_LENGTH} caracteres son obligatorios.`,
    });
    return;
  }

  let profilePhotoPath: string | null = null;
  try {
    if (req.body?.profilePhoto) profilePhotoPath = await saveImage(req.body.profilePhoto, "profiles");
    const [created] = await db
      .insert(employeesTable)
      .values({
        id: randomUUID(),
        username,
        passwordHash: hashPassword(password),
        displayName,
        documentNumber: optionalText(req.body?.documentNumber),
        email: optionalText(req.body?.email),
        phone: optionalText(req.body?.phone),
        jobTitle: optionalText(req.body?.jobTitle),
        profilePhotoPath,
        role: "employee",
        active: true,
      })
      .returning();
    await ensureWeeklySchedule(created.id);
    res.status(201).json(toEmployeeResponse(created));
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      res.status(409).json({ error: "Ese nombre de usuario ya está en uso." });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : "No fue posible crear el empleado." });
  }
});

router.put("/admin/employees/:id", requireAdministrator, async (req, res): Promise<void> => {
  const employeeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [existing] = await db.select().from(employeesTable).where(eq(employeesTable.id, employeeId)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Empleado no encontrado." });
    return;
  }

  try {
    const values: Partial<typeof employeesTable.$inferInsert> = {
      active: typeof req.body?.active === "boolean" ? req.body.active : existing.active,
    };
    if (typeof req.body?.displayName === "string" && req.body.displayName.trim()) {
      values.displayName = req.body.displayName.trim();
    }
    for (const field of ["documentNumber", "email", "phone", "jobTitle"] as const) {
      if (field in (req.body ?? {})) values[field] = optionalText(req.body[field]);
    }
    if (typeof req.body?.password === "string" && req.body.password) {
      if (!isValidPassword(req.body.password)) {
        res.status(400).json({
          error: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
        });
        return;
      }
      values.passwordHash = hashPassword(req.body.password);
    }
    if (req.body?.profilePhoto) values.profilePhotoPath = await saveImage(req.body.profilePhoto, "profiles");
    const [updated] = await db.update(employeesTable).set(values).where(eq(employeesTable.id, existing.id)).returning();
    res.json(toEmployeeResponse(updated));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "No fue posible actualizar el empleado." });
  }
});

export default router;