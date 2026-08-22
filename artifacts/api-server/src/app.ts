import express, { type Express } from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import pinoHttp from "pino-http";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
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
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

// In CapRover production the API and SPA share one origin. Keep API and Clerk
// paths out of the fallback so missing API routes remain real 404s.
if (process.env.NODE_ENV === "production") {
  const frontendDir =
    process.env.FRONTEND_DIST_DIR ?? path.resolve(process.cwd(), "public");
  const frontendEntry = path.join(frontendDir, "index.html");

  if (existsSync(frontendEntry)) {
    app.use(express.static(frontendDir, { index: "index.html" }));
    app.use((req, res, next) => {
      if (
        req.path === "/api" ||
        req.path.startsWith("/api/") ||
        req.path === CLERK_PROXY_PATH ||
        req.path.startsWith(`${CLERK_PROXY_PATH}/`)
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
