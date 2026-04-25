# 本機／遠端備份完成後自動上傳 OneDrive（rclone）

備份腳本 `scripts/backup-remote.sh` 在成功產生本機備份目錄後，可**選用** [rclone](https://rclone.org/) 將該次目錄同步到 **Microsoft OneDrive**（及任何 rclone 支援的雲端，語法相同，僅 `rclone config` 遠端類型不同）。

## 安全聲明（必讀）

- **請勿在程式碼、手冊或聊天中提供 Microsoft 帳號密碼**；rclone 對 OneDrive/個人 Microsoft 帳戶採用 **OAuth2 授權**，**不需要**、也**不應**用密碼寫入設定檔。
- 若密碼曾出現在可公開管道，**請盡快至 Microsoft 帳戶重設密碼**。

## 1. 在備份主機安裝 rclone

**Debian / Ubuntu 範例**：

```bash
curl https://rclone.org/install.sh | sudo bash
# 或: sudo apt install rclone
```

**Alpine 容器內不適合跑 cron 備份**；請在**實際執行備份的 Linux 主機**（你目前的 remote）安裝。

## 2. 設定 OneDrive 遠端（OAuth，建議方式）

在該主機上執行互動式設定（依提示登入微軟帳戶、同意權限）：

```bash
rclone config
# n) New remote → 名稱可設 onedrive（與下述 RCLONE_REMOTE 一致）
# Storage: Microsoft OneDrive
# 其餘依官方預設，完成瀏覽器 OAuth
```

產生之設定位於 `~/.config/rclone/rclone.conf`，請**限制權限**（僅擁有者可讀寫）：

```bash
chmod 600 ~/.config/rclone/rclone.conf
```

### 無圖形介面主機（headless）

在**有瀏覽器的電腦**執行：

```bash
rclone authorize "onedrive"
```

將顯示之 token/設定貼到伺服器上的 `rclone config` 精靈。詳見 [rclone 文件：headless 設定](https://rclone.org/remote_setup/)。

## 3. 啟用「備份後上傳」

在專案目錄下建立 **`.env.rclone`**（**不提交** Git，已列於 `.gitignore`；遠端路徑範例 `~/actcweb/.env.rclone`）：

參考範本 [`env.rclone.example`](../env.rclone.example) 複製後編輯：

```bash
cp env.rclone.example .env.rclone
nano .env.rclone
```

至少設定：

- `RCLONE_UPLOAD=1`：啟用
- `RCLONE_REMOTE=onedrive`：與 `rclone config` 的遠端**名稱**一致
- `RCLONE_PATH_PREFIX=actcweb-backups`：在 OneDrive 內的資料夾前綴（可自訂）

上傳目標為：`<遠端>:<RCLONE_PATH_PREFIX>/<此次備份時間戳>/`，內容與本機該次備份目錄相同。

可選：若 rclone 設定檔**不在**預設路徑，可設：

```env
RCLONE_CONFIG=/path/to/rclone.conf
```

## 4. 測試

手動執行一次備份，確認本機產生目錄且 OneDrive 出現新資料夾：

```bash
cd ~/actcweb
./scripts/backup-remote.sh
```

在 OneDrive 網頁或 App 中檢查 `actcweb-backups/<timestamp>/` 是否含 `mongo_*.archive.gz`、`uploads.tar.gz`、`SHA256SUMS` 等。

## 5. 與 cron 的關係

已存在的 cron 只要呼叫同一路徑的 `backup-remote.sh`，且該專案目錄內有正確的 `.env.rclone`，**無須**改 crontab，每次排程都會在備份完成後上傳。

## 6. 雲端舊檔保留

本腳本**不會**自動刪除 OneDrive 上的歷史備份；本機只依 `RETENTION_DAYS` 刪舊。若需雲端限留 N 天，可另排程使用 `rclone delete --min-age` 等，務必先演練。

## 7. 參考

- [rclone onedrive](https://rclone.org/onedrive/)
- 基本備份手冊：[`REMOTE_BACKUP_RUNBOOK.md`](./REMOTE_BACKUP_RUNBOOK.md)
