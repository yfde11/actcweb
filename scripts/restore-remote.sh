#!/usr/bin/env bash
# 在遠端主機執行：由指定備份目錄還原 MongoDB 與 uploads。

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "用法：$0 <backup_dir>" >&2
  echo "例如：$0 \$HOME/backups/actcweb/2026-04-25_033000" >&2
  exit 1
fi

BACKUP_DIR="$1"
APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
COMPOSE_ENV="${COMPOSE_ENV:-.env.docker}"
MONGO_DB="${MONGO_DB:-actc_website}"

if [ ! -d "${BACKUP_DIR}" ]; then
  echo "找不到備份目錄：${BACKUP_DIR}" >&2
  exit 1
fi

DB_FILE="${BACKUP_DIR}/mongo_${MONGO_DB}.archive.gz"
UPLOADS_FILE="${BACKUP_DIR}/uploads.tar.gz"

if [ ! -f "${DB_FILE}" ]; then
  echo "找不到資料庫備份檔：${DB_FILE}" >&2
  exit 1
fi
if [ ! -f "${UPLOADS_FILE}" ]; then
  echo "找不到 uploads 備份檔：${UPLOADS_FILE}" >&2
  exit 1
fi

cd "${APP_DIR}"
compose_cmd=(docker compose)
if [ -f "${COMPOSE_ENV}" ]; then
  compose_cmd+=(--env-file "${COMPOSE_ENV}")
fi

echo "==> Restoring MongoDB from ${DB_FILE}"
cat "${DB_FILE}" | "${compose_cmd[@]}" exec -T mongo mongorestore --drop --gzip --archive --nsInclude "${MONGO_DB}.*"

echo "==> Restoring uploads from ${UPLOADS_FILE}"
cat "${UPLOADS_FILE}" | "${compose_cmd[@]}" exec -T web sh -lc "mkdir -p /app/uploads && rm -rf /app/uploads/* && tar -xzf - -C /app/uploads"

echo "==> Restart web/caddy"
"${compose_cmd[@]}" restart web caddy

echo "==> Restore completed"
