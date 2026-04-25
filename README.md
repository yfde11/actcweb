# ACTC 國際資訊安全人才培育與推廣協會 — 動態網站

**版本：1.0.0**（詳見 [`RELEASE_NOTES_v1.0.md`](./RELEASE_NOTES_v1.0.md)；最新更新見 [`RELEASE_NOTES_2026-04-25.md`](./RELEASE_NOTES_2026-04-25.md)）

Node.js + Express + MongoDB 的協會官網與會員／後台管理系統，含最新消息、活動、企業會員、工作小組與會員註冊／審核流程。

---

## 功能概覽

### 前台

- **首頁與內容頁**：最新消息、活動、關於我們、企業會員、工作小組等靜態與動態頁面。
- **響應式版面**：Tailwind CSS；重點色為橙色（`actc-orange`）。
- **圖片輪播**：Swiper.js。

### 最新消息（News）

- 多圖上傳（JPG／PNG，每張上限與數量依後台設定）、附件（如 PPTX／PDF／DOCX）、外部連結。
- 分類與發布狀態管理。

### 活動（Events）

- 活動類型、報名狀態、講者與場次等欄位；後台 CRUD，前台列表與展示。
- 支援會員活動中心：我的報名紀錄、取消報名、付款資訊上傳、活動詳情彈窗。
- 支援活動營運能力：報名名單、教材管理、問卷回饋、營運總覽。

### 企業會員（Corporate members）

- 企業會員資料維護與前台展示頁。

### 工作小組（Working groups）

- 前台 `workgroups.html` 與 API：`/api/working-groups`；後台管理：`/api/admin/working-groups`。

### 會員與認證

- **註冊／登入**：JWT；信箱驗證、重送驗證信。
- **忘記密碼／重設密碼**：需設定 SMTP（見環境變數）。
- **會員專區**：`public/member/index.html` 與會員限定 API（最新消息／活動等）。
- **會籍審核與個人資料**：對應 `routes/membership.js`、`routes/profile.js`、`routes/users.js`（管理端）。

### 後台管理

- **後台入口**：`/admin`（主控台）、活動與新聞等子頁。
- **JWT 保護**：管理 API 需帶有效 Token。
- **名單管理優化**：顯示付款資訊狀態、移除過長/低可讀欄位、改善活動資料管理操作。

### 近期系統更新（2026-04-25）

- **管理者可留在會員中心**：`admin` 登入後可在 `/member` 保有一般會員操作，並可一鍵前往 `/admin`。
- **我的活動中心強化**：新增活動詳情 popup；付款資訊可填金額、帳戶末五碼、備註與收據上傳，且可重複更新。
- **統計與相容性修正**：修正報名名單姓名/Email 顯示與舊資料相容，並修正首頁與營運總覽的已報名統計邏輯。
- **活動編輯穩定性**：修正活動更新時 `endDate` 驗證誤判問題。
- **部署流程**：持續採 Docker Compose 佈署至內網主機，確保前後端與資料模型同步更新。

### 安全與標頭

- **Helmet** 安全標頭；生產環境須設定強隨機 **`JWT_SECRET`**。

---

## 技術棧

| 項目 | 技術 |
|------|------|
| 執行環境 | Node.js **≥ 18.18** |
| 後端 | Express 4 |
| 資料庫 | MongoDB + Mongoose 8 |
| 上傳 | Multer |
| 認證 | JWT（jsonwebtoken） |
| 郵件 | Nodemailer（驗證信、通知等） |
| 前端 | HTML5、Tailwind、Swiper |

---

## 快速開始（本機）

### 1. 安裝依賴

```bash
npm install
```

### 2. 環境變數

於專案根目錄建立 `.env`（勿提交版本庫），例如：

```env
MONGO_URI=mongodb://localhost:27017/actc_website
JWT_SECRET=請改為至少32字元的隨機密鑰
PORT=5001
HOST=0.0.0.0

# 選填：會員驗證信、忘記密碼連結等（未設定則相關功能可能無法寄信）
SITE_URL=http://localhost:5001
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USE_TLS=true
SMTP_USERNAME=
SMTP_PASSWORD=
DIGEST_FROM_EMAIL=
NOTIFY_FALLBACK_TO=
```

生產環境**必須**設定強隨機的 `JWT_SECRET`；未設定時，在 `production` 下伺服器會拒絕啟動。

### 3. 啟動 MongoDB

```bash
# macOS（Homebrew 範例）
brew services start mongodb/brew/mongodb-community

# 或本機直接執行
mongod
```

### 4. 啟動應用

```bash
npm start
# 開發可改用：npm run dev
```

### 5. 瀏覽

| 用途 | 網址 |
|------|------|
| 前台首頁 | http://localhost:5001（本機 `npm start`） |
| 後台 | 同上 `/admin` |
| 會員專區 | 同上 `/member/` |
| Docker Compose | **http://localhost/** 與 **https://localhost/**（Caddy 反代 80／443） |

**首次連線資料庫**時，應用程式會自動執行 [`lib/bootstrapDb.js`](./lib/bootstrapDb.js)：

- 若尚無 `admin` 使用者，會建立預設管理員（使用者名稱 **`admin`**／密碼 **`admin`**）。
- 對舊資料做必要欄位補齊（如 `emailVerified`）。
- 若各集合為空，會寫入範例新聞、活動與工作小組（WG1–WG4）。

**正式上線請立即變更預設管理員密碼**，並勿將 `.env`／`.env.docker` 提交至版本庫。

---

## Docker 部署

專案含 `Dockerfile`、`docker-compose.yml` 與 **`Caddyfile`**：**mongo**、**web**（Node 僅內部 5001）、**caddy**（對外 **80 / 443**）分離；資料庫、上傳檔與 Caddy 憑證資料使用命名 volume 持久化。

