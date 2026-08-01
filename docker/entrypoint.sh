#!/bin/sh
# HAL container entrypoint: migrate → seed → bootstrap invite → serve.
# Every step is idempotent, so restarts are safe.
set -e
cd /app/server

echo "hal: applying database migrations..."
npx prisma migrate deploy

echo "hal: seeding default roles..."
node prisma/seed.js

# Prints a one-time invite code on a fresh instance (no-op once users exist)
node scripts/bootstrap-invite.js

echo "hal: starting server..."
exec node src/index.js
