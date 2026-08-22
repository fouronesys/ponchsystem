import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const employeesTable = pgTable(
  "employees",
  {
    id: uuid("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role").notNull().default("employee"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("employees_clerk_user_id_unique").on(table.clerkUserId),
  ],
);

export const attendanceTokensTable = pgTable(
  "attendance_tokens",
  {
    id: uuid("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    encryptedToken: text("encrypted_token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("attendance_tokens_hash_unique").on(table.tokenHash),
    uniqueIndex("attendance_tokens_one_active_unique")
      .on(table.isActive)
      .where(sql`${table.isActive} = true`),
    index("attendance_tokens_validation_idx").on(
      table.tokenHash,
      table.isActive,
      table.expiresAt,
    ),
  ],
);

export const attendanceEventsTable = pgTable(
  "attendance_events",
  {
    id: uuid("id").primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    type: text("type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    location: text("location"),
    deviceLabel: text("device_label"),
  },
  (table) => [
    index("attendance_events_employee_time_idx").on(
      table.employeeId,
      table.occurredAt,
    ),
    index("attendance_events_time_idx").on(table.occurredAt),
  ],
);

export const insertEmployeeSchema = createInsertSchema(employeesTable).omit({
  createdAt: true,
});
export const insertAttendanceTokenSchema =
  createInsertSchema(attendanceTokensTable).omit({ createdAt: true });
export const insertAttendanceEventSchema = createInsertSchema(
  attendanceEventsTable,
).omit({ occurredAt: true });

export type Employee = typeof employeesTable.$inferSelect;
export type AttendanceToken = typeof attendanceTokensTable.$inferSelect;
export type AttendanceEvent = typeof attendanceEventsTable.$inferSelect;
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type InsertAttendanceToken = z.infer<typeof insertAttendanceTokenSchema>;
export type InsertAttendanceEvent = z.infer<typeof insertAttendanceEventSchema>;