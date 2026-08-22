#!/bin/sh
set -eu

if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data
  chown -R node:node /app/data
  exec su -s /bin/sh node -m -c 'exec node --enable-source-maps dist/index.mjs'
fi

exec node --enable-source-maps dist/index.mjs