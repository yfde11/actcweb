#!/usr/bin/env bash
# 在本機執行：透過 SSH 到遠端安裝備份排程（cron）。
#
# 雲端上傳：在遠端專案目錄建立 .env.rclone（見 env.rclone.example 與 docs/REMOTE_BACKUP_ONEDRIVE.md）後，
# 同一路徑的 backup-remote.sh 由 cron 呼叫時即會一併上傳（無須再改本腳本）。

set -euo pipefail

REMOTE="${REMOTE:-${1:-}}"
REMOTE_DIR="${REMOTE_DIR:-${2:-~/actcweb}}"
CRON_SCHEDULE="${CRON_SCHEDULE:-30 3 * * *}"
BACKUP_ROOT="${BACKUP_ROOT:-\$HOME/backups/actcweb}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
MONGO_DB="${MONGO_DB:-actc_website}"

if [ -z "${REMOTE}" ]; then
  echo "用法：REMOTE=user@host $0 [REMOTE] [REMOTE_DIR]" >&2
  exit 1
fi

cron_cmd="${CRON_SCHEDULE} APP_DIR=${REMOTE_DIR} BACKUP_ROOT=${BACKUP_ROOT} RETENTION_DAYS=${RETENTION_DAYS} MONGO_DB=${MONGO_DB} ${REMOTE_DIR}/scripts/backup-remote.sh >> ${REMOTE_DIR}/logs/backup.log 2>&1"

ssh -o "BatchMode=${SSH_BATCH_MODE:-no}" "${REMOTE}" "set -e; mkdir -p ${REMOTE_DIR}/logs; mkdir -p ${REMOTE_DIR}/scripts; chmod +x ${REMOTE_DIR}/scripts/backup-remote.sh ${REMOTE_DIR}/scripts/restore-remote.sh; (crontab -l 2>/dev/null | grep -v '${REMOTE_DIR}/scripts/backup-remote.sh' ; echo '${cron_cmd}') | crontab -; echo 'Installed cron:'; crontab -l | grep '${REMOTE_DIR}/scripts/backup-remote.sh'"