```bash
cp env.docker.example .env.docker
# 編輯 .env.docker：至少設定 JWT_SECRET；SITE_URL 請設為對外網址（例如 http://192.168.1.10 或 https://你的網域，勿加 :5001）
# 寄信請填 SMTP 相關變數

# 內網 HTTPS 須先有自簽憑證（含對外 IP 的 SAN），否則 Caddy 無法完成 TLS 握手：
CADDY_TLS_IP=你的對外IP ./scripts/init-caddy-certs.sh

docker compose --env-file .env.docker up --build
```

啟動後 **HTTP 與 HTTPS 會同時開放**。內網／無公網網域時：443 使用 **`caddy-certs/`** 內 **OpenSSL 自簽憑證**（`scripts/init-caddy-certs.sh` 產生；**`caddy-certs/`** 已列入 `.gitignore`），瀏覽器會提示不安全屬正常。後台為 **`/admin`**；若 80/443 被占用，可在 `.env.docker` 設定 `HTTP_PORT`、`HTTPS_PORT`。

**正式網域（例如 `www.actc-tw.org`）要變成瀏覽器可信任的 HTTPS**：須改為由 **Let's Encrypt** 簽發憑證（Caddy 預設會自動申請與續期），步驟摘要如下（詳見專案內 **`Caddyfile.production.example`**）：

1. **DNS**：`actc-tw.org`、`www.actc-tw.org` 的 **A／AAAA** 指向伺服器之 **公網 IP**（僅內網 IP 無法通過 Let's Encrypt 驗證）。
2. **對外連線**：從網際網路能連到該主機的 **80、443**（同埠轉發到跑 Caddy 的機器）。
3. **Caddy 設定**：以 **`Caddyfile.production.example`** 為範本，改為 **`www.actc-tw.org, actc-tw.org { … }`** 這類「網址區塊」（**不要**再使用 `auto_https off` 與 **`caddy-certs` 手動憑證**）。請將內容複製為專案根目錄的 **`Caddyfile`**，並在 **`docker-compose.yml`** 的 **caddy** 服務中**註解或刪除** `./caddy-certs:/certs:ro` 這一行。
4. **環境變數**：`.env.docker` 的 **`SITE_URL=https://www.actc-tw.org`**（與使用者實際開啟的網址一致）。
5. **Cloudflare**：若網域經 **CDN 代理（橘雲）**，常見的 **HTTP-01** 驗證會失敗；請改為 **僅 DNS（灰雲）**，或改用 Caddy 的 **DNS-01** 外掛（需 API token，範例檔未內建）。

MongoDB 僅在 Docker 內部網路對 `web` 開放；若需本機直連 Mongo 除錯，可自行在 `mongo` 服務加上 `ports`（僅建議開發環境）。

---

## 目錄結構（精簡）

```
actcweb/
├── lib/                 # 共用邏輯（含首次連線資料庫 bootstrap）
├── models/              # Mongoose 模型
├── routes/              # API 路由
├── middleware/          # 認證、Mongo 就緒等
├── services/            # 郵件、通知、Google Analytics 等
├── public/              # 靜態前端（含 admin、member）
├── uploads/             # 使用者上傳檔（執行時產生／掛載）
├── server.js            # 應用程式入口
├── docker-compose.yml
├── Dockerfile
└── package.json
```

---

## API 端點（摘要）

實際路徑與權限以 `server.js` 及各 `routes/*.js` 為準；常見例如：

| 區塊 | 範例 |
|------|------|
| 認證 | `POST /api/auth/login`、`POST /api/auth/register`、`GET /api/auth/verify-email`、`POST /api/auth/forgot-password`、`POST /api/auth/reset-password` |
| 新聞（管理） | `GET/POST /api/news`、`PUT/DELETE /api/news/:id` |
| 活動 | `GET/POST /api/events` 等 |
| 工作小組 | `GET /api/working-groups`、`/api/admin/working-groups`（管理） |
| 會員 | `GET /api/member/news`、`GET /api/member/events` 等 |
| 會籍／個人 | `/api/membership`、`/api/profile`、`/api/users`（依角色） |

---

## 維運備註

### Remote 備份與還原

- 已提供 remote 自動備份腳本與還原腳本，詳見 [`docs/REMOTE_BACKUP_RUNBOOK.md`](./docs/REMOTE_BACKUP_RUNBOOK.md)。
- 對應腳本：`scripts/backup-remote.sh`、`scripts/restore-remote.sh`、`scripts/setup-remote-backup-cron.sh`。
- 可選：備份成功後上傳 **OneDrive**（rclone、OAuth 設定，勿提交帳密）見 [`docs/REMOTE_BACKUP_ONEDRIVE.md`](./docs/REMOTE_BACKUP_ONEDRIVE.md) 與 [env 範例 `env.rclone.example`](./env.rclone.example)。

### 資料庫備份

```bash
mongodump --db actc_website --out backup/
```

### 日誌

目前應用以 **標準輸出**（`console`）為主；若以 Docker 或 systemd 執行，請用容器／服務的日誌機制收集（例如 `docker compose logs -f web`），無須依賴專案內固定檔案路徑。

### 選用：Google Analytics

若啟用後端 GA 整合，請設定 `GA_ENABLED`、`GA_PROPERTY_ID`、`GA_KEY_FILE` 等（見 `services/googleAnalytics.js`）。

---

## 聯絡

如有問題或建議，請聯絡 ACTC 技術團隊。

---

© 2026 ACTC 國際資訊安全人才培育與推廣協會
