# 測試報告：個人資料必填欄位驗證

## 基本資訊

- **測試日期**：2026-05-20
- **測試模型**：MiniMax M2.5 Free (opencode)
- **測試環境**：http://localhost:5001
- **測試工具**：Playwright (Chromium)

---

## 測試個案結果

### TC-01：註冊表單 — 未填姓名

| 項目 | 內容 |
|------|------|
| **狀態** | ✅ PASS |
| **預期行為** | 點擊「註冊」按鈕後，頁面顯示「請填寫姓名。」 |
| **實際行為** | 頁面顯示「請填寫姓名。」 |
| **截圖** | `/screenshots/tc01-missing-fullname.png` |

---

### TC-02：註冊表單 — 未填電話

| 項目 | 內容 |
|------|------|
| **狀態** | ✅ PASS |
| **預期行為** | 點擊「註冊」按鈕後，頁面顯示「請填寫電話。」 |
| **實際行為** | 頁面顯示「請填寫電話。」 |
| **截圖** | `/screenshots/tc02-missing-phone.png` |

---

### TC-03：API 層 — POST /api/auth/register 缺 phone

| 項目 | 內容 |
|------|------|
| **狀態** | ✅ PASS |
| **預期行為** | HTTP 400，response.message === '請填寫電話' |
| **實際行為** | HTTP 400, message: "請填寫電話" |
| **截圖** | `/screenshots/tc03-api-missing-phone.png` |

**測試請求**：
```json
POST /api/auth/register
{
  "username": "apitestqa",
  "email": "apitestqa@example.com",
  "password": "pass1234",
  "fullName": "API測試"
}
```

---

### TC-04：API 層 — POST /api/auth/register 缺 fullName

| 項目 | 內容 |
|------|------|
| **狀態** | ✅ PASS |
| **預期行為** | HTTP 400，response.message === '請填寫姓名' |
| **實際行為** | HTTP 400, message: "請填寫姓名" |
| **截圖** | 無（API 測試） |

**測試請求**：
```json
POST /api/auth/register
{
  "username": "apitestqa2",
  "email": "apitestqa2@example.com",
  "password": "pass1234",
  "phone": "0912345678"
}
```

---

## 總結

| 項目 | 數量 |
|------|------|
| 總測試數 | 4 |
| 通過 (PASS) | 4 |
| 失敗 (FAIL) | 0 |
| 略過 (SKIP) | 0 |

**結果**：✅ 所有測試個案均通過

**驗證結論**：
1. 前端表單驗證（UI 層）：當使用者未填寫姓名或電話時，點擊註冊會顯示相應的錯誤訊息
2. 後端 API 驗證：當 API 請求缺少 phone 或 fullName 欄位時，返回 HTTP 400 並提供正確的錯誤訊息

**測試腳本位置**：`/scripts/test-profile-required-fields.js`