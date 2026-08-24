import { GetEmployeeWeeklyScheduleParams, UpdateEmployeeWeeklyScheduleBody } from "@workspace/api-zod";
import { db, employeesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  type AuthenticatedRequest,
  requireAdministrator,
  requireAuthenticated,
} from "../middlewares/attendanceAuth";
import {
  getWeeklySchedule,
  replaceWeeklySchedule,
  validateWeeklySchedule,
} from "../lib/weeklySchedule";

const router: IRouter = Router();

function employeeIdFromParams(value: unknown): string | null {
  const parsed = GetEmployeeWeeklyScheduleParams.safeParse({ id: Array.isArray(value) ? value[0] : value });
  return parsed.success ? parsed.data.id : null;
}

async function employeeExists(employeeId: string): Promise<boolean> {
  const [employee] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(eq(employeesTable.id, employeeId))
    .limit(1);
  return Boolean(employee);
}

router.get("/attendance/schedule", requireAuthenticated, async (req: AuthenticatedRequest, res): Promise<void> => {
  res.json(await getWeeklySchedule(req.employee!.id));
});

router.get("/admin/employees/:id/schedule", requireAdministrator, async (req, res): Promise<void> => {
  const employeeId = employeeIdFromParams(req.params.id);
  if (!employeeId || !await employeeExists(employeeId)) {
    res.status(404).json({ error: "Empleado no encontrado." });
    return;
  }
  res.json(await getWeeklySchedule(employeeId));
});

router.put("/admin/employees/:id/schedule", requireAdministrator, async (req, res): Promise<void> => {
  const employeeId = employeeIdFromParams(req.params.id);
  if (!employeeId || !await employeeExists(employeeId)) {
    res.status(404).json({ error: "Empleado no encontrado." });
    return;
  }

  const parsed = UpdateEmployeeWeeklyScheduleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "El formato del horario no es válido." });
    return;
  }
  const validationError = validateWeeklySchedule(parsed.data.days);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  res.json(await replaceWeeklySchedule(employeeId, parsed.data.days));
});

export default router;