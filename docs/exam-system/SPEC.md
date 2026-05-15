# ACTC 考試系統技術規格書

> 版本：1.0.0  
> 更新日期：2026-05-02  
> 狀態：已通過 QA 測試

---

## 1. 系統概述

### 1.1 用途

ACTC 考試系統提供完整的線上考試功能，包括題目管理、作答評分、證書頒發等核心功能，適用於教育訓練機構的線上測驗需求。

### 1.2 技術堆疊

| 層 | 技術 |
|---|------|
| 運行環境 | Node.js 18+ |
| Web 框架 | Express.js |
| 資料庫 | MongoDB (Mongoose ODM) |
| PDF 生成 | PDFKit |
| 前端框架 | Alpine.js + Tailwind CSS (CDN) |
| 部署平台 | Render (Free Tier) |

### 1.3 系統架構圖

```
┌─────────────────────────────────────────────────────────────┐
│                        Render.com                         │
│  ┌─────────────────────────────────────────────────┐     │
│  │              Node.js + Express                   │     │
│  │  ┌───────────┐  ┌────────────┐  ┌──────────┐   │     │
│  │  │ /api/     │  │ /api/      │  │ /api/    │   │     │
│  │  │ exams.js  │  │ member    │  │ cron.js  │   │     │
│  │  │ (admin)   │  │-exams.js  │  │          │   │     │
│  │  └────┬────┘  └─────┬──────┘  └────┬─────┘   │     │
│  │       │            │              │          │         │     │
│  │  ┌────┴──────────┴───────────┴────┐    │     │
│  │  │     Services Layer            │    │     │
│  │  │ examGrading.js              │    │     │
│  │  │ examCertificates.js         │    │     │
│  │  │ examNotifications.js     │    │     │
│  │  └───────────┬───────────────┬────┘    │     │
│  └─────────────┼─────────────┼─────────────┘     │
│              │             │                   │
│        ┌─────┴─────┐ ┌────┴──────┐          │
│        │  MongoDB  │ │  Static   │          │
│        │  Atlas    │ │  Files   │          │
│        └──────────┘ └──────────┘          │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 資料模型

### 2.1 Exam（考試）

```javascript
const examSchema = new mongoose.Schema({
    // 基本資訊
    title: { type: String, required: true, maxlength: 200 },
    description: { type: String, required: true, maxlength: 2000 },
    shortDescription: { type: String, maxlength: 200 },

    // 狀態管理
    status: {
        type: String,
        enum: ['draft', 'published', 'active', 'closed', 'archived', 'deleted'],
        default: 'draft'
    },
    examType: { type: String, enum: ['quiz', 'certification'], default: 'quiz' },

    // 考試規則
    timeLimit: { type: Number, min: 0, max: 480, default: 0 },      // 分鐘，0=無限制
    passingScore: { type: Number, min: 0, max: 100, default: 70 },
    maxAttempts: { type: Number, min: 0, max: 10, default: 1 },
    cooldownPeriod: { type: Number, min: 0, max: 365, default: 15 }, // 天數
    questionsPerAttempt: { type: Number, min: 1 },

    // 隨機抽題配置
    difficultyRatio: {
        easy: { type: Number, min: 0, max: 100, default: 20 },
        medium: { type: Number, min: 0, max: 100, default: 60 },
        hard: { type: Number, min: 0, max: 100, default: 20 }
    },

    // 時間範圍
    startDate: { type: Date },
    endDate: { type: Date },

    // 隨機配置
    shuffleQuestions: { type: Boolean, default: false },
    shuffleOptions: { type: Boolean, default: false },

    // 答案顯示
    showCorrectAnswers: {
        type: String,
        enum: ['immediately', 'after_submit', 'never'],
        default: 'after_submit'
    },

    // 證書設定
    certificateEnabled: { type: Boolean, default: false },
    certificateTemplate: {
        title: String,
        issuer: { type: String, default: 'ACTC' },
        validityPeriod: { type: Number, default: 24 }, // 月數
        language: { type: String, default: 'zh-TW' },
        customDesign: {
            logoPath: String,
            borderColor: String,
            footerText: String
        }
    },

    // 權限設定
    allowedMembers: {
        type: String,
        enum: ['all_approved', 'specific'],
        default: 'all_approved'
    },
    allowedMemberIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // 統計
    questionCount: { type: Number, default: 0 },
    totalPoints: { type: Number, default: 0 },
    tags: [String],

    // 建立者
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

// 索引
examSchema.index({ status: 1, startDate: 1, endDate: 1 });
examSchema.index({ createdBy: 1 });
```

### 2.2 Question（題目）

```javascript
const questionSchema = new mongoose.Schema({
    exam: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Exam',
        required: true,
        index: true
    },
    questionNumber: { type: Number, required: true },

    // 題型
    type: {
        type: String,
        enum: ['multiple_choice', 'true_false', 'fill_in_blank'],
        required: true
    },

    // 難度
    difficulty: {
        type: String,
        enum: ['easy', 'medium', 'hard'],
        required: true,
        default: 'medium',
        index: true
    },

    // 題目內容
    content: { type: String, required: true, maxlength: 2000 },

    // 選項（單選題用）
    options: [{
        text: { type: String, required: true, maxlength: 500 },
        label: { type: String, required: true }  // A, B, C, D
    }],

    // 正確答案（單選題）
    correctOptionIndex: { type: Number, min: 0, max: 5 },

    // 正確答案（判斷題）
    correctBoolean: { type: Boolean },

    // 正確答案（填空題）
    correctAnswers: [String],
    acceptableAnswers: [String],  // 可接受的答案（自動轉小寫）

    // 計分
    points: { type: Number, min: 1, max: 100, default: 1 },

    // 說明
    explanation: { type: String, maxlength: 1000 }
}, { timestamps: true });

// 索引
questionSchema.index({ exam: 1, questionNumber: 1 }, { unique: true });
questionSchema.index({ exam: 1, difficulty: 1 });
```

**題型說明：**

| 題型 | 欄位 | 範例 |
|------|------|------|
| `multiple_choice` | `options` + `correctOptionIndex` | 4 個選項，正確答案是 index 1 |
| `true_false` | `correctBoolean` | true 或 false |
| `fill_in_blank` | `correctAnswers` + `acceptableAnswers` | ["Paris", "paris"] |

### 2.3 ExamAttempt（作答記錄）

```javascript
const attemptSchema = new mongoose.Schema({
    exam: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Exam',
        required: true,
        index: true
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    attemptNumber: { type: Number, required: true },

    // 狀態
    status: {
        type: String,
        enum: ['in_progress', 'graded', 'auto_submitted', 'auto_submitted_cheating'],
        default: 'in_progress'
    },

    // 時間
    startedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date },
    submittedAt: { type: Date },

    // 作弊檢測
    timeSpent: { type: Number, default: 0 },  // 秒
    visibilityChangeCount: { type: Number, default: 0 },

    // 答案快照（儲存題目內容）
    questionSnapshot: [{
        questionId: mongoose.Schema.Types.ObjectId,
        questionNumber: Number,
        type: String,
        content: String,
        correctAnswer: mongoose.Schema.Types.Mixed,
        points: Number,
        difficulty: String
    }],

    // 玩家答案
    answers: [{
        questionId: mongoose.Schema.Types.ObjectId,
        questionNumber: { type: Number, required: true },
        answer: mongoose.Schema.Types.Mixed,
        isCorrect: Boolean,
        pointsEarned: Number
    }],

    // 成績
    score: { type: Number },
    passed: { type: Boolean },
    cheatingDetected: { type: Boolean, default: false },

    // 評分詳情
    gradingDetails: {
        totalPoints: Number,
        earnedPoints: Number,
        correctCount: Number,
        incorrectCount: Number,
        unansweredCount: Number
    }
}, { timestamps: true });

