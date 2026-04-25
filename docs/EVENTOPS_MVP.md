# EVENTOPS MVP

本文件說明 ACTC 網站 EventOps MVP 的資料模型、API、權限規則與測試流程。  
MVP 目標：在不重寫既有系統的前提下，補齊活動建立、報名、人工付款審核、教材下載、問卷回饋與後台營運管理。

## 1. 新增與擴充模型

## 1.1 Event（擴充）
- 報名/付款：`registrationMode`, `paymentMode`, `waitlistCapacity`, `registrationStartAt`, `registrationEndAt`
- 活動設定：`surveyEnabled`, `certificateEnabled`
- 存取策略：`eventAccessPolicy.materialsAccess`, `eventAccessPolicy.recordingAccess`
- 價格擴充：`price.memberPrice`, `price.earlyBirdPrice`, `price.earlyBirdEndAt`, `price.groupPrice`
- 付款資訊：`paymentInstructions.*`
- 活動後資訊：`postEvent.*`

## 1.2 EventRegistration（擴充）
- 參與者資料：`user`, `participantName`, `participantEmail`, `participantPhone`, `organization`, `title`
- 狀態：`status`, `paymentStatus`, `attendanceStatus`
- 票種與金額：`ticketType`, `amountDue`, `currency`
- 付款憑證：`paymentProof.*`
- 其他：`checkedInAt`, `cancelledAt`
- 索引：
  - unique：`event + participantEmail`（相容既有資料）
  - index：`event + status`
  - index：`participantEmail`

## 1.3 EventMaterial（新增）
- 活動教材與資產，支援 `accessLevel` 與檔案/外部連結
- 支援 `isActive`（soft delete）、`availableFrom/availableUntil`

## 1.4 EventSurveyResponse（新增）
- 活動滿意度回饋與 NPS
- unique（partial）：`event + user`

## 1.5 NotificationLog（新增）
- 記錄通知種類、收件者、寄送狀態（sent/failed/skipped）

## 2. 新增 API

## 2.1 會員端（`/api/member/events`）
- `POST /:eventId/register`：會員報名
- `GET /my-registrations`：我的活動中心資料
- `POST /:eventId/cancel`：取消報名
- `POST /:eventId/payment-proof`：上傳付款後五碼與憑證
- `GET /:eventId/materials`：取可見教材列表
- `GET /materials/:materialId/download`：下載教材（含權限與路徑檢查）
- `POST /:eventId/survey`：提交活動問卷

## 2.2 管理端（`/api/events`）
- `GET /:eventId/registrations`：名單與 summary（含 status/payment/attendance/search）
- `PATCH /registrations/:registrationId`：更新報名/付款/出席狀態
- `POST /:eventId/materials`：上傳教材（含 accessLevel）
- `GET /:eventId/materials/admin`：管理端教材列表
- `DELETE /materials/:materialId`：教材 soft delete
- `POST /:eventId/notify`：手動通知發送
- `GET /:eventId/survey-results`：問卷統計與明細
- `GET /:eventId/operation-summary`：活動營運總覽

## 3. 權限規則

- 管理端 API 全數要求 `adminAuth`
- 會員端 API 全數要求 JWT（`verifiedAuth`）
- 會員僅可操作自己報名資料（以登入帳號 email 對應）
- 教材下載權限依 `EventMaterial.accessLevel`：
  - `public`
  - `login_required`
  - `registered_only`
  - `paid_only`
  - `attended_only`
- 下載實檔前，會驗證路徑必須位於 `uploads/event-materials` 下，避免 path traversal

## 4. Email 通知

透過 `services/eventNotifications.js` + `services/email.js`：
- `registration_success`
- `payment_pending`
- `payment_confirmed`
- `payment_rejected`
- `event_reminder`
- `post_event_survey`

特色：
- 產生 HTML + text 內容
- 網址採 `SITE_URL`，fallback `http://localhost:5001`
- SMTP 未設定時不使主流程失敗，改為 `skipped` 並記錄 warning + `NotificationLog`

## 5. 使用流程（MVP）

1. 管理員建立免費或付費活動（付費使用 `manual_bank_transfer`）
2. 會員於活動頁報名
3. 付費活動會員上傳後五碼/憑證（`payment_submitted`）
4. 管理員人工審核 `paid` 或 `payment_rejected`
5. 管理員上傳教材並設定存取層級
6. 會員依權限下載教材
7. 管理員標記出席
8. 會員填寫問卷
9. 管理員查看問卷結果與營運總覽

## 6. 測試流程

1. `npm install`
2. `npm run dev`
3. 建立免費活動
4. 建立付費活動（`price.amount = 10800`、`paymentMode = manual_bank_transfer`、填銀行資訊）
5. 會員登入
6. 報名免費活動
7. 報名付費活動
8. 上傳付款後五碼
9. 管理員確認付款
10. 管理員上傳 `paid_only` 教材
11. 會員下載教材
12. 管理員標記出席
13. 會員填寫問卷
14. 管理員查看問卷結果與 operation summary

## 7. Phase 2 建議

- QR Code 報到
- 串接正式金流（綠界/藍新/信用卡）
- 證書 PDF 自動產生與發送
- LINE OA 通知
- 折扣碼與早鳥自動計價
- 企業團報與名單匯入
