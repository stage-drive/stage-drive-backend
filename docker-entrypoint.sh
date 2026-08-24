#!/bin/sh
set -e

if [ "$1" = "migrate" ]; then
  echo "Applying Prisma migrations..."
  exec npx prisma migrate deploy
fi

if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  echo "Applying Prisma migrations..."
  npx prisma migrate deploy
fi

exec "$@"