// 索引
attemptSchema.index({ exam: 1, user: 1 });
attemptSchema.index({ user: 1, status: 1 });
```

### 2.4 Certificate（證書）

```javascript
const certificateSchema = new mongoose.Schema({
    certificateNumber: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    exam: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Exam',
        required: true
    },
    attempt: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ExamAttempt',
        required: true
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    score: { type: Number, required: true },
    passed: { type: Boolean, required: true },

    // 有效期
    issuedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date },

    // 撤銷
    isRevoked: { type: Boolean, default: false },
    revokedAt: { type: Date },
    revocationReason: String
}, { timestamps: true });
```

### 2.5 Counter（流水號）

用於生成證書編號：

```javascript
const counterSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 }
});
```

---

## 3. API 端點

### 3.1 管理端 API（/api/exams）

**認證：** `Authorization: Bearer <admin_token>`

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/exams` | 取得考試列表（分頁） |
| POST | `/api/exams` | 建立新考試 |
| GET | `/api/exams/:id` | 取得考試詳情（含題目） |
| PUT | `/api/exams/:id` | 更新考試（僅草稿狀態） |
| DELETE | `/api/exams/:id` | 刪除考試 |
| PATCH | `/api/exams/:id/status` | 變更考試狀態 |
| GET | `/api/exams/:id/preview` | 預覽考試（隨機抽題） |
| POST | `/api/exams/:id/questions` | 新增題目 |
| PUT | `/api/exams/:id/questions/:qid` | 更新題目 |
| DELETE | `/api/exams/:id/questions/:qid` | 刪除題目 |
| PUT | `/api/exams/:id/reorder` | 重新排序題目 |
| POST | `/api/exams/:id/import` | 批量匯入題目（CSV/JSON） |
| GET | `/api/exams/:id/export` | 匯出題目（CSV） |
| GET | `/api/exams/:id/attempts` | 取得作答記錄 |
| GET | `/api/exams/:id/statistics` | 取得統計資料 |

