import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const databasePath = path.join(
  await fs.mkdtemp(path.join(os.tmpdir(), "payroll-report-http-test-")),
  "attendance.sqlite",
);
process.env.SQLITE_DATABASE_PATH = databasePath;
process.env.SESSION_SECRET = "payroll-report-http-test-secret";
process.env.NODE_ENV = "test";

const [{ default: app }, dbModule, localAuth, weeklySchedule] = await Promise.all([
  import("./app"),
  import("@workspace/db"),
  import("./lib/localAuth"),
  import("./lib/weeklySchedule"),
]);

const { attendanceEventsTable, db, employeesTable } = dbModule;

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

test("los reportes de nómina exportan PDF y XML sólo para administración", async () => {
  const password = "payroll-report-test-password";
  const admin = {
    id: randomUUID(),
    username: "payroll-admin",
    passwordHash: localAuth.hashPassword(password),
    displayName: "Administración de nómina",
    role: "admin" as const,
    active: true,
  };
  const employee = {
    id: randomUUID(),
    username: "payroll-employee",
    passwordHash: localAuth.hashPassword(password),
    displayName: "María Pérez",
    documentNumber: "001-1234567-8",
    jobTitle: "Cajera",
    role: "employee" as const,
    active: true,
  };
  await db.insert(employeesTable).values([admin, employee]);
  await weeklySchedule.replaceWeeklySchedule(
    employee.id,
    Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      startTime: dayOfWeek === 1 ? "08:00" : null,
      endTime: dayOfWeek === 1 ? "17:00" : null,
      mealStart: null,
      mealEnd: null,
    })),
  );
  await db.insert(attendanceEventsTable).values([
    {
      id: randomUUID(),
      employeeId: employee.id,
      type: "check_in",
      occurredAt: new Date("2026-08-24T08:15:00-05:00"),
    },
    {
      id: randomUUID(),
      employeeId: employee.id,
      type: "check_out",
      occurredAt: new Date("2026-08-24T17:10:00-05:00"),
    },
  ]);

  const server: Server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const exportPath = "/api/admin/reports/attendance";

  try {
    const unauthenticated = await fetch(`${baseUrl}${exportPath}.pdf?start=2026-08-24&end=2026-08-31`);
    assert.equal(unauthenticated.status, 401);

    const adminCookie = await login(baseUrl, admin.username, password);
    const employeeCookie = await login(baseUrl, employee.username, password);
    const forbidden = await fetch(`${baseUrl}${exportPath}.xml?start=2026-08-24&end=2026-08-31`, {
      headers: { cookie: employeeCookie },
    });
    assert.equal(forbidden.status, 403);

    const invalidRange = await fetch(`${baseUrl}${exportPath}.pdf?start=2026-08-31&end=2026-08-24`, {
      headers: { cookie: adminCookie },
    });
    assert.equal(invalidRange.status, 400);
    const invalidDate = await fetch(`${baseUrl}${exportPath}.xml?start=2026-02-30&end=2026-03-01`, {
      headers: { cookie: adminCookie },
    });
    assert.equal(invalidDate.status, 400);

    const pdf = await fetch(`${baseUrl}${exportPath}.pdf?start=2026-08-24&end=2026-08-31`, {
      headers: { cookie: adminCookie },
    });
    assert.equal(pdf.status, 200);
    assert.match(pdf.headers.get("content-type") ?? "", /application\/pdf/);
    assert.match(pdf.headers.get("content-disposition") ?? "", /attachment/);
    const pdfBytes = Buffer.from(await pdf.arrayBuffer());
    assert.equal(pdfBytes.subarray(0, 4).toString("ascii"), "%PDF");
    assert.match(pdfBytes.toString("ascii"), /Maria Perez/);
    assert.match(pdfBytes.toString("ascii"), /Ausencias: 1/);

    const xml = await fetch(`${baseUrl}${exportPath}.xml?start=2026-08-24&end=2026-08-31`, {
      headers: { cookie: adminCookie },
    });
    assert.equal(xml.status, 200);
    assert.match(xml.headers.get("content-type") ?? "", /application\/xml/);
    const xmlBody = await xml.text();
    assert.match(xmlBody, /<farcheckPayrollReport version="1.0"/);
    assert.match(xmlBody, /displayName="María Pérez"/);
    assert.match(xmlBody, /expectedDays="2" absenceDays="1"/);
    assert.match(xmlBody, /workedMinutes="535" lateEntries="1" outsideShiftEvents="1"/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(path.dirname(databasePath), { recursive: true, force: true });
  }
});