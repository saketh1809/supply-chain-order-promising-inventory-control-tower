#!/bin/sh
# Applies migrations, optionally seeds demo data, then starts the given command.
set -eu

echo "[entrypoint] applying database migrations"
npx prisma migrate deploy

if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] seeding demo data (no-op when data already exists)"
  npx ts-node --transpile-only prisma/seed.ts || echo "[entrypoint] seed failed; continuing"
fi

exec "$@"