**狀態轉換：**
```
draft → published → active → closed → archived
```

### 3.2 會員端 API（/api/member/exams）

**認證：** `Authorization: Bearer <member_token>`

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/member/exams` | 取得可參加的考試列表 |
| POST | `/api/member/exams/:examId/start` | 開始考試（隨機抽題） |
| GET | `/api/member/exams/:examId/attempt/:attemptId` | 繼續作答 |
| POST | `/api/member/exams/:examId/submit` | 提交考卷 |
| GET | `/api/member/exams/certificates` | 取得我的證書 |
| GET | `/api/member/exams/certificate/:certNumber` | 下載證書 PDF |

### 3.3 定時任務 API（/api/cron）

**認證：** `X-Cron-Secret` + IP 白名單

| 方法 | 路徑 | 說明 |
|------|------|------|
| POST | `/api/cron/auto-expire` | 自動過期過期中的作答 |
| POST | `/api/cron/cleanup` | 清理過期資料 |

---

## 4. 功能說明

### 4.1 分層隨機抽題

根據 `difficultyRatio` 配置，從題庫中隨機抽取指定數量的題目：

```
例如：questionsPerAttempt = 10, difficultyRatio = { easy: 20, medium: 60, hard: 20 }
→ 抽取 2題簡單 + 6題中等 + 2題困難
```

### 4.2 冷卻期機制

考試通過後，需等待冷卻期才能再次參加：

```javascript
if (lastAttempt && exam.cooldownPeriod > 0) {
    const cooldownEnd = new Date(lastAttempt.submittedAt);
    cooldownEnd.setDate(cooldownEnd.getDate() + exam.cooldownPeriod);
    // 現在 < cooldownEnd → 禁止參加
}
```

### 4.3 作弊檢測

使用兩個指標檢測作弊行為：

| 指標 | 閾值 | 處置 |
|------|------|------|
| `visibilityChangeCount` | > 10 | 標記為作弊 |
| `timeSpent` | < timeLimit * 20% | 標記為懷疑 |

被標記為作弊的作答：
- 狀態：`auto_submitted_cheating`
- 可能不頒發證書

### 4.4 自動評分

**單選題：**
```javascript
const isCorrect = answer === correctOptionIndex;
```

**判斷題：**
```javascript
const isCorrect = answer === correctBoolean;
```

**填空題：**
```javascript
const normalized = answer.toLowerCase().trim();
const isCorrect = correctAnswers.includes(normalized) ||
                 acceptableAnswers.includes(normalized);
```

### 4.5 證書生成

證書編號格式：`ACTC-EXAM-YYYY-NNNNNN`

使用 PDFKit 即時生成 PDF，搭配 NotoSansCJKtc 字體支援中文。

---

## 5. 部署

### 5.1 環境需求

| 項目 | 版本 |
|------|------|
| Node.js | 18+ |
| MongoDB | Atlas (512MB Free) |
| npm | 9+ |

### 5.2 環境變數

建立 `.env` 檔案：

```bash
# JWT Secret
JWT_SECRET=your-jwt-secret-key

# MongoDB
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>/<database>?retryWrites=true&w=majority

# Cron 安全
CRON_SECRET=your-cron-secret
CRON_ALLOWED_IPS=127.0.0.1

# Domain（用於證書驗證 URL）
DOMAIN=your-domain.com

# 環境
NODE_ENV=development
```

### 5.3 字體部署

Fonts 目錄需包含：
- `fonts/NotoSansCJKtc-Regular.ttf`（正規）
- `fonts/NotoSansCJKtc-Bold.otf`（粗體）

用於 PDF 證書生成。

### 5.4 Render 部署

1. 連接 GitHub 倉庫
2. 設定 Build Command: `npm start`
3. 設定環境變數
4. 推送觸發部署

---

## 6. 版本記錄

| 版本 | 日期 | 變更 |
|------|------|------|
| 1.0.0 | 2026-05-02 | 完成初始功能並通過 QA 測試 |

---

## 7. 附錄

### A. 錯誤碼參考

| 錯誤碼 | 說明 |
|--------|------|
| `VALIDATION_ERROR` | 欄位驗證失敗 |
| `EXAM_NOT_FOUND` | 考試不存在 |
| `MAX_ATTEMPTS_REACHED` | 已達最大作答次數 |
| `COOLDOWN_ACTIVE` | 冷卻期內無法作答 |
| `IN_PROGRESS` | 已有進行中的作答 |
| `INTERNAL_ERROR` | 伺服器錯誤 |

### B. API 錯誤回應格式

```json
{
    "error": {
        "code": "VALIDATION_ERROR",
        "message": "欄位驗證失敗",
        "details": {}
    }
}
```

### C. 成功回應格式

```json
{
    "data": {},
    "pagination": {
        "total": 1,
        "totalPages": 1,
        "page": 1,
        "limit": 20
    }
}
```