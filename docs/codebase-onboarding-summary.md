# ACTC Web Codebase Onboarding Summary

更新日期：2026-06-19

## 專案定位

ACTC Web 是一個單體 Node.js/Express 應用，整合：

- 協會官網
- 會員註冊與會員專區
- 管理後台
- 活動報名與營運管理
- 線上考試、題庫、證書與驗證系統

前後端部署在同一個服務中。前端沒有 build step，直接由 `public/` 內的靜態 HTML、Tailwind CDN、Alpine.js 提供頁面；後端則以 Express 路由加上 MongoDB/Mongoose 提供 API。

## 高層架構

### 入口與啟動流程

入口檔案是 `server.js`，啟動順序如下：

1. 載入 `.env`
2. 驗證 `JWT_SECRET`
3. 初始化 Express、Helmet、CORS、JSON parser、cookie parser
4. 所有 `/api/*` 先經過 `middleware/mongoReady.js`
5. 註冊各 API routes 與靜態頁面 routes
6. 連線 MongoDB
7. 成功後執行 `lib/bootstrapDb.js`
8. 最後才 `app.listen()`

這個順序代表系統刻意要求資料庫先 ready，才允許 API 對外提供服務。

### 分層方式

- `server.js`
  應用入口、middleware、route mount、靜態頁面路由、Mongo 連線、cron 內呼
- `routes/`
  HTTP 層，負責驗證輸入、授權、回應格式與調用 model/service
- `models/`
  Mongoose schema，定義所有核心資料結構
- `services/`
  跨模組邏輯，例如寄信、活動報名、考試批改、證書生成、GA 整合
- `middleware/`
  Mongo ready gate、admin/member auth
- `public/`
  官網、後台、會員中心、考試頁面與前端元件
- `lib/`
  啟動時 bootstrap 等共用邏輯

## 主要模組

### 1. 官網內容模組

對應路由與頁面：

- `routes/news.js`
- `routes/events.js`
- `routes/corporate-members.js`
- `routes/working-groups.js`
- `public/index.html`
- `public/pages/news.html`
- `public/pages/corporate-members.html`
- `public/about.html`
- `public/workgroups.html`

功能包含：

- 最新消息 CRUD 與前台顯示
- 活動/課程 CRUD、前台列表與詳情
- 企業會員展示與後台管理
- 工作小組前台展示

### 2. 會員與認證模組

對應檔案：

- `routes/auth.js`
- `routes/profile.js`
- `routes/membership.js`
- `routes/users.js`
- `middleware/adminAuth.js`
- `middleware/memberAuth.js`

功能包含：

- 註冊、登入、登出
- 信箱驗證、重送驗證信
- 忘記密碼與重設密碼
- 會員申請與審核
- 個人資料維護
- 後台會員管理

JWT 來源同時支援 cookie 與 `Authorization: Bearer ...`。

### 3. 活動報名與營運模組

對應檔案：

- `routes/events.js`
- `routes/member-events.js`
- `services/eventRegistrations.js`
- `models/Event.js`
- `models/EventRegistration.js`
- `models/EventMaterial.js`
- `models/EventSurveyResponse.js`

功能包含：

- 一般/會員活動報名
- 付款資訊與付款證明上傳
- 候補與取消報名
- 教材管理
- 問卷回饋
- 活動營運摘要與後台管理

`services/eventRegistrations.js` 是這一塊的重要核心，處理名額、候補、duplicate block 與人數重算。

### 4. 考試與題庫模組

對應檔案：

- `routes/exams.js`
- `routes/member-exams.js`
- `routes/question-bank.js`
- `services/examGeneration.js`
- `services/examGrading.js`
- `services/examAccess.js`
- `models/Exam.js`
- `models/Question.js`
- `models/ExamAttempt.js`
- `models/ExamAccess.js`

功能包含：

- 管理端建立考試與題目
- 題庫匯入/維護
- 會員開考、續考、自動儲存、交卷
- 成績計算與冷卻期
- 特定會員授權與付費存取
- CSV 匯出與統計

這個子系統已經相對獨立，且有正式規格文件：

- `docs/exam-system/SPEC.md`
- `docs/exam-system/API.md`

### 5. 證書與驗證模組

對應檔案：

- `routes/admin-certificates.js`
- `routes/admin-certificate-types.js`
- `services/examCertificates.js`
- `models/Certificate.js`
- `models/CertificateType.js`
- `models/CourseAttendance.js`
- `public/admin/certificates.html`
- `public/admin/certificate-types.html`
- `public/verify-certificate.html`

功能包含：

- 考試型證書與課程型證書
- 證書類型管理
- PDF 證書即時產生
- 公開證書驗證
- 證書撤銷/恢復

公開驗證 API 是 `GET /api/certificates/verify/:certificateNumber`，直接在 `server.js` 註冊，刻意不走一般 auth middleware。

## 前端結構

這個專案前端屬於「server-hosted static pages + client-side API calls」模式。

主要入口：

- `public/index.html`：官網首頁
- `public/admin.html`：管理後台
- `public/member/index.html`：會員專區
- `public/exam.html`：獨立考試頁

特性：

- 無 bundler
- 無 SPA framework build pipeline
- 以 CDN 載入 Tailwind / Alpine / Chart.js / Swiper
- `public/components/*.js` 為直接掛載使用的腳本

維護時要注意：UI 狀態與 API 流程常集中在大型 HTML 內，變更成本偏高。

## 啟動方式

### 本機開發

1. 安裝依賴

```bash
npm install
```

