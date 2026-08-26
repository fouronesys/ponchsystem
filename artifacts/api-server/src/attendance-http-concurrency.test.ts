import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import type { Server } from "node:http";

const databasePath = path.join(
  await fs.mkdtemp(path.join(os.tmpdir(), "attendance-http-test-")),
  "attendance.sqlite",
);
process.env.SQLITE_DATABASE_PATH = databasePath;
process.env.SESSION_SECRET = "http-test-session-secret";
process.env.NODE_ENV = "test";

const [{ default: app }, dbModule, localAuth, drizzle] = await Promise.all([
  import("./app"),
  import("@workspace/db"),
  import("./lib/localAuth"),
  import("drizzle-orm"),
]);

const {
  attendanceTokensTable,
  db,
  employeesTable,
  qrDisplayLinksTable,
} = dbModule;
const { eq } = drizzle;

const password = "test-password-123";
const employeeId = randomUUID();
const employee = {
  id: employeeId,
  username: "http-test-admin",
  passwordHash: localAuth.hashPassword(password),
  displayName: "Administrador de pruebas",
  role: "admin" as const,
  active: true,
};

const validPng =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const validLocation = {
  latitude: 19.44739,
  longitude: -70.677598,
  accuracy: 10,
};

function cookieFrom(response: Response): string {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie, "el inicio de sesión debe emitir la cookie de sesión");
  return cookie.split(";", 1)[0]!;
}

async function jsonRequest(
  baseUrl: string,
  route: string,
  init: RequestInit = {},
): Promise<{ response: Response; body: any }> {
  const response = await fetch(`${baseUrl}${route}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

async function runCleanup(now: Date): Promise<number> {
  let removed = 0;
  while (true) {
    const result = dbModule.cleanupExpiredQrRecords(now, 25);
    removed += result.attendanceTokens + result.displayLinks;
    if (result.attendanceTokens + result.displayLinks === 0) return removed;
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
}

test("el flujo HTTP de asistencia sobrevive limpieza, escaneo y rotación QR concurrentes", async () => {
  await db.insert(employeesTable).values(employee);

  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const login = await jsonRequest(baseUrl, "/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: employee.username, password }),
    });
    assert.equal(login.response.status, 200);
    const cookie = cookieFrom(login.response);

    const tokenResponse = await jsonRequest(baseUrl, "/api/admin/qr", {
      headers: { cookie },
    });
    assert.equal(tokenResponse.response.status, 200);
    const rawToken = tokenResponse.body.token as string;

    const linkResponse = await jsonRequest(baseUrl, "/api/admin/qr/display-link", {
      method: "POST",
      headers: { cookie },
    });
    assert.equal(linkResponse.response.status, 201);
    const accessToken = linkResponse.body.accessToken as string;

    const outsideLocation = {
      latitude: validLocation.latitude + 0.003,
      longitude: validLocation.longitude,
      accuracy: validLocation.accuracy,
    };
    const rejectedLocation = await jsonRequest(baseUrl, "/api/attendance/scan", {
      method: "POST",
      headers: { cookie, "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify({
        token: rawToken,
        selfie: validPng,
        location: outsideLocation,
      }),
    });
    assert.equal(rejectedLocation.response.status, 400);
    assert.equal(rejectedLocation.body.code, "OUTSIDE_ATTENDANCE_RADIUS");

    const cleanupTime = new Date();
    const expiredAt = new Date(cleanupTime.getTime() - 1_000);
    await db.insert(attendanceTokensTable).values(
      Array.from({ length: 1_250 }, () => ({
        id: randomUUID(),
        tokenHash: randomUUID(),
        encryptedToken: randomUUID(),
        expiresAt: expiredAt,
        isActive: false,
      })),
    );
    await db.insert(qrDisplayLinksTable).values(
      Array.from({ length: 1_250 }, () => ({
        id: randomUUID(),
        accessHash: randomUUID(),
        expiresAt: expiredAt,
      })),
    );

    const cleanup = runCleanup(cleanupTime);
    const scan = jsonRequest(baseUrl, "/api/attendance/scan", {
      method: "POST",
      headers: { cookie, "x-forwarded-for": "203.0.113.10" },
      body: JSON.stringify({ token: rawToken, selfie: validPng, location: validLocation }),
    });
    const { response: scanResponse } = await scan;
    assert.equal(scanResponse.status, 200, "el escaneo válido debe aceptarse durante la limpieza");
    assert.deepEqual(JSON.parse((await scan).body.location), {
      latitude: validLocation.latitude,
      longitude: validLocation.longitude,
      accuracy: validLocation.accuracy,
    });

    const rotate = jsonRequest(baseUrl, "/api/admin/qr/rotate", {
      method: "POST",
      headers: { cookie },
    });
    const displayRead = jsonRequest(baseUrl, `/api/qr-display/${accessToken}`);

    const [{ response: rotateResponse }, { response: displayResponse }, removed] =
      await Promise.all([rotate, displayRead, cleanup]);

    assert.equal(rotateResponse.status, 200, "la rotación debe responder durante la limpieza");
    assert.equal(displayResponse.status, 200, "el enlace vigente debe seguir respondiendo");
    assert.equal(removed, 2_500, "la limpieza debe retirar todos los registros vencidos por lotes");

    const duplicate = await jsonRequest(baseUrl, "/api/attendance/scan", {
      method: "POST",
      headers: { cookie, "x-forwarded-for": "203.0.113.11" },
      body: JSON.stringify({ token: rawToken, selfie: validPng, location: validLocation }),
    });
    assert.equal(duplicate.response.status, 400, "un token consumido no debe aceptarse otra vez");

    assert.equal(
      (await db.select().from(dbModule.attendanceEventsTable)).length,
      1,
      "el token válido debe crear exactamente un evento",
    );
    const manualCheckout = await jsonRequest(baseUrl, "/api/attendance/manual", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ selfie: validPng, location: validLocation }),
    });
    assert.equal(manualCheckout.response.status, 200, `el empleado debe poder registrar su salida sin QR: ${JSON.stringify(manualCheckout.body)}`);
    assert.equal(manualCheckout.body.type, "check_out");

    const duplicateManual = await jsonRequest(baseUrl, "/api/attendance/manual", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ selfie: validPng, location: validLocation }),
    });
    assert.equal(duplicateManual.response.status, 400, "un doble envío manual inmediato no debe alternar otra vez el estado");
    assert.equal(
      (await db.select().from(attendanceTokensTable).where(eq(attendanceTokensTable.isActive, true))).length,
      1,
      "debe quedar un único token activo tras la rotación",
    );
  } finally {
    server.close();
    await once(server, "close");
  }
});