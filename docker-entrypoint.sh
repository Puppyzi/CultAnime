#!/bin/sh
set -e

PUID="${PUID:-1001}"
PGID="${PGID:-$PUID}"

mkdir -p /app/data /app/.next/cache

if ! chown -R "$PUID:$PGID" /app/data /app/.next/cache; then
  echo "Warning: could not change ownership of /app/data or /app/.next/cache" >&2
fi

exec su-exec "$PUID:$PGID" "$@"