2. 準備 `.env`

至少應設定：

```env
MONGO_URI=mongodb://localhost:27017/actc_website
JWT_SECRET=your-secret
PORT=5001
HOST=0.0.0.0
```

3. 啟動 MongoDB

4. 啟動應用

```bash
npm start
```

或

```bash
npm run dev
```

### Docker / 正式部署

專案提供：

- `Dockerfile`
- `docker-compose.yml`
- `render.yaml`

部署時會依賴：

- MongoDB
- uploads volume
- 字型與證書圖片資源
- `SITE_URL`
- 郵件相關環境變數

## 重要啟動與資料庫行為

`lib/bootstrapDb.js` 會在每次 Mongo 連上後執行，內容包含：

- 建立預設 `admin/admin`
- 修補 legacy user 欄位
- 空庫時 seed news/events/working groups
- 補 partner corporate members
- 修正活動報名索引
- 修正 certificate `attempt_1` index

這些動作具 idempotent 意圖，但仍然是高影響啟動邏輯，改動前需要非常小心。

## 安全與授權模型

### Mongo ready gate

所有 `/api` 都先經過 `middleware/mongoReady.js`。如果 Mongo 未連上，直接回 503 與明確訊息，不讓 request 落進各 route 的隨機錯誤。

### Admin auth

`middleware/adminAuth.js` 提供：

- `auth`
- `adminAuth`

`adminAuth` 會檢查：

- JWT 有效
- user 存在且 `isActive`
- `emailVerified === true`
- `role === 'admin'`

### Member auth

`middleware/memberAuth.js` 提供：

- `verifiedAuth`
- `contributorAuth`

`verifiedAuth` 用於會員已登入且信箱已驗證的功能。  
`contributorAuth` 實際上限制為 admin，供會員專區裡的內容管理 API 使用。

### Cron auth

`routes/cron.js` 使用獨立驗證：

- `X-Cron-Secret`
- `CRON_ALLOWED_IPS`

兩者都要通過。

## 風險點與維護注意事項

### 1. 預設管理員與自動 seed 風險高

系統會自動建立 `admin/admin`，也會在空集合時自動寫入示例資料。這對開發方便，但若環境初始化流程不嚴謹，容易把測試行為帶進正式環境。

### 2. 沒有正式測試框架與 lint 流程

`package.json` 沒有 test script、lint script 或 build script。代表：

- 回歸風險高
- 重構成本高
- 品質主要依賴人工驗證與 ad-hoc scripts

### 3. 大型靜態頁面可維護性偏弱

`public/admin.html` 與 `public/member/index.html` 都是大型頁面，UI、資料載入、互動狀態高度耦合。沒有 bundler 與 component boundary，後續功能擴增時容易失控。

### 4. 文件與實作存在漂移可能

README、技術規格、AGENTS 指南都提供了不少上下文，但內容不一定完全同步。實際修改前應優先以程式碼現況為準。

### 5. 考試模型存在雙向關聯同步風險

題目與考試目前同時使用：

- `Question.examIds`
- `Exam.questionRefs`

兩邊都在被路由與 service 使用。任何批次更新、刪除、clone、匯入流程若只更新其中一側，資料就可能失配。

### 6. Cron 依賴環境變數與內部自呼叫

`server.js` 內建 `setInterval()` 每 5 分鐘呼叫一次 `/api/cron/expired-attempts`。這表示 cron 同時有：

- 應用內自觸發
- 對外 API 驗證機制

若 `CRON_SECRET`、proxy IP、allowlist 設定不一致，功能可能 silently degrade，只在 log 中出現 warning。

### 7. 郵件功能可能 no-op

`services/email.js` 在未配置 SMTP/Resend 時會回傳 mock/no-op 結果並打 warning。從使用者流程看起來可能像成功，但實際沒寄出。

### 8. PDF/上傳檔依賴檔案系統

證書功能依賴：

- `fonts/NotoSansCJKtc-Regular.ttf`
- `fonts/NotoSansCJKtc-Bold.otf`
- `public/assets/images/EricMaoSign.png`
- `uploads/`

部署時若 volume、字型或靜態資源漏掛，功能會直接故障。

### 9. API response shape 不一致

舊 API 常回 `{ message }`，考試/證書較常回 `{ data, error }`。客戶端多半已依賴現況，不適合未經盤點就統一格式。

## 建議閱讀順序

第一次接手時，建議閱讀順序如下：

1. `server.js`
2. `lib/bootstrapDb.js`
3. `middleware/adminAuth.js` / `middleware/memberAuth.js`
4. `routes/auth.js`
5. `routes/events.js` + `routes/member-events.js` + `services/eventRegistrations.js`
6. `routes/exams.js` + `routes/member-exams.js`
7. `services/examCertificates.js`
8. `models/Exam.js`、`models/Question.js`、`models/Certificate.js`
9. `public/admin.html`、`public/member/index.html`
10. `docs/exam-system/SPEC.md`

## 結論

這個專案已經不只是單純官網，而是一個把 CMS、會員系統、活動營運與考試證書平台揉在一起的單體系統。它的優勢是部署簡單、功能集中；代價則是：

- 前後端耦合高
- 啟動 bootstrap 影響面大
- 測試與模組邊界偏弱
- 後續變更需要特別注意資料一致性與既有前端行為

若未來持續演進，最值得優先投資的方向會是：

- 建立最基本的測試與 smoke test 流程
- 收斂大型前端頁面
- 明確化考試/證書子系統邊界
- 降低 bootstrap 與自動 seed 的環境風險
