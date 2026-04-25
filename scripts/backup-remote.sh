#!/usr/bin/env bash
# 在遠端主機執行：備份 MongoDB、uploads 與關鍵設定檔。
# 建議由 cron 定期呼叫。

set -euo pipefail
# cron 常見不含 ~/bin，若 rclone 安裝在使用者家目錄需能執行
export PATH="${HOME}/bin:${PATH}"

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
# 選填：在遠端主機放 ${APP_DIR}/.env.rclone 設定 RCLONE_*（不提交版本庫，已列 .gitignore）
if [ -f "${APP_DIR}/.env.rclone" ]; then
  set -a
  # shellcheck source=/dev/null
  . "${APP_DIR}/.env.rclone"
  set +a
fi
COMPOSE_ENV="${COMPOSE_ENV:-.env.docker}"
BACKUP_ROOT="${BACKUP_ROOT:-$HOME/backups/actcweb}"
MONGO_DB="${MONGO_DB:-actc_website}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
# rclone 上傳至 OneDrive：RCLONE_UPLOAD=1 且已設定 rclone（見 docs/REMOTE_BACKUP_ONEDRIVE.md）
RCLONE_UPLOAD="${RCLONE_UPLOAD:-0}"
RCLONE_PATH_PREFIX="${RCLONE_PATH_PREFIX:-actcweb-backups}"
TS="$(date +%F_%H%M%S)"
OUT_DIR="${BACKUP_ROOT}/${TS}"

mkdir -p "${OUT_DIR}"
cd "${APP_DIR}"

compose_cmd=(docker compose)
if [ -f "${COMPOSE_ENV}" ]; then
  compose_cmd+=(--env-file "${COMPOSE_ENV}")
fi

echo "==> Backup started: ${OUT_DIR}"

echo "==> Dump MongoDB (${MONGO_DB})"
"${compose_cmd[@]}" exec -T mongo mongodump --db "${MONGO_DB}" --archive --gzip > "${OUT_DIR}/mongo_${MONGO_DB}.archive.gz"

echo "==> Archive uploads"
"${compose_cmd[@]}" exec -T web sh -lc "cd /app/uploads && tar -czf - ." > "${OUT_DIR}/uploads.tar.gz"

echo "==> Archive configs"
cfg_files=()
[ -f "${APP_DIR}/.env.docker" ] && cfg_files+=(".env.docker")
[ -f "${APP_DIR}/docker-compose.yml" ] && cfg_files+=("docker-compose.yml")
[ -f "${APP_DIR}/Caddyfile" ] && cfg_files+=("Caddyfile")
[ -f "${APP_DIR}/env.docker.example" ] && cfg_files+=("env.docker.example")
if [ "${#cfg_files[@]}" -gt 0 ]; then
  tar -czf "${OUT_DIR}/configs.tar.gz" "${cfg_files[@]}"
fi

cat > "${OUT_DIR}/metadata.txt" <<EOF
timestamp=${TS}
host=$(hostname)
app_dir=${APP_DIR}
mongo_db=${MONGO_DB}
compose_env=${COMPOSE_ENV}
retention_days=${RETENTION_DAYS}
EOF

(cd "${OUT_DIR}" && shasum -a 256 ./* > SHA256SUMS)

# 備份成功後，可選：上傳本次備份目錄到 OneDrive（rclone 遠端以 OAuth 設定，勿把密碼寫進專案）
if [[ "${RCLONE_UPLOAD}" == "1" || "${RCLONE_UPLOAD}" == "true" ]]; then
  if ! command -v rclone >/dev/null 2>&1; then
    echo "警告：已啟用 RCLONE_UPLOAD 但找不到 rclone，已略過雲端上傳" >&2
  elif [ -z "${RCLONE_REMOTE:-}" ]; then
    echo "警告：RCLONE_UPLOAD=1 但未設定 RCLONE_REMOTE，已略過雲端上傳" >&2
  else
    RCLONE_DEST="${RCLONE_REMOTE}:${RCLONE_PATH_PREFIX}/${TS}"
    echo "==> rclone copy to OneDrive/雲端: ${RCLONE_DEST}"
    if [ -n "${RCLONE_CONFIG:-}" ] && [ -f "${RCLONE_CONFIG}" ]; then
      export RCLONE_CONFIG
    fi
    rclone copy "${OUT_DIR}" "${RCLONE_DEST}" --progress=false --log-level=NOTICE
  fi
fi

echo "==> Prune backups older than ${RETENTION_DAYS} days"
find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d -mtime +"${RETENTION_DAYS}" -exec rm -rf {} \;

echo "==> Backup completed: ${OUT_DIR}"
