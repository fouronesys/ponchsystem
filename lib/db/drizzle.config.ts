import { defineConfig } from "drizzle-kit";
import path from "path";

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  out: path.join(__dirname, "./drizzle"),
  dialect: "sqlite",
  dbCredentials: {
    url:
      process.env.SQLITE_DATABASE_PATH ??
      path.resolve(__dirname, "./data/attendance.sqlite"),
  },
});
