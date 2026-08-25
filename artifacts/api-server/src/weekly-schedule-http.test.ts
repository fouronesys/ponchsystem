import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { eq } from "drizzle-orm";

const databasePath = path.join(
  await fs.mkdtemp(path.join(os.tmpdir(), "weekly-schedule-http-test-")),
  "attendance.sqlite",
);
process.env.SQLITE_DATABASE_PATH = databasePath;
process.env.SESSION_SECRET = "weekly-schedule-http-test-secret";
process.env.NODE_ENV = "test";

const [{ default: app }, dbModule, localAuth] = await Promise.all([
  import("./app"),
  import("@workspace/db"),
  import("./lib/localAuth"),
]);

const { db, employeesTable, weeklySchedulesTable } = dbModule;

async function request(baseUrl: string, route: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

async function login(baseUrl: string, username: string, password: string): Promise<string> {
  const result = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  assert.equal(result.response.status, 200);
  const cookie = result.response.headers.get("set-cookie");
  assert.ok(cookie);
  return cookie.split(";", 1)[0]!;
}

function blankWeek(): Array<{
  dayOfWeek: number;
  startTime: string | null;
  endTime: string | null;
  mealStart: string | null;
  mealEnd: string | null;
}> {
  return Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    startTime: null,
    endTime: null,
    mealStart: null,
    mealEnd: null,
  }));
}

