import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const databasePath = path.join(
  await fs.mkdtemp(path.join(os.tmpdir(), "attendance-qr-test-")),
  "attendance.sqlite",
);
process.env.SQLITE_DATABASE_PATH = databasePath;

const {
  attendanceTokensTable,
  cleanupExpiredQrRecords,
  db,
  qrDisplayLinksTable,
} = await import("./index");
const { and, eq, gt, isNull } = await import("drizzle-orm");

const now = new Date("2026-08-22T15:00:00.000Z");
const activeToken = {
  id: randomUUID(),
  tokenHash: "active-token-hash",
  encryptedToken: "active-token",
  expiresAt: new Date("2026-08-22T15:05:00.000Z"),
  isActive: true,
};
const displayLink = {
  id: randomUUID(),
  accessHash: "active-display-link-hash",
  expiresAt: new Date("2026-08-22T15:05:00.000Z"),
};

function rotateToken(sequence: number): void {
  db.transaction((tx) => {
    tx
      .update(attendanceTokensTable)
      .set({ isActive: false })
      .where(eq(attendanceTokensTable.isActive, true))
      .run();
    tx
      .insert(attendanceTokensTable)
      .values({
        id: randomUUID(),
        tokenHash: `rotated-token-${sequence}`,
        encryptedToken: `rotated-token-${sequence}`,
        expiresAt: new Date(now.getTime() + 300_000),
        isActive: true,
      })
      .run();
  });
}

test("limpieza por lotes no interrumpe validaciones, enlaces ni rotaciones QR", async () => {
  const expiredAt = new Date(now.getTime() - 1_000);

  await db.insert(attendanceTokensTable).values(activeToken);
  await db.insert(qrDisplayLinksTable).values(displayLink);

  // More than one batch makes the cleanup exercise its bounded-delete path.
  await db.insert(attendanceTokensTable).values(
    Array.from({ length: 240 }, (_, index) => ({
      id: randomUUID(),
      tokenHash: `expired-token-${index}`,
      encryptedToken: `expired-token-${index}`,
      expiresAt: expiredAt,
      isActive: false,
    })),
  );
  await db.insert(qrDisplayLinksTable).values(
    Array.from({ length: 240 }, () => ({
      id: randomUUID(),
      accessHash: randomUUID(),
      expiresAt: expiredAt,
    })),
  );

  const cleanup = (async () => {
    let removed = 0;
    do {
      const result = cleanupExpiredQrRecords(now, 25);
      removed += result.attendanceTokens + result.displayLinks;
      await Promise.resolve();
      if (result.attendanceTokens + result.displayLinks === 0) break;
    } while (true);
    return removed;
  })();

  const validateAndReadLink = (async () => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const [token] = await db
        .select({ id: attendanceTokensTable.id })
        .from(attendanceTokensTable)
        .where(
          and(
            eq(attendanceTokensTable.isActive, true),
            gt(attendanceTokensTable.expiresAt, now),
          ),
        );
      const [link] = await db
        .select({ id: qrDisplayLinksTable.id })
        .from(qrDisplayLinksTable)
        .where(
          and(
            eq(qrDisplayLinksTable.accessHash, displayLink.accessHash),
            gt(qrDisplayLinksTable.expiresAt, now),
            isNull(qrDisplayLinksTable.revokedAt),
          ),
        );
      assert.ok(token, "el token QR vigente debe estar disponible");
      assert.ok(link, "el enlace QR no vencido debe permanecer disponible");
      await Promise.resolve();
    }
  })();

  const rotate = (async () => {
    for (let sequence = 0; sequence < 40; sequence += 1) {
      rotateToken(sequence);
      await Promise.resolve();
    }
  })();

  const [removed] = await Promise.all([cleanup, validateAndReadLink, rotate]);

  assert.equal(removed, 480);
  assert.equal(
    (await db
      .select({ id: attendanceTokensTable.id })
      .from(attendanceTokensTable)
      .where(eq(attendanceTokensTable.tokenHash, activeToken.tokenHash))).length,
    1,
    "el token vigente inicialmente puede rotarse, pero no debe ser eliminado por limpieza",
  );
  assert.equal(
    (await db
      .select({ id: qrDisplayLinksTable.id })
      .from(qrDisplayLinksTable)
      .where(eq(qrDisplayLinksTable.accessHash, displayLink.accessHash))).length,
    1,
  );
  assert.equal(
    (await db
      .select({ id: attendanceTokensTable.id })
      .from(attendanceTokensTable)
      .where(eq(attendanceTokensTable.isActive, true))).length,
    1,
    "las rotaciones concurrentes deben conservar un único token activo",
  );
});