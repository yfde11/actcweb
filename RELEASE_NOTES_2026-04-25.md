# ACTC 動態網站 — Release Notes（2026-04-25）

發行日期：**2026-04-25**  
套件名稱：`actc-dynamic-website`

本次更新聚焦於 EventOps MVP 的完整營運流程、會員中心體驗與報名資料正確性。

---

## 主要更新

### 1) 會員中心與管理者體驗

- 調整 `admin` 登入流程：可留在會員中心 `/member` 使用一般會員功能，不再強制導向後台。
- 新增「前往管理後台」一鍵入口（僅 `admin` 顯示），可快速切至 `/admin`。

### 2) 我的活動中心功能強化

- 「查看活動」改為彈窗（popup）呈現詳細活動內容，不再跳轉首頁。
- 詳情彈窗可查看活動類型、時間區間、地點、講師、費用、連結、封面與附件、標籤、名額與報名資訊。
- 新增/完善付款資訊上傳：可填付款金額、轉出帳戶後五碼、備註，並支援收據圖片上傳。
- 放寬付款資訊提交流程：報名狀態為 `registered` / `pending_approval` / `waitlisted` 可上傳，且可重複更新。

### 3) 後台報名名單與介面優化

- 報名名單新增「付款資訊」顯示欄位，可快速辨識是否已提供付款相關資料。
- 依需求移除報名名單「應付金額」欄位。
- 後台會員列表移除過長 ID 欄位，改善表格可讀性。
- 活動資料管理彈窗調整「上傳送出」按鈕位置與顏色，提高可見性。

### 4) 報名資料與統計修正

- 修正後台報名名單姓名/Email 顯示異常，並相容舊欄位資料。
- 修正活動總覽與首頁活動卡的已報名統計邏輯，使數字反映實際報名人數（不再僅依繳費狀態）。
- 修正活動編輯時 `End date must be after or equal to start date` 的誤判問題。

### 5) 佈署與上線

- 已完成遠端主機 `192.168.1.220` 多次部署與最新版本更新。
- 透過 Docker Compose 重建 `web` 容器並套用最新前後端變更。

---

## 影響範圍（重點檔案）

- 前端：`public/member/index.html`、`public/admin-events.html`、`public/admin.html`、`public/index.html`
- 後端路由：`routes/member-events.js`、`routes/events.js`
- 模型與服務：`models/EventRegistration.js`、`services/eventRegistrations.js`
- 相關擴充：`models/EventMaterial.js`、`models/EventSurveyResponse.js`、`models/NotificationLog.js`、`services/eventNotifications.js`

---

© 2026 ACTC 國際資訊安全人才培育與推廣協會