test("los horarios semanales respetan permisos y validaciones", async () => {
  const password = "weekly-schedule-test-password";
  const admin = {
    id: randomUUID(),
    username: "schedule-admin",
    passwordHash: localAuth.hashPassword(password),
    displayName: "Administrador de horario",
    role: "admin" as const,
    active: true,
  };
  const employee = {
    id: randomUUID(),
    username: "schedule-employee",
    passwordHash: localAuth.hashPassword(password),
    displayName: "Empleado de horario",
    role: "employee" as const,
    active: true,
  };
  const secondEmployee = {
    id: randomUUID(),
    username: "schedule-employee-two",
    passwordHash: localAuth.hashPassword(password),
    displayName: "Segundo empleado de horario",
    role: "employee" as const,
    active: true,
  };
  const activeDepartmentEmployee = {
    id: randomUUID(),
    username: "schedule-department-active",
    passwordHash: localAuth.hashPassword(password),
    displayName: "Empleado activo del departamento",
    role: "employee" as const,
    department: "Operaciones",
    active: true,
  };
  const inactiveDepartmentEmployee = {
    id: randomUUID(),
    username: "schedule-department-inactive",
    passwordHash: localAuth.hashPassword(password),
    displayName: "Empleado inactivo del departamento",
    role: "employee" as const,
    department: "Operaciones",
    active: false,
  };
  const otherDepartmentEmployee = {
    id: randomUUID(),
    username: "schedule-other-department",
    passwordHash: localAuth.hashPassword(password),
    displayName: "Empleado de otro departamento",
    role: "employee" as const,
    department: "Finanzas",
    active: true,
  };
  await db.insert(employeesTable).values([
    admin,
    employee,
    secondEmployee,
    activeDepartmentEmployee,
    inactiveDepartmentEmployee,
    otherDepartmentEmployee,
  ]);
  const persistedDays = await db
    .select()
    .from(weeklySchedulesTable)
    .where(eq(weeklySchedulesTable.employeeId, employee.id));
  assert.equal(persistedDays.length, 7, "la creación del empleado debe persistir los siete días");

  const server: Server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const adminCookie = await login(baseUrl, admin.username, password);
    const employeeCookie = await login(baseUrl, employee.username, password);

    const initial = await request(baseUrl, "/api/attendance/schedule", {
      headers: { cookie: employeeCookie },
    });
    assert.equal(initial.response.status, 200);
    assert.equal(initial.body.days.length, 7);
    assert.ok(initial.body.days.every((day: { startTime: null }) => day.startTime === null));

    const forbidden = await request(baseUrl, `/api/admin/employees/${employee.id}/schedule`, {
      headers: { cookie: employeeCookie },
    });
    assert.equal(forbidden.response.status, 403);
    const bulkForbidden = await request(baseUrl, "/api/admin/employees/schedules/bulk", {
      method: "PUT",
      headers: { cookie: employeeCookie },
      body: JSON.stringify({ employeeIds: [employee.id], days: blankWeek() }),
    });
    assert.equal(bulkForbidden.response.status, 403);

    const incompleteMeal = blankWeek();
    incompleteMeal[1] = {
      dayOfWeek: 1,
      startTime: "08:00",
      endTime: "17:00",
      mealStart: "12:00",
      mealEnd: null,
    };
    const incompleteMealResult = await request(baseUrl, `/api/admin/employees/${employee.id}/schedule`, {
      method: "PUT",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ days: incompleteMeal }),
    });
    assert.equal(incompleteMealResult.response.status, 400);

    const invertedShift = blankWeek();
    invertedShift[1] = {
      dayOfWeek: 1,
      startTime: "17:00",
      endTime: "08:00",
      mealStart: null,
      mealEnd: null,
    };
    const invertedShiftResult = await request(baseUrl, `/api/admin/employees/${employee.id}/schedule`, {
      method: "PUT",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ days: invertedShift }),
    });
    assert.equal(invertedShiftResult.response.status, 200);
    assert.deepEqual(
      invertedShiftResult.body.days.find((day: { dayOfWeek: number }) => day.dayOfWeek === 1),
      invertedShift[1],
      "debe aceptar jornadas que cruzan medianoche",
    );

    const outsideMeal = blankWeek();
    outsideMeal[1] = {
      dayOfWeek: 1,
      startTime: "08:00",
      endTime: "17:00",
      mealStart: "07:30",
      mealEnd: "08:30",
    };
    const outsideMealResult = await request(baseUrl, `/api/admin/employees/${employee.id}/schedule`, {
      method: "PUT",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ days: outsideMeal }),
    });
    assert.equal(outsideMealResult.response.status, 400);

    const duplicateDays = blankWeek();
    duplicateDays[6] = { ...duplicateDays[6], dayOfWeek: 5 };
    const duplicateDaysResult = await request(baseUrl, `/api/admin/employees/${employee.id}/schedule`, {
      method: "PUT",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ days: duplicateDays }),
    });
    assert.equal(duplicateDaysResult.response.status, 400);

    const fractionalDay = blankWeek();
    fractionalDay[1] = { ...fractionalDay[1], dayOfWeek: 1.5 };
    const fractionalDayResult = await request(baseUrl, `/api/admin/employees/${employee.id}/schedule`, {
      method: "PUT",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ days: fractionalDay }),
    });
    assert.equal(fractionalDayResult.response.status, 400);

    const validWeek = blankWeek();
    validWeek[1] = {
      dayOfWeek: 1,
      startTime: "08:00",
      endTime: "17:00",
      mealStart: "12:00",
      mealEnd: "13:00",
    };
    const updated = await request(baseUrl, `/api/admin/employees/${employee.id}/schedule`, {
      method: "PUT",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ days: validWeek }),
    });
    assert.equal(updated.response.status, 200);
    assert.deepEqual(updated.body.days.find((day: { dayOfWeek: number }) => day.dayOfWeek === 1), validWeek[1]);

    const duplicateBulkSelection = await request(baseUrl, "/api/admin/employees/schedules/bulk", {
      method: "PUT",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ employeeIds: [secondEmployee.id, secondEmployee.id], days: validWeek }),
    });
    assert.equal(duplicateBulkSelection.response.status, 400);

    const departmentBulkUpdated = await request(baseUrl, "/api/admin/employees/schedules/bulk", {
      method: "PUT",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ department: "Operaciones", days: validWeek }),
    });
    assert.equal(departmentBulkUpdated.response.status, 200);
    assert.deepEqual(departmentBulkUpdated.body.updatedEmployeeIds, [activeDepartmentEmployee.id]);
    assert.equal(departmentBulkUpdated.body.updatedCount, 1);

    const activeDepartmentSchedule = await request(
      baseUrl,
      `/api/admin/employees/${activeDepartmentEmployee.id}/schedule`,
      { headers: { cookie: adminCookie } },
    );
    const inactiveDepartmentSchedule = await request(
      baseUrl,
      `/api/admin/employees/${inactiveDepartmentEmployee.id}/schedule`,
      { headers: { cookie: adminCookie } },
    );
    const otherDepartmentSchedule = await request(
      baseUrl,
      `/api/admin/employees/${otherDepartmentEmployee.id}/schedule`,
      { headers: { cookie: adminCookie } },
    );
    assert.equal(activeDepartmentSchedule.response.status, 200);
    assert.equal(inactiveDepartmentSchedule.response.status, 200);
    assert.equal(otherDepartmentSchedule.response.status, 200);
    assert.equal(
      activeDepartmentSchedule.body.days.find((day: { dayOfWeek: number }) => day.dayOfWeek === 1)?.startTime,
      "08:00",
    );
    assert.equal(
      inactiveDepartmentSchedule.body.days.find((day: { dayOfWeek: number }) => day.dayOfWeek === 1)?.startTime,
      null,
    );
    assert.equal(
      otherDepartmentSchedule.body.days.find((day: { dayOfWeek: number }) => day.dayOfWeek === 1)?.startTime,
      null,
    );

    const bulkWithUnknownEmployee = await request(baseUrl, "/api/admin/employees/schedules/bulk", {
      method: "PUT",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ employeeIds: [secondEmployee.id, randomUUID()], days: validWeek }),
    });
    assert.equal(bulkWithUnknownEmployee.response.status, 404);
    const untouchedSecondSchedule = await request(baseUrl, `/api/admin/employees/${secondEmployee.id}/schedule`, {
      headers: { cookie: adminCookie },
    });
    assert.equal(untouchedSecondSchedule.body.days.find((day: { dayOfWeek: number }) => day.dayOfWeek === 1)?.startTime, null);

    const bulkUpdated = await request(baseUrl, "/api/admin/employees/schedules/bulk", {
      method: "PUT",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ employeeIds: [employee.id, secondEmployee.id], days: validWeek }),
    });
    assert.equal(bulkUpdated.response.status, 200);
    assert.equal(bulkUpdated.body.updatedCount, 2);
    assert.deepEqual(bulkUpdated.body.updatedEmployeeIds, [employee.id, secondEmployee.id]);
    const updatedSecondSchedule = await request(baseUrl, `/api/admin/employees/${secondEmployee.id}/schedule`, {
      headers: { cookie: adminCookie },
    });
    assert.deepEqual(updatedSecondSchedule.body.days.find((day: { dayOfWeek: number }) => day.dayOfWeek === 1), validWeek[1]);

    const ownSchedule = await request(baseUrl, "/api/attendance/schedule", {
      headers: { cookie: employeeCookie },
    });
    assert.equal(ownSchedule.response.status, 200);
    assert.equal(ownSchedule.body.employeeId, employee.id);
    assert.equal(ownSchedule.body.days.find((day: { dayOfWeek: number }) => day.dayOfWeek === 1)?.mealEnd, "13:00");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(path.dirname(databasePath), { recursive: true, force: true });
  }
});