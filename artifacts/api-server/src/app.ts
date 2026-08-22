import express, { type Express } from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(express.json({ limit: "3mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/api", router);

// In CapRover production the API and SPA share one origin. Keep API paths out
// of the fallback so missing API routes remain real 404s.
if (process.env.NODE_ENV === "production") {
  const frontendDir =
    process.env.FRONTEND_DIST_DIR ?? path.resolve(process.cwd(), "public");
  const frontendEntry = path.join(frontendDir, "index.html");

  if (existsSync(frontendEntry)) {
    app.use(express.static(frontendDir, { index: "index.html" }));
    app.use((req, res, next) => {
      if (
          req.path === "/api" ||
          req.path.startsWith("/api/")
      ) {
        next();
        return;
      }
      res.sendFile(frontendEntry);
    });
  } else {
    logger.warn({ frontendDir }, "Frontend build directory was not found");
  }
}

export default app;
