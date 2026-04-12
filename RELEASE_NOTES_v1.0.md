# ACTC 動態網站 — Release Notes **v1.0.0**

發行日期：**2026-04-12**  
套件名稱：`actc-dynamic-website`（`package.json` version `1.0.0`）

本文件供對外公告、內部上線檢核或 Git Tag／GitHub Release 說明複製使用。

---

## 總覽

v1.0 為協會官網與會員／管理後台的**首個正式發行版**：整合前台內容、會員註冊與驗證、活動與新聞、企業會員、工作小組，以及 Docker 化部署與首次連線資料庫初始化流程。

---

## 主要功能

### 內容與展示

- 最新消息：多圖、附件、連結、分類與發布流程；後台 CRUD。
- 活動：類型、場次／講者、報名狀態等；後台與前台列表。
- 企業會員與工作小組頁面及對應 API／後台維護。
- 響應式前台（Tailwind、Swiper）。

### 會員與帳號

- 註冊、登入（JWT）、信箱驗證與重送驗證信。
- 忘記密碼／重設密碼（需設定 SMTP）。
- 會員專區與會員限定內容 API。
- 會籍審核、個人資料與管理端使用者相關流程（依路由與角色）。

### 管理後台

- 後台入口與子頁（新聞、活動、企業會員等）；JWT 保護之管理 API。

### 安全與基礎建設

- Helmet 安全標頭；生產環境強制設定 `JWT_SECRET`。
- MongoDB 連線可設定逾時（如 `MONGO_SERVER_SELECTION_TIMEOUT_MS`）。

---

## 部署與維運

### Docker

- `Dockerfile` + `docker-compose.yml`：`web` 與 `mongo` 分離，**mongo-data**、**uploads-data** 以命名 volume 持久化。
- 環境變數範本：`env.docker.example` → 複製為 `.env.docker` 後搭配 `docker compose --env-file .env.docker up --build`。

### 首次連線資料庫（Bootstrap）

- 邏輯集中於 **`lib/bootstrapDb.js`**，於 MongoDB 連線成功後由 **`server.js`** 呼叫 **`bootstrapDatabase()`**。
- 行為摘要：
  - 若無 `admin` 帳號：建立預設管理員（**請上線後立即變更密碼**）。
  - 舊資料欄位補齊（例如 `emailVerified` 等）。
  - 若新聞／活動／工作小組集合為空：寫入範例資料（利於示範與驗收）。

### 日誌

- 應用以標準輸出為主；Docker 環境請以 `docker compose logs` 等收集，無內建固定檔案日誌路徑依賴。

---

## 環境變數（重點）

| 變數 | 說明 |
|------|------|
| `MONGO_URI` | MongoDB 連線字串 |
| `JWT_SECRET` | JWT 簽章金鑰；**生產必填** |
| `PORT` / `HOST` | 監聽埠與綁定位址 |
| `SITE_URL` | 寄信內連結、站台絕對 URL 等 |
| `SMTP_*`、`DIGEST_FROM_EMAIL`、`NOTIFY_FALLBACK_TO` | 寄信（驗證、重設密碼、通知） |

完整範例見 `env.docker.example` 與 README「環境變數」一節。

---

## 升級與相容性

- **Node.js**：`>= 18.18.0`（見 `package.json` `engines`）。
- 自本版本起若已有資料庫資料，bootstrap **不會**覆寫既有內容；僅在集合為空時種子範例，並對既有使用者做欄位層級的遷移補齊。

---

## 已知注意事項

- 預設管理員僅供**首次安裝**；正式環境務必改密並限制後台存取來源（網路／反向代理）。
- 寄信相關功能需正確 SMTP 與 `SITE_URL`（或等效變數），否則驗證信／重設連結可能無法正常寄送或網址錯誤。

---

## 檔案與文件

- **安裝與操作說明**：[`README.md`](./README.md)
- **本發行說明**：`RELEASE_NOTES_v1.0.md`

---

© 2026 ACTC 國際資訊安全人才培育與推廣協會
