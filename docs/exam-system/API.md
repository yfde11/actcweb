# ACTC 考試系統 API 參考文件

> 版本：1.0.0  
> 更新日期：2026-05-02

---

## 目錄

1. [驗證](#1-驗證)
2. [管理端 API](#2-管理端-api)
3. [會員端 API](#3-會員端-api)
4. [定時任務 API](#4-定時任務-api)
5. [公開 API](#5-公開-api)

---

## 1. 驗證

### 1.1 管理員登入

**POST** `/api/auth/login`

```json
{
    "username": "admin",
    "password": "your-password",
    "forAdmin": true
}
```

**回應：**
```json
{
    "message": "登入成功",
    "token": "eyJhbGci...",
    "user": {
        "id": "...",
        "username": "admin",
        "role": "admin"
    }
}
```

### 1.2 會員登入

**POST** `/api/auth/login`

```json
{
    "username": "member",
    "password": "your-password"
}
```

**回應：**
```json
{
    "message": "登入成功",
    "token": "eyJhbGci...",
    "user": {
        "id": "...",
        "username": "member",
        "role": "user",
        "membershipStatus": "approved"
    }
}
```

---

## 2. 管理端 API

**Header：** `Authorization: Bearer <admin_token>`

### 2.1 取得考試列表

**GET** `/api/exams`

**查詢參數：**
| 參數 | 類型 | 預設 | 說明 |
|------|------|------|------|
| `page` | number | 1 | 頁碼 |
| `limit` | number | 20 | 每頁數量 |
| `status` | string | - | 篩選狀態 |
| `search` | string | - | 關鍵字搜尋 |

**回應：**
```json
{
    "data": [
        {
            "_id": "...",
            "title": "Test Exam",
            "status": "active",
            "questionCount": 10,
            "totalPoints": 100,
            "createdAt": "2026-05-02T00:00:00Z"
        }
    ],
    "pagination": {
        "total": 1,
        "totalPages": 1,
        "page": 1,
        "limit": 20
    }
}
```

### 2.2 建立考試

**POST** `/api/exams`

**請求體：**
```json
{
    "title": "Test Exam",
    "description": "This is a test exam",
    "examType": "quiz",
    "timeLimit": 30,
    "passingScore": 70,
    "maxAttempts": 2,
    "cooldownPeriod": 15,
    "certificateEnabled": true,
    "difficultyRatio": {
        "easy": 20,
        "medium": 60,
        "hard": 20
    }
}
```

**回應：**
```json
{
    "data": {
        "_id": "...",
        "title": "Test Exam",
        "status": "draft",
        "createdAt": "2026-05-02T00:00:00Z"
    }
}
```

### 2.3 取得考試詳情

**GET** `/api/exams/:id`

**回應：**
```json
{
    "data": {
        "_id": "...",
        "title": "Test Exam",
        "status": "active",
        "questions": [...]
    }
}
```

### 2.4 變更考試狀態

**PATCH** `/api/exams/:id/status`

**請求體：**
```json
{
    "status": "active"
}
```

**有效轉換：**
- `draft` → `published`
- `published` → `active` 或 `draft`
- `active` → `closed`

### 2.5 新增題目

**POST** `/api/exams/:id/questions`

**單選題：**
```json
{
    "type": "multiple_choice",
    "content": "What is 2+2?",
    "options": [
        {"text": "3", "label": "A"},
        {"text": "4", "label": "B"},
        {"text": "5", "label": "C"}
    ],
    "correctOptionIndex": 1,
    "points": 10,
    "difficulty": "easy"
}
```

**判斷題：**
```json
{
    "type": "true_false",
    "content": "The earth is flat.",
    "correctBoolean": false,
    "points": 5,
    "difficulty": "easy"
}
```

**填空題：**
```json
{
    "type": "fill_in_blank",
    "content": "The capital of France is _____.",
    "correctAnswers": ["Paris", "paris"],
    "points": 5,
    "difficulty": "easy"
}
```

**回應：**
```json
{
    "data": {
        "_id": "...",
        "questionNumber": 1,
        "type": "multiple_choice",
        "content": "What is 2+2?"
    }
}
```

### 2.6 批量匯入題目

**POST** `/api/exams/:id/import`

**請求體（JSON）：**
```json
{
    "questions": [
        {
            "type": "multiple_choice",
            "content": "Question 1?",
            "options": [
                {"text": "A", "label": "A"},
                {"text": "B", "label": "B"}
            ],
            "correctOptionIndex": 0,
            "difficulty": "easy"
        }
    ]
}
```

**請求體（CSV）：**
```csv
type,content,optionA,optionB,optionC,optionD,correctOption,difficulty
multiple_choice,Question 1?,A,B,C,D,0,easy
```

### 2.7 匯出題目

**GET** `/api/exams/:id/export`

**回應：** CSV 格式檔案下載

### 2.8 取得作答記錄

**GET** `/api/exams/:id/attempts`

**查詢參數：**
| 參數 | 類型 | 預設 | 說明 |
|------|------|------|------|
| `page` | number | 1 | 頁碼 |
| `limit` | number | 20 | 每頁數量 |
| `status` | string | - | 篩選狀態 |

### 2.9 取得統計資料

**GET** `/api/exams/:id/statistics`

**回應：**
```json
{
    "data": {
        "totalAttempts": 10,
        "passedCount": 8,
        "failedCount": 2,
        "averageScore": 75,
        "passRate": 80,
        "scoreDistribution": {...},
        "difficultyAnalysis": {...}
    }
}
```

### 2.10 預覽考試

**GET** `/api/exams/:id/preview`

**回應：** 隨機抽題後的考試內容（不含正確答案）

---

## 3. 會員端 API

**Header：** `Authorization: Bearer <member_token>`

### 3.1 取得可參加的考試

**GET** `/api/member/exams`

**回應：**
```json
{
    "data": [
        {
            "_id": "...",
            "title": "Test Exam",
            "timeLimit": 30,
            "passingScore": 70,
            "certificateEnabled": true,
            "userAttempts": [],
            "canStart": {
                "allowed": true
            }
        }
    ]
}
```

### 3.2 開始考試

**POST** `/api/member/exams/:examId/start`

**回應：**
```json
{
    "data": {
        "attemptId": "...",
        "attemptNumber": 1,
        "startedAt": "2026-05-02T00:00:00Z",
        "expiresAt": "2026-05-02T00:30:00Z",
        "questions": [
            {
                "questionId": "...",
                "questionNumber": 1,
                "type": "multiple_choice",
                "content": "What is 2+2?",
                "options": [...]
            }
        ]
    }
}
```

### 3.3 繼續作答

**GET** `/api/member/exams/:examId/resume`

**回應：**
```json
{
    "data": {
        "attemptId": "...",
        "status": "in_progress",
        "expiresAt": "...",
        "questions": [...],
        "answers": [...]
    }
}
```

### 3.4 提交考卷

**POST** `/api/member/exams/:examId/submit`

**請求體：**
```json
{
    "attemptId": "...",
    "answers": [
        {"questionId": "...", "questionNumber": 1, "answer": 1},
        {"questionId": "...", "questionNumber": 2, "answer": false},
        {"questionId": "...", "questionNumber": 3, "answer": "Paris"}
    ],
    "timeSpent": 300,
    "visibilityChangeCount": 0
}
```

**回應：**
```json
{
    "data": {
        "attemptId": "...",
        "status": "graded",
        "score": 100,
        "passed": true,
        "cheatingDetected": false,
        "gradingDetails": {
            "totalPoints": 20,
            "earnedPoints": 20,
            "correctCount": 3,
            "incorrectCount": 0
        },
        "certificateNumber": "ACTC-EXAM-2026-000001",
        "certificateIssued": true
    }
}
```

### 3.5 取得我的證書

**GET** `/api/member/exams/certificates`

**回應：**
```json
{
    "data": [
        {
            "certificateNumber": "ACTC-EXAM-2026-000001",
            "exam": {
                "title": "Test Exam"
            },
            "score": 100,
            "issuedAt": "2026-05-02T00:00:00Z",
            "expiresAt": "2028-05-02T00:00:00Z"
        }
    ]
}
```

### 3.6 下載證書 PDF

**GET** `/api/member/exams/certificate/:certNumber`

**回應：** PDF 檔案（Content-Type: application/pdf）

---

## 4. 定時任務 API

**Header：** `X-Cron-Secret: <cron_secret>`

### 4.1 自動過期作答

**POST** `/api/cron/auto-expire`

自動將過期的 `in_progress`作答標記為 `auto_submitted`。

### 4.2 清理過期資料

**POST** `/api/cron/cleanup`

清理過期的暫存資料。

---

## 5. 公開 API

### 5.1 驗證證書

**GET** `/api/certificates/verify/:certificateNumber`

**回應：**
```json
{
    "data": {
        "certificateNumber": "ACT

C-EXAM-2026-000001",
        "issuedAt": "2026-05-02T00:00:00Z",
        "expiresAt": "2028-05-02T00:00:00Z",
        "exam": {
            "_id": "...",
            "title": "Test Exam"
        },
        "user": {
            "username": "member",
            "fullName": "Test Member"
        }
    }
}
```

---

## 錯誤回應格式

```json
{
    // 一般錯誤
    "message": "錯誤訊息"

    // 結構化錯誤
    "error": {
        "code": "VALIDATION_ERROR",
        "message": "欄位驗證失敗",
        "details": {
            "field": "錯誤說明"
        }
    }
}
```