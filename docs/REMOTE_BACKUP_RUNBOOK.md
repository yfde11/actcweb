# Remote Backup Runbook（192.168.1.220）

此手冊提供 ACTC remote deploy host 的自動備份與還原流程。

## 1. 備份內容

- MongoDB：`actc_website`
- Uploads：`/app/uploads`（由 `actc_uploads_data` volume 掛載）
- 關鍵設定檔：`.env.docker`、`docker-compose.yml`、`Caddyfile`、`env.docker.example`

## 2. 腳本位置

- 備份：`scripts/backup-remote.sh`（在遠端主機執行）
- 還原：`scripts/restore-remote.sh`（在遠端主機執行）
- 安裝排程：`scripts/setup-remote-backup-cron.sh`（在本機執行，透過 SSH 寫入遠端 cron）

## 3. 安裝自動備份排程

### 3.1 同步最新程式到遠端

```bash
REMOTE=actc@192.168.1.220 REMOTE_DIR=~/actcweb ./scripts/deploy-lan.sh
```

### 3.2 安裝 cron（每天 03:30）

```bash
REMOTE=actc@192.168.1.220 REMOTE_DIR=~/actcweb CRON_SCHEDULE="30 3 * * *" ./scripts/setup-remote-backup-cron.sh
```

若要改保留天數（預設 30 天）：

```bash
REMOTE=actc@192.168.1.220 REMOTE_DIR=~/actcweb RETENTION_DAYS=14 ./scripts/setup-remote-backup-cron.sh
```

## 4. 手動執行備份（測試/臨時）

```bash
ssh actc@192.168.1.220 "cd ~/actcweb && APP_DIR=~/actcweb ./scripts/backup-remote.sh"
```

完成後可在遠端看到：

```bash
ssh actc@192.168.1.220 "ls -lah ~/backups/actcweb | tail -n 5"
```

每個備份目錄包含：

- `mongo_actc_website.archive.gz`
- `uploads.tar.gz`
- `configs.tar.gz`（若有對應檔案）
- `metadata.txt`
- `SHA256SUMS`

## 5. 災難復原（GitHub pull 後還原）

### 5.1 先把系統程式拉到最新並啟動

```bash
ssh actc@192.168.1.220 "cd ~/actcweb && git pull origin main && docker compose --env-file .env.docker up -d --build"
```

### 5.2 還原指定備份

```bash
ssh actc@192.168.1.220 "cd ~/actcweb && ./scripts/restore-remote.sh ~/backups/actcweb/2026-04-25_033000"
```

> `restore-remote.sh` 會覆寫目前資料（`mongorestore --drop` + 清空 `/app/uploads` 再還原）。

## 6. 檢查與驗證

### 6.1 查看 cron 是否存在

```bash
ssh actc@192.168.1.220 "crontab -l | grep backup-remote.sh"
```

### 6.2 查看備份執行日誌

```bash
ssh actc@192.168.1.220 "tail -n 100 ~/actcweb/logs/backup.log"
```

### 6.3 驗證備份檔完整性

```bash
ssh actc@192.168.1.220 "cd ~/backups/actcweb/<backup_dir> && shasum -a 256 -c SHA256SUMS"
```

## 7. 建議作法

- 每月至少一次演練完整還原流程。
- 若有法遵需求，請把 `~/backups/actcweb` 再同步到異地儲存（NAS/S3）。
- 備份檔包含可能的個資，請限制遠端帳號與檔案權限。

## 8. 異地雲端：本機備份完成後上傳 OneDrive

- 專案已整合 **rclone** 可選上傳（見 `scripts/backup-remote.sh` 內 RCLONE_* 說明）。
- **完整步驟與安全注意事項**（OAuth，勿在程式內寫帳密）：[`REMOTE_BACKUP_ONEDRIVE.md`](./REMOTE_BACKUP_ONEDRIVE.md)
- 遠端可複製 `env.rclone.example` 為專案根目錄的 `.env.rclone` 後啟用。
