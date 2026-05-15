# ACTC 考試系統

> 快速開始指南

---

## 這是什麼？

ACTC 考試系統是一個完整的線上考試解決方案，提供：

- 題目管理（單選題、判斷題、填空題）
- 分層隨機抽題
- 自動評分
- PDF 證書生成
- 作弊檢測

## 快速開始

### 1. 安裝依賴

```bash
npm install
```

### 2. 設定環境變數

建立 `.env` 檔案：

```bash
JWT_SECRET=your-secret-key
MONGO_URI=mongodb+srv://...
CRON_SECRET=cron-secret
CRON_ALLOWED_IPS=127.0.0.1
DOMAIN=localhost:5001
```

### 3. 啟動服務

```bash
npm start
```

服務運行於 `http://localhost:5001`

---

## 使用流程

### 管理端（/admin）

1. 用管理員帳號登入
2. 建立考試
3. 新增題目
4. 發布考試（draft → published → active）
5. 查看統計與作答記錄

### 會員端（/member）

1. 用會員帳號登入
2. 選擇考試
3. 開始作答
4. 提交並查看成績
5. 下載證書

---

## API 快速範例

### 建立考試

```bash
curl -X POST http://localhost:5001/api/exams \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My Exam",
    "description": "Test exam",
    "timeLimit": 30,
    "passingScore": 70
  }'
```

### 開始作答

```bash
curl -X POST http://localhost:5001/api/member/exams/$EXAM_ID/start \
  -H "Authorization: Bearer $MEMBER_TOKEN"
```

### 提交考卷

```bash
curl -X POST http://localhost:5001/api/member/exams/$EXAM_ID/submit \
  -H "Authorization: Bearer $MEMBER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "attemptId": "$ATTEMPT_ID",
    "answers": [
      {"questionId": "...", "questionNumber": 1, "answer": 1}
    ],
    "timeSpent": 300
  }'
```

---

## 文件

- [系統規格書](SPEC.md) - 完整技術規格
- [API 參考](API.md) - API 端點文件