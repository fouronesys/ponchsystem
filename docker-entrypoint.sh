#!/bin/sh
set -eu

node <<'NODE'
const fs = require("node:fs");

const config = {
  clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  clerkProxyUrl: process.env.CLERK_PROXY_URL || undefined,
};

if (!config.clerkPublishableKey) {
  throw new Error("CLERK_PUBLISHABLE_KEY is required.");
}

fs.writeFileSync(
  "/app/public/runtime-config.js",
  `window.__CONTROL_ASISTENCIA_CONFIG__ = ${JSON.stringify(config)};\n`,
);
NODE

exec node --enable-source-maps dist/index.mjs