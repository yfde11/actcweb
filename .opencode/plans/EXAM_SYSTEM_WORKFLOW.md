# Exam System — Complete Workflow Specification
**Version**: 4.0 (Fixed Critical Issues)  
**Date**: 2026-05-01  
**Authors**: Workflow Architect, Software Architect, Backend Architect, UX Architect, Database Optimizer, Product Manager, Technical Writer, UX Researcher, UI Designer, Corporate Training Designer, Senior Project Manager, Security Engineer  
**Status**: Approved (Post-Review v4)  
**Project**: ACTC Website (Node.js + Express + MongoDB + Alpine.js)  
**Deployment**: Render (Free Tier) + MongoDB Atlas (512MB)

---

## 0. 決策紀錄

| 項目 | 決定 |
|---|---|
| 題型 | 選擇題、是非題、填空題（全自動計分） |
| 證書模板 | 每個考試可自訂（JSON 結構，非 HTML） |
| 重考規則 | 可重考，冷卻時間預設 **15 天**（管理員可調整） |
| 出題方式 | 從題庫**分層隨機抽固定數量**（依 difficulty 比例） |
| 計時 | Server-side `expiresAt` 為主，前端倒數；<5 min 視覺警告 |
| PDF 生成 | **PDFKit**（非 Puppeteer，適應 Render 免費版記憶體限制） |
| 證書儲存 | **即時生成不儲存**（下載時動態渲染，省空間）；記錄 Certificate 文件僅存 metadata |
| 證書編號 | MongoDB 原子計數器（非隨機，防碰撞） |
| 題目快照 | ExamAttempt 儲存精簡快照（questionId, questionNumber, type, content, options, points） |
| 防作弊 | 切視窗 3 次警告 + 第 4 次自動交卷 | DevTools 檢測 + 持續開啟則交卷 | 禁用 copy/cut/paste/contextmenu | 前端禁用截圖快捷鍵 |
| 冷卻時間覆寫 | 管理員可手動解除用戶 cooldown 限制（後台 API） |
| 難度分層 | 每題標記 `easy | medium | hard`，抽題依比例分層 |
| 證書語言 | 中文 (zh-TW) |
| 負向計分 | 不扣分（入門級認證） |

---

## 1. 資料模型（v3 — 7-Agent 審查後修正）

### 1.1 Exam（考卷）

```
Exam {
  title: String (required, max 200)
  description: String (required, max 2000)
  shortDescription: String (max 200)
  status: 'draft' | 'published' | 'active' | 'closed' | 'archived' | 'deleted' (default 'draft')
  examType: 'quiz' | 'certification' (default 'quiz')
  timeLimit: Number (minutes, 0=no timer, min 0, max 480)
  passingScore: Number (percentage 0-100, default 70, min 0, max 100)
  maxAttempts: Number (0=unlimited, default 1, min 0, max 10)
  cooldownPeriod: Number (days, default 15, min 0, max 365)
  questionsPerAttempt: Number (required if using question pool, min 1)
    // 預設 0 = 全部題目都出
  difficultyRatio: {
    easy: Number (default 20, percentage),
    medium: Number (default 60, percentage),
    hard: Number (default 20, percentage)
  }
  // Pre-save hook: 驗證總和 = 100% (允許 ±1% 誤差)
  // 使用 findOneAndUpdate + $inc 原子操作避免 race condition
  // 若總和 != 100，自動按比例調整並記錄 warning
  startDate: Date
  endDate: Date
  shuffleQuestions: Boolean (default false)
  shuffleOptions: Boolean (default false)
  showCorrectAnswers: 'immediately' | 'after_submit' | 'never' (default 'after_submit')
  certificateEnabled: Boolean (default false)
  certificateTemplate: {
    title: String,
    issuer: String (default 'ACTC'),
    validityPeriod: Number (months, 0=forever, default 24 for foundation, 12 for advanced),
    language: String (default 'zh-TW'),
    customDesign: {
      logoPath: String,       // 遵循 ^\/uploads\/.+ 驗證
      borderColor: String,    // hex color
      footerText: String
    }
  }
  allowedMembers: 'all_approved' | 'specific' (default 'all_approved')
  allowedMemberIds: [ObjectId ref:User]
  questionCount: Number (反正規化，自動更新)
  totalPoints: Number (反正規化，自動更新)
  tags: [String]
  createdBy: ObjectId ref:User
  createdAt, updatedAt: Date (auto)
}
```

**Indexes**（v3 優化，刪除冗餘）:
- `{ status: 1, startDate: 1, endDate: 1 }`（複合索引，優化「可報考列表」查詢；已覆蓋單一 status 查詢）
- `{ createdBy: 1 }`

**Virtuals**: `isAvailable`（status=active 且在期限內）, `statusLabel`（中文）

**狀態轉換驗證（pre-save hook）**：
```
draft → published: 需 questionCount >= 1
published → active: 需 now >= startDate（或無 startDate）
published → draft: 允許（unpublish）
active → closed: 允許
closed → archived: 允許
其他轉換: 拒絕
```

### 1.2 Question（題目）— v3 修正

```
Question {
  exam: ObjectId ref:Exam (required, index: true)
  questionNumber: Number (required, auto-assigned on create)
  type: 'multiple_choice' | 'true_false' | 'fill_in_blank' (required)
  difficulty: 'easy' | 'medium' | 'hard' (required, default 'medium')
  content: String (required, max 2000)
  // MC options
  options: [
    { text: String (required, max 500), label: String (required) }
  ]  // MC only, 2-6 options, label must be unique per question
  // 分開欄位代替 Mixed
  correctOptionIndex: Number,       // MC only: 0-based index of correct option
  correctBoolean: Boolean,          // T/F only: true or false
  correctAnswers: [String],         // Fill only: primary answer
  acceptableAnswers: [String],      // Fill only: case-insensitive alternatives (auto-lowercased)
  points: Number (default 1, min 1, max 100)
  explanation: String (max 1000)
  createdAt, updatedAt: Date (auto)
}
```

**Indexes**（v3 優化，刪除冗餘）:
- `{ exam: 1, questionNumber: 1 }` (unique compound，已覆蓋單一 exam 查詢)
- `{ exam: 1, difficulty: 1 }`（優化分層隨機抽題查詢）

**Pre-save hooks**:
- 自動分配 `questionNumber` = max + 1
- `acceptableAnswers` 自動轉小寫
- 刪除時重新編號後續題目

### 1.3 ExamAttempt（作答）— v3 修正

```
ExamAttempt {
  exam: ObjectId ref:Exam (required, index: true)
  user: ObjectId ref:User (required, index: true)
  status: 'in_progress' | 'submitted' | 'graded' | 'expired' | 'cancelled' | 'auto_submitted_cheating'
  attemptNumber: Number (required, min 1, auto-incremented per user+exam)
  startedAt: Date (required)
  submittedAt: Date
  expiresAt: Date (startedAt + timeLimit, null if no timer)
  timeSpent: Number (seconds, computed on submit)
  
  // 題目快照（v4 修正）：僅存計分必要欄位
  // 注意：不存 options，答題時從 Question collection fetch 避免洩露答案
  // 但需存 correctAnswer 供計分使用
  questionSnapshot: [{
    questionId: ObjectId ref:Question
    questionNumber: Number
    type: String
    content: String           // 題目文字
    correctAnswer: Mixed       // MC: correctOptionIndex, T/F: correctBoolean, Fill: correctAnswers[0]
    points: Number
    difficulty: String        // easy | medium | hard
  }]
  
  answers: [{
    questionId: ObjectId ref:Question
    questionNumber: Number
    answer: Mixed  // Number for MC, Boolean for T/F, String for Fill
    isCorrect: Boolean
    pointsEarned: Number
  }]
  
  score: Number (percentage 0-100, null until graded)
  passed: Boolean (null until graded)
  gradingDetails: {
    totalPoints: Number,
    earnedPoints: Number,
    correctCount: Number,
    incorrectCount: Number,
    unansweredCount: Number
  }
  
  // 防作弊記錄
  visibilityChangeCount: Number (default 0)
  warningCount: Number (default 0)                    // 切視窗警告次數，達 3 次後第 4 次自動交卷
  cheatingDetected: Boolean (default false)           // 是否觸发作弊判定
  cheatingDetails: [{                                 // 作弊事件日誌
    type: 'visibility_change' | 'devtools' | 'screenshot',
    timestamp: Date,
    warningNumber: Number
  }]
  
  ipAddress: String (audit)
  userAgent: String (audit)
  createdAt, updatedAt: Date (auto)
}
```

**Indexes**（v3 優化）:
- `{ exam: 1, user: 1, status: 1 }`
- `{ user: 1 }`
- `{ status: 1, expiresAt: 1 }`（優化 Cron 查詢）
- `{ exam: 1, status: 1, startedAt: -1 }`（優化 admin 作答列表查詢，支援 cursor-based pagination）
- **Partial unique index**: `{ exam: 1, user: 1 }` with `partialFilterExpression: { status: "in_progress" }`（DB 層防 race condition）

**Virtuals**: `isExpired`（expiresAt < now）, `timeRemaining`（秒）

### 1.4 Certificate（證書）— v3 修正

```
Certificate {
  certificateNumber: String (unique, pattern: 'ACTC-EXAM-YYYY-XXXXXX', index: true)
  exam: ObjectId ref:Exam (required, index: true)
  user: ObjectId ref:User (required, index: true)
  attempt: ObjectId ref:ExamAttempt (required)
  issuedAt: Date (required)
  expiresAt: Date (null if forever)
  pdfPath: String  // null（即時生成，不預存）
  downloadCount: Number (default 0)
  lastDownloadedAt: Date
  isRevoked: Boolean (default false)
  revokedAt: Date
  revokeReason: String (max 500)
  createdAt, updatedAt: Date (auto)
}
```

**Indexes**:
- `{ certificateNumber: 1 }` (unique)
- `{ user: 1, exam: 1 }`
- `{ issuedAt: -1 }`
- `{ attempt: 1 }` (unique, for idempotent check)

### 1.5 Counter（原子計數器）— 新增

```
Counter {
  _id: String (e.g., 'certificate_number')
  seq: Number (current sequence value)
}
```

**用途**：生成證書編號時原子遞增，防碰撞。利用 `_id` 預設索引，無需額外加 index。

---

## 2. 狀態機

### 2.1 Exam Status

```
[draft] ──publish──> [published] ──activate──> [active] ──close──> [closed] ──archive──> [archived]
   │                        │                                         │
   └── delete ──> [deleted] └── unpublish ──> [draft]                 └── archive
```

**轉換規則**：

| 從 | 到 | 條件 | 誰 |
|---|---|---|---|
| draft | published | questionCount >= 1 | admin |
| draft | deleted | — | admin |
| published | active | now >= startDate（或無 startDate） | admin |
| published | draft | unpublish | admin |
| published | closed | manual close | admin |
| active | closed | manual close OR now > endDate | admin/system |
| closed | archived | manual archive | admin |

### 2.2 ExamAttempt Status

```
[in_progress] ──submit──> [submitted] ──auto-grade──> [graded]
     │                         │                            │
     ├── expire ──> [expired] ─┘                            │
     ├── cancel ──> [cancelled]                           │
     └── cheating ──> [auto_submitted_cheating]                │
                                                    └── certificate ──> [certificate_issued]
```

**注意**：`auto_submitted_cheating` 狀態不進入計分流程（4.4），不生成證書（4.5），統計時排除（3.3）。

---

## 3. API 端點（v3 — 審查後新增）

### 3.1 錯誤回應格式標準

所有錯誤回應遵循統一格式：

```json
{
  "error": {
    "code": "STRING_CODE",
    "message": "Human-readable message in zh-TW",
    "details": { /* field-level errors */ }
  }
}
```

**常見錯誤碼**：

| 錯誤碼 | HTTP | 說明 |
|---|---|---|
| `EXAM_NOT_FOUND` | 404 | 考試不存在 |
| `MAX_ATTEMPTS_REACHED` | 403 | 已達最大重考次數 |
| `COOLDOWN_ACTIVE` | 403 | 冷卻中，附 `nextAttemptAt` |
| `STATUS_TRANSITION_INVALID` | 400 | 非法狀態轉換 |
| `CERTIFICATE_EXPIRED` | 403 | 證書已過期 |
| `CERTIFICATE_NOT_FOUND` | 404 | 無證書記錄 |
| `ATTEMPT_NOT_OWNED` | 403 | 嘗試不屬於該用戶 |
| `EXAM_NOT_ACTIVE` | 403 | 考試非 active 狀態 |
| `VALIDATION_ERROR` | 400 | 欄位驗證失敗 |

### 3.2 分頁標準

所有列表端點統一參數：
- `page`（default 1）, `limit`（default 20, max 100）
- `sortBy`, `sortOrder`（可選）

回應格式：
```json
{
  "data": [...],
  "pagination": {
    "total": 150,
    "totalPages": 8,
    "page": 1,
    "limit": 20
  }
}
```

### 3.3 管理端 `/api/exams`（adminAuth）

| 方法 | 路徑 | 功能 |
|---|---|---|
| GET | `/api/exams` | 考卷列表（分頁、篩選 status） |
| POST | `/api/exams` | 建立考卷 |
| GET | `/api/exams/:id` | 考卷詳情（含題目） |
| PUT | `/api/exams/:id` | 更新考卷 |
| DELETE | `/api/exams/:id` | 刪除考卷（cascade 刪除題目、作答、證書） |
| PATCH | `/api/exams/:id/status` | 變更狀態（含轉換驗證） |
| POST | `/api/exams/:id/preview` | 預覽考試（渲染題目，不儲存） |
| GET | `/api/exams/:id/questions` | 題目列表（分頁） |
| POST | `/api/exams/:id/questions` | 新增題目 |
| PUT | `/api/exams/:id/questions/:qid` | 更新題目 |
| DELETE | `/api/exams/:id/questions/:qid` | 刪除題目（自動重新編號） |
| PATCH | `/api/exams/:id/questions/reorder` | 批量重排題目 |
| POST | `/api/exams/:id/questions/bulk` | 批量匯入（CSV/JSON） |
| GET | `/api/exams/:id/attempts/:attemptId` | **新增** 單一作答詳情（管理員） |
| GET | `/api/exams/:id/attempts` | 作答紀錄（分頁、篩選，cursor-based pagination） |
| GET | `/api/exams/:id/statistics` | 統計（平均分、及格率、各題正確率，**排除作弊**） |
| POST | `/api/exams/:id/certificates/regenerate` | 重新生成失敗的證書 |
| GET | `/api/exams/:id/export-attempts` | 匯出成績（CSV） |
| DELETE | `/api/exams/:id/attempts/:attemptId/cooldown` | 管理員手動解除用戶 cooldown |

### 3.4 會員端 `/api/member/exams`（verifiedAuth）

| 方法 | 路徑 | 功能 |
|---|---|---|
| GET | `/api/member/exams` | 可報考列表（含用戶嘗試資訊） |
| GET | `/api/member/exams/:id` | 考卷資訊（不含答案，含用戶嘗試紀錄） |
| POST | `/api/member/exams/:id/start` | 開始考試（含分層隨機抽題） |
| GET | `/api/member/exams/:id/resume` | 繼續考試 |
| POST | `/api/member/exams/:id/submit` | 提交答案（自動計分） |
| PATCH | `/api/member/exams/:id/save-progress` | 儲存進度（自動存檔） |
| POST | `/api/member/exams/:id/cancel` | 取消進行中考試 |
| GET | `/api/member/exams/:id/result` | 查看成績（可指定 attemptId） |
| GET | `/api/member/exams/:id/certificate` | 下載證書（即時生成 PDF stream） |
| GET | `/api/member/certificates` | **新增** 我的所有證書列表 |
| GET | `/api/me/exam-history` | 我的作答紀錄 |

### 3.5 Cron 端點（`/api/cron`）

**安全**：需 `X-Cron-Secret` header + IP whitelist（僅接受 cron-job.org IP）

| 方法 | 路徑 | 功能 |
|---|---|---|
| GET | `/api/cron/expired-attempts` | 過期嘗試自動提交（需 `X-Cron-Secret` header + IP） |
| GET | `/api/cron/close-expired-exams` | 考試自動關閉（需 `X-Cron-Secret` header + IP） |
| GET | `/api/cron/cleanup-orphaned-files` | 孤檔清理（需 `X-Cron-Secret` header + IP） |

**注意**：Render 免費版無原生 Cron，需使用外部服務（如 [cron-job.org](https://cron-job.org)）呼叫認證端點。

---

## 4. 核心流程（v3 — 審查後修正）

### 4.1 開始考試（含 DB 層 Race Condition 防護）

```
1. 檢查資格：登入 + 信箱驗證 + membershipStatus='approved'
2. 檢查考試狀態：status='active' + 在期限內
3. 檢查重考限制：
   - graded attempts >= maxAttempts → 403 MAX_ATTEMPTS_REACHED
    - last graded OR expired attempt + cooldownPeriod > now → 403 COOLDOWN_ACTIVE（附 nextAttemptAt）
4. 檢查是否有 in_progress attempt：
   - findOne({ exam, user, status: 'in_progress' }) → 存在則 resume
5. Lazy Expiry 檢查：
   - 若 found attempt.expiresAt < now → auto-expire + grade → return result
6. **DB 層原子建立**（partial unique index 防 race condition）：
   - 嘗試 insert 新 attempt，若 partial unique index 衝突 → 代表已有 in_progress → resume
7. **分層隨機抽題**：
   - 若 questionsPerAttempt < questionCount：
     - 依 exam.difficultyRatio 比例計算 easy/medium/hard 各抽幾題
     - 從各難度層隨機抽題（$sample aggregation）
     - 若某難度題目不足，從其他難度補足
   - 否則：回傳全部題目
8. 儲存精簡題目快照到 attempt.questionSnapshot
9. 回傳題目（不含正確答案）
```

### 4.2 儲存進度（自動存檔）

```
POST /api/member/exams/:id/save-progress
- 每 30 秒自動呼叫（前端）
- 或答案變更時 debounce 500ms 呼叫
- 更新 attempt.answers
- 不觸發計分
- 回傳 200（靜默成功）或 500（失敗，前端 toast）
- 若 MongoDB 斷線，前端 fallback 存 localStorage，重連後同步
```

### 4.3 提交考試

```
1. 驗證：
   - attempt 屬於該用戶（否則 403 ATTEMPT_NOT_OWNED）
   - status = 'in_progress'
   - Lazy Expiry: 若 expiresAt < now → force expire
2. 收集答案：
   - 前端傳 [{ questionId, answer }]
   - 未出現在 answers 的快照題目 = unanswered（answer=null）
3. 更新 attempt：
   - 後端自行計算作弊檢測：
     * 若 timeSpent < questionsPerAttempt * 30 秒（每題最少 30 秒）→ cheatingDetected = true
     * 若 visibilityChangeCount > 10（異常頻繁切換）→ cheatingDetected = true
   - 若 cheatingDetected=true → status = 'auto_submitted_cheating'
   - 否則 → status = 'submitted'
   - submittedAt = now
   - timeSpent = submittedAt - startedAt
4. 觸發計分（4.4）
5. 依 showCorrectAnswers 回傳結果
```

### 4.4 自動計分

```
1. 檢查作弊狀態：
   - 若 attempt.status === 'auto_submitted_cheating' → 不觸發計分
   - 直接設定：score = 0, passed = false, status = 'auto_submitted_cheating'
   - skip 剩餘步驟
2. 讀取 attempt.questionSnapshot
3. 讀取 attempt.answers
4. 逐題比對：
   - MC: answer === correctOptionIndex
   - T/F: String(answer).toLowerCase() === String(correctBoolean).toLowerCase()
   - Fill: String(answer).trim().toLowerCase() in correctAnswers or acceptableAnswers
5. 計算：
   - totalPoints = sum(snapshot points)
   - earnedPoints = sum(pointsEarned)
   - score = (earnedPoints / totalPoints) * 100
   - passed = score >= exam.passingScore
   - gradingDetails = { totalPoints, earnedPoints, correctCount, incorrectCount, unansweredCount }
6. 更新 attempt：
   - status → 'graded'
   - gradedAt = now
   - score, passed, gradingDetails
7. 若 passed AND exam.certificateEnabled AND NOT cheatingDetected：
   - 觸發證書生成（4.5）
8. 依 showCorrectAnswers 回傳詳解
```

### 4.5 證書生成（v4 — 即時生成模式）

```
1. 檢查是否已存在記錄（idempotent）：findOne({ attempt }) → 存在則 skip
2. 檢查是否作弊：if (attempt.cheatingDetected) → skip（不生成證書）
3. 生成證書編號：
   - Counter.findOneAndUpdate({ _id: 'certificate_number' }, { $inc: { seq: 1 } }, { new: true, upsert: true })
   - Format: ACTC-EXAM-{YYYY}-{seq padded to 6 digits}
4. 寫入 Certificate 紀錄（不含 pdfPath）：
   - certificateNumber, exam, user, attempt, issuedAt, expiresAt
5. 下載時即時生成（GET /api/member/exams/:id/certificate）：
   - 讀取 exam.certificateTemplate + attempt 資訊
   - 使用 PDFKit 生成 PDF stream
   - 直接回傳 binary stream（不寫入磁碟）
   - Content-Disposition: attachment; filename="certificate-{certificateNumber}.pdf"
6. 更新 downloadCount++, lastDownloadedAt
7. （可選）寄信通知考生（若未作弊）
```

---

## 5. 失敗模式與復原（v3 — 完整）

| 情境 | 處理方式 |
|---|---|
| **計時到期** | Lazy Expiry + Cron 每小時掃瞄，確保過期 attempt 被自動提交 |
| **斷線重連** | 檢查 in_progress attempt，resume；若 MongoDB 斷線，前端存 localStorage |
| **超過 maxAttempts** | 403 MAX_ATTEMPTS_REACHED |
| **cooldown 未過** | 403 COOLDOWN_ACTIVE，回傳 nextAttemptAt 時間戳 |
| **考試已關閉** | 允許 startedAt < endDate 的 attempt 提交；拒絕新 start |
| **證書生成失敗** | 記錄錯誤，admin 可透過 `/certificates/regenerate` 重試 |
| **Race Condition on start** | Partial unique index + catch DuplicateKey error → resume |
| **提交衝突（timer + manual）** | expiresAt < now 時拒絕 manual submit，走 expire flow |
| **防作弊觸發** | 前端警告 3 次（visibilitychange），第 4 次自動提交 + 標記 cheatingDetected=true |
| **DevTools 開啟** | 警告，持續開啟（resize 檢測）則自動提交 |
| **題目被修改後查看成績** | 使用精簡 questionSnapshot，不影響已 grading 的結果 |
| **PDFKit 記憶體溢出** | 限制 PDF 大小 <10MB，使用 stream 模式 |
| **MongoDB Atlas 空間不足** | Cron 定期清理 >30 天的 attempt；不儲存 PDF binary |

---

## 6. Cron Job 需求

**注意**：Render 免費版無原生 Cron，需使用外部服務（如 [cron-job.org](https://cron-job.org)）呼叫認證端點。

| Job | 頻率 | 端點 | 功能 |
|---|---|---|---|
| 過期嘗試清理 | 每小時 | `GET /api/cron/expired-attempts`（需 `X-Cron-Secret`） | 將 expiresAt < now 的 in_progress 自動提交 |
| 考試自動關閉 | 每小時 | `GET /api/cron/close-expired-exams` | 將 endDate < now 的 active 設為 closed |
| 孤檔清理 | 每天 | `GET /api/cron/cleanup-orphaned-files` | 清理 >30 天的 graded attempts |

---

## 7. 前端 UI 規範（v3 — 7-Agent 建議整合）

### 7.1 色彩系統（加入 tailwind-config.js）

| 用途 | 色彩 | Tailwind |
|---|---|---|
| Brand Primary | `#1E40AF` | custom `primary-600` |
| Brand Secondary | `#F59E0B` | custom `secondary-500` |
| 狀態：Draft | neutral-100/neutral-700 | `bg-neutral-100 text-neutral-700` |
| 狀態：Active | green-100/green-700 | `bg-green-100 text-green-700` |
| 狀態：Closed | red-100/red-700 | `bg-red-100 text-red-700` |
| 題目：未作答 | neutral-50/neutral-300 | `bg-neutral-50 border-neutral-200` |
| 題目：已作答 | blue-100/blue-700 | `bg-blue-100 text-blue-700` |
| 題目：書籤 | amber-100/amber-700 | `bg-amber-100 text-amber-700` |
| 題目：當前 | neutral-900/white | `bg-neutral-900 text-white` |
| 計分：正確 | green-50/green-700 | `bg-green-50 text-green-700` |
| 計分：錯誤 | red-50/red-700 | `bg-red-50 text-red-700` |

### 7.2 字體層級

| 元素 | 樣式 |
|---|---|
| 考試標題 | `text-2xl font-bold text-neutral-900` |
| 區塊標題 | `text-xl font-semibold text-neutral-800` |
| 題目文字 | `text-lg font-medium text-neutral-900 leading-relaxed` |
| 選項文字 | `text-base text-neutral-700 pl-4` |
| 計時器 | `text-lg font-mono font-semibold` |
| 副標題/說明 | `text-sm text-neutral-500` |

字型：Inter（Google Fonts CDN）+ NotoSansTC（PDFKit 用）

### 7.3 Font Awesome 圖示對應

| 用途 | 圖示 |
|---|---|
| 狀態：Draft | `fa-file-lines` |
| 狀態：Active | `fa-play-circle` |
| 狀態：Closed | `fa-ban` |
| 題型：MC | `fa-circle-dot` |
| 題型：T/F | `fa-toggle-on` |
| 題型：Fill | `fa-font` |
| 書籤 | `fa-bookmark` |
| 開始考試 | `fa-play` |
| 提交 | `fa-paper-plane` |
| 下載 | `fa-download` |
| 歷史 | `fa-clock-rotate-left` |
| 空狀態 | `fa-inbox` |

### 7.4 會員端

| 頁面 | 路由 | 說明 |
|---|---|---|
| 考試列表 | `member/index.html#exams` | 卡片式列表，狀態徽章，空狀態提示 |
| 考試詳情 | `member/index.html#exam/:id` | 考試資訊、歷史紀錄、開始按鈕 |
| 考試作答 | `member/index.html#exam/:id/take` | 計時器、題目導航、書籤、自動存檔、鍵盤導航 |
| 成績查詢 | `member/index.html#exam/:id/result` | 分數、詳解、證書下載 |
| 我的證書 | `member/index.html#certificates` | 證書列表、下載 |

### 7.5 考試作答介面（v3 增強）

```
┌─ Sticky Top Bar ───────────────────────────────┐
│  考試名稱          ⏱ 45:30  [提交試卷]          │
│  (<5min: bg-red-100 text-red-700 + pulse)      │
├────────────────────────────────────────────────┤
│  [題號] 題幹內容                                │
│                                                 │
│  ○ A. 選項一                                    │
│  ○ B. 選項二                                    │
│  ○ C. 選項三                                    │
│  ○ D. 選項四                                    │
│                                                 │
│  [上一題]  3/20  [下一題]  [加入書籤 📖]        │
├────────────────────────────────────────────────┤
│  [Mobile Bottom: 題目導航面板（可展開）]          │
└────────────────────────────────────────────────┘
```

**題目導航面板**：
- 不只靠顏色，加圖示標籤：⚪ 未作答 | 🔵 已作答 | 🟡 書籤 | ⚫ 當前
- 顯示進度文字：「已作答 3/20」

**自動存檔**：每 30 秒 + 答案變更 debounce 500ms；斷線 fallback localStorage

**離開提醒**：`beforeunload` 事件，未儲存時顯示確認

**防作弊機制**：
- 事件監聽：`visibilitychange`, `blur`, `focus`, `resize`（DevTools 檢測）, `copy`, `cut`, `paste`, `contextmenu`, `keydown`（PrintScreen/F12）
- 切視窗警告：第 1-3 次彈出 Modal「檢測到切視窗行為（X/3），再次違規將自動交卷」
- 第 4 次觸发自動交卷：顯示「因違反考試規則，試卷已自動提交」→ 3 秒後跳轉結果頁
- DevTools 檢測：`window.outerHeight - window.innerHeight > 200` 或 `window.outerWidth - window.innerWidth > 200`
- 右鍵選單/複製貼上：`preventDefault()` 禁用
- 截圖快捷鍵：攔截 `keydown` 中 `PrintScreen`、`Ctrl+Shift+I`、`F12`
- 自動交卷後狀態設為 `auto_submitted_cheating`，管理端可標記

**鍵盤導航**：
- ← / →：上一題 / 下一題
- 1-9：快速跳轉題號
- Enter：提交（需確認）
- S：加入書籤

**無障礙**：
- `aria-live` region for timer updates
- `aria-label` for all icon-only buttons
- Focus states: `outline-primary-500`
- 4.5:1+ contrast ratio

### 7.6 管理端

| 頁面 | 路由 | 說明 |
|---|---|---|
| 考試列表 | `/admin` 新增「考試管理」tab | 表格顯示所有考試、狀態、統計 |
| 建立/編輯 | Modal 或獨立頁面 | 基本資訊、規則設定、難度比例 |
| 題目管理 | Tab 切換 | 題目列表、新增、批量匯入、預覽 |
| 成績總覽 | Tab 切換 | 作答紀錄、匯出 CSV、cooldown 解除 |
| 證書管理 | Tab 切換 | 證書列表、註銷、重新生成 |

### 7.7 Responsive Breakpoints

| Breakpoint | 行為 |
|---|---|
| `<640px (sm)` | 考試卡片 full-width，題目導航變 bottom sheet，sticky bar 精簡 |
| `640px-768px (sm-md)` | 2-column 考試卡片，題目導航 off-canvas |
| `≥768px (md)` | 3-column 考試卡片，fixed sidebar 題目導航 |
| `print` | 隱藏非必要元素，證書 full-bleed |

---

## 8. 教學設計規範（Corporate Training Designer 建議）

### 8.1 題型比例建議

| 題型 | 比例 | 選項數 |
|---|---|---|
| Multiple Choice | 75% | 4-5 選項（避免 2-3 選項） |
| True/False | 10% | 2 選項 |
| Fill-in-Blank | 15% | 1-3 字答案 |

### 8.2 難度分層比例

| 難度 | 比例 | 認知層級 |
|---|---|---|
| Easy | 20% | Recall（記憶） |
| Medium | 60% | Application（應用） |
| Hard | 20% | Analysis（分析） |

**抽題時依此比例分層抽取**，確保每次考試難度一致。

### 8.3 時間建議

| 題型 | 每題時間 |
|---|---|
| MC | 60-90 秒 |
| T/F | 30-45 秒 |
| Fill-in-Blank | 90-120 秒 |

總時間 = 計算最小值 × 1.5（寬容度）

### 8.4 填空題設計最佳實踐

- 題幹明確指定格式（大小寫、空白處理）
- 預定義可接受答案列表（`correctAnswers` + `acceptableAnswers`）
- 避免模糊措辭，確保唯一正確答案
- 答案不超過 3 個字

### 8.5 證書有效期建議

| 等級 | 有效期 |
|---|---|
| 基礎認證 | 24 個月 |
| 進階認證 | 12 個月 |

需再認證（重新考試或累積 20+ CEUs）

### 8.6 重考政策

- 預設 3 次/12 個月，15 天冷卻
- 不及格提供 domain-level 反饋
- 連續 3 次不及格需完成補救學習

---

## 9. 測試案例（80+ 項）

### 9.1 Admin: Exam Management

| # | 測試案例 | 輸入 | 預期 |
|---|----------|------|------|
| A1 | 建立考卷 - 成功 | 有效資料 | 201, status=draft |
| A2 | 建立考卷 - 缺 title | 無 title | 400 VALIDATION_ERROR |
| A3 | 發布考卷 - 成功 | draft + >=1 題 | 200, status=published |
| A4 | 發布考卷 - 無題目 | draft + 0 題 | 400 "至少需要 1 題" |
| A5 | 非法狀態轉換 | draft → active | 400 STATUS_TRANSITION_INVALID |
| A6 | 刪除考卷 - cascade | 有題目、作答 | 200, 全刪 |

### 9.2 Admin: Question Management

| # | 測試案例 | 輸入 | 預期 |
|---|----------|------|------|
| Q1 | 新增 MC - 成功 | 有效 MC | 201 |
| Q2 | 新增 MC - 選項 <2 | 1 選項 | 400 "MC needs 2-6 options" |
| Q3 | 新增 T/F - 成功 | 有效 T/F | 201 |
| Q4 | 新增 Fill - 成功 | 有效 Fill | 201 |
| Q5 | 刪除題目 - 重排 | 刪除第 3 題 | 200, 4,5→3,4 |
| Q6 | 批量匯入 - CSV | 10 題 CSV | 201, 10 題新增 |
| Q7 | 新增題目 - 缺 difficulty | 無 difficulty | 400, 預設 medium |

### 9.3 Member: Exam Start

| # | 測試案例 | 輸入 | 預期 |
|---|----------|------|------|
| S1 | 開始考試 - 成功 | 符合資格 | 201, attempt + 題目 |
| S2 | 開始考試 - resume | 有 in_progress | 200, 現有 attempt |
| S3 | 開始考試 - maxAttempts | graded >= max | 403 MAX_ATTEMPTS_REACHED |
| S4 | 開始考試 - cooldown | 冷卻中 | 403 COOLDOWN_ACTIVE + nextAttemptAt |
| S5 | 開始考試 - race | 同時 2 次 start | 僅 1 個 attempt 建立 |
| S6 | 開始考試 - lazy expire | in_progress 但已過期 | 自動 expire + 回傳結果 |
| S7 | 分層抽題 - 比例 | easy:20, med:60, hard:20 | 抽題比例正確 |
| S8 | 分層抽題 - 補足 | 某難度不足 | 從其他難度補足 |

### 9.4 Member: Exam Submit & Grade

| # | 測試案例 | 輸入 | 預期 |
|---|----------|------|------|
| G1 | 提交 - 全對 | 全部正確 | score=100, passed=true |
| G2 | 提交 - 全錯 | 全部錯誤 | score=0, passed=false |
| G3 | 提交 - 部分作答 | 部分未作答 | unanswered counted |
| G4 | 提交 - 計時到期 | expiresAt < now | auto-expire + grade |
| G5 | 提交衝突 | manual + expire | expire flow 優先 |
| G6 | MC 計分 - 正確 | answer=correctIndex | isCorrect=true |
| G7 | T/F 計分 - 大小寫 | answer='TRUE', correct=true | isCorrect=true |
| G8 | Fill 計分 - trim+case | answer=' Hello ', correct='hello' | isCorrect=true |
| G9 | Fill 計分 - acceptable | answer='hi', acceptable=['hi','hey'] | isCorrect=true |
| G10 | 證書生成 - 及格 | passed + certEnabled | Certificate 建立 |
| G11 | 不生成證書 - 不及格 | passed=false | 無 Certificate |

### 9.5 Certificate

| # | 測試案例 | 輸入 | 預期 |
|---|----------|------|------|
| C1 | 下載證書 - 成功 | 有效 | PDF stream 下載 |
| C2 | 下載證書 - 不存在 | 無證書 | 404 CERTIFICATE_NOT_FOUND |
| C3 | 下載證書 - 已註銷 | isRevoked=true | 403 CERTIFICATE_EXPIRED |
| C4 | 下載證書 - 計數 | 有效 | downloadCount++ |
| C5 | 即時生成 - 記憶體 | 大量下載 | <10MB RAM usage |

### 9.7 Email 通知

| # | 測試案例 | 輸入 | 預期 |
|---|----------|------|------|
| E1 | 考試結果通知 - 及格 | passed=true | 收到郵件，含分數、連結 |
| E2 | 考試結果通知 - 不及格 | passed=false | 收到郵件，含分數、連結 |
| E3 | 證書發放通知 - 及格+certEnabled | passed=true, certEnabled=true | 收到郵件，含證書編號、下載連結 |
| E4 | 證書發放通知 - 作弊 | cheatingDetected=true | 不寄通知 |
| E5 | Email 範本 injection | subject=`test\r\nBCC:evil@test.com` | 被 escape，不注入 |
| E6 | 大量通知 | 100 人同時完成 | SMTP 佇列正常，無遺失 |

---

## 10. 風險與限制

| 風險 | 嚴重度 | 緩解措施 |
|---|---|---|
| **Render 免費版暫態儲存** | 高 | 證書即時生成不儲存，無需考慮重啟遺失；後續接 S3/R2 如需快取 |
| **MongoDB Atlas 512MB 限制** | 高 | 精簡 questionSnapshot；Cron 清理 >30 天 attempts；不存 PDF binary；監控 Atlas dashboard |
| **無原生 Cron** | 中 | 使用 cron-job.org 或 Render 付費版；Lazy Expiry 確保 API call 也能觸發清理 |
| **PDFKit 中文字型 + 記憶體** | 中 | NotoSansTC ~15MB；stream 模式生成；限制 <10MB；Sprint 2 優先驗證 |
| **分層抽題不足補足** | 低 | 若某難度題目不足，從其他難度補足；管理員收到警告 |
| **Render 休眠（15min）** | 中 | UptimeRobot/cron-job.org ping 每 10min；文件說明首次載入可能慢 |

---

## 11. 待確認問題（v4 — 部分已確認）

| # | 問題 | 狀態 |
|---|---|---|
| 1 | 冷卻時間管理員可否覆寫？ | ✅ 可覆寫（後台提供 admin API 手動解除 cooldown） |
| 2 | **是否需要匯出成績 CSV 的欄位自訂？** | ⬜ 待確認（建議：預設欄位：姓名、信箱、分數、狀態、時間） |
| 3 | 證書預設語言？ | ✅ 中文 (zh-TW) |
| 4 | **是否需要在後台顯示防作弊記錄（切視窗次數）？** | ✅ **已加入**：管理端 attempt 詳情頁面顯示 `visibilityChangeCount`, `warningCount`, `cheatingDetected`, `cheatingDetails` |
| 5 | **是否需要題庫標籤/分類功能？** | ⬜ 待確認（建議 P2 加入） |
| 6 | **是否需要練習考試模式（不計分、無限重考）？** | ⬜ 待確認（建議 P2 加入） |
| 7 | **是否需要證書公開驗證頁面（QR code 導向）？** | ✅ **已加入**：P2 加入 `GET /api/certificates/verify/:certificateNumber` 公開驗證 |

---

## 12. 實作計畫（v3 — 44 小時，4 Sprints）

### Sprint 1: 基礎（Sprint 1-2 週期，~15h）

| Phase | 內容 | 檔案 | 預估 | Quality Gate |
|---|---|---|---|---|
| P1 | 資料模型（5 models） | `models/Counter.js`, `Exam.js`, `Question.js`, `ExamAttempt.js`, `Certificate.js` | 2.5h | Schema validation passes, indexes created |
| P2 | 管理端 API CRUD | `routes/exams.js` | 5h | CRUD ops work, status transitions enforced |
| P3 | 會員端 API | `routes/member-exams.js` | 5h | Start/submit/auto-save tested |

**Deliverables**: Models validated, Admin + Member APIs functional, Postman collection committed

### Sprint 2: 核心邏輯（~11h）

| Phase | 內容 | 檔案 | 預估 | Quality Gate |
|---|---|---|---|---|
| P4 | 計分服務 + 分層隨機抽題 | `services/examGrading.js` | 4h | Unit tests pass, stratified sampling verified |
| P5 | 證書即時生成（PDFKit） | `services/examCertificates.js` | 4h | PDF generates <3s, <10MB RAM |
| P6 | Cron 端點 | `routes/cron.js` | 1.5h | curl test passes, CRON_SECRET secured |

**Deliverables**: Grading working, certificate PDF streaming, cron jobs secured, memory usage tested

### Sprint 3: UI（~15h）

| Phase | 內容 | 檔案 | 預估 | Quality Gate |
|---|---|---|---|---|
| P7 | 後台管理頁面 | `public/admin.html` 新增 tab | 7.5h | CRUD works, responsive |
| P8 | 會員作答頁面 | `public/member/index.html` 新增 tab | 7.5h | Full flow: start→answer→submit→result |

**Deliverables**: Both UIs complete, responsive layout verified, keyboard nav working

### Sprint 4: 整合測試（~18h)

| Phase | 內容 | 檔案 | 預估 | Quality Gate |
|---|---|---|---|---|
| P9 | 整合路由 + bootstrap | `server.js`, `lib/bootstrapDb.js` | 2h | Seed data loads, full flow works |
| P10 | 測試 + 修 bug | — | 8h | Bug count <3 critical, README updated |
| P11 | OpenAPI spec + docs | `docs/api.md`, Postman | 3h | API spec matches implementation |
| P12 | 部署驗證 + Sprint 4 buffer | Render | 5h | Production flow verified, Atlas <400MB |

**總計**：~52 小時（含 25% buffer，原 44h → 52h）

---

## 13. API 合約文件（骨架）

> 詳細 OpenAPI 3.1 spec 將於 Sprint 4 完成，此處列出骨架。

### Base URL
- Development: `http://localhost:3000/api`
- Production: `https://actc-web.onrender.com/api`

### Auth
- Admin: `Authorization: Bearer <token>`（role=admin）
- Member: `Authorization: Bearer <token>`（emailVerified=true）
- Cron: `X-Cron-Secret: <secret>`

### Rate Limits
- Admin APIs: 200 req/15min
- Member APIs: 100 req/15min
- **Start exam**: 10 req/min（防濫建 attempt）
- **Submit exam**: 10 req/min（防重複提交）
- Save progress: 10 req/min（debounce 前端處理）
- Cron endpoints: 20 req/hour（僅接受來 cron-job.org IP）

---

## 14. Bulk Import 格式規範

### CSV 格式
```csv
type,content,options,correctAnswer,points,difficulty,explanation
multiple_choice,什麼是 XSS?,"選項1;選項2;選項3;選項4",A,1,medium,XSS 是跨站腳本攻擊
true_false,JavaScript 是強型別語言?,FALSE,1,easy,
fill_in_blank,HTTP 的預設阜號是？,,80,1,easy,
```

**CSV 規則**：
- `options`：MC 題用 `;` 分隔，T/F 和 Fill 留空
- `correctAnswer`：MC 用選項標籤（A/B/C/D → 0/1/2/3），T/F 用 TRUE/FALSE，Fill 用正確答案
- `difficulty`：easy | medium | hard
- `explanation`：可選

**Bulk import 轉換規則**：
- MC `correctAnswer`：A→0, B→1, C→2, D→3（儲存為 `correctOptionIndex`）
- T/F `correctAnswer`：TRUE→true, FALSE→false（儲存為 `correctBoolean`）
- Fill `correctAnswer`：直接存入 `correctAnswers[0]`

### JSON 格式
```json
{
  "questions": [
    {
      "type": "multiple_choice",
      "content": "什麼是 XSS?",
      "options": [
        { "label": "A", "text": "選項1" },
        { "label": "B", "text": "選項2" },
        { "label": "C", "text": "選項3" },
        { "label": "D", "text": "選項4" }
      ],
      "correctAnswer": "A",
      "points": 1,
      "difficulty": "medium",
      "explanation": "XSS 是跨站腳本攻擊"
    },
    {
      "type": "true_false",
      "content": "JavaScript 是強型別語言?",
      "correctAnswer": false,
      "points": 1,
      "difficulty": "easy"
    }
  ]
}
```

**JSON 規則**：
- MC：`correctAnswer` 為選項 label（字串）
- T/F：`correctAnswer` 為 boolean
- Fill：`correctAnswer` 為字串
- `difficulty` 預設 `medium`

### 匯入端點
```
POST /api/exams/:id/questions/bulk
Content-Type: multipart/form-data
Body: file (CSV 或 JSON)

回應：
{
  "imported": 10,
  "skipped": 2,
  "errors": [
    { "row": 3, "error": "Invalid question type" }
  ]
}
```

---

## 15. Email 通知服務（v4 — 基本 email）

### 15.1 使用現有 `services/email.js`

直接呼叫已存在的 email service，無需新建服務文件。

### 15.2 通知事件

| 事件 | 觸發時機 | 收件人 | 內容 |
|---|---|---|---|
| 考試提交 | 作答完成（graded） | 考生 | 分數、是否及格、詳解連結 |
| 證書發放 | 及格 + certificateEnabled | 考生 | 證書下載連結、編號、有效期 |
| 考試開始 | 考生開始考試 | 考生（僅自己） | 不寄信（前端顯示即可） |
| Cooldown 解除 | 管理員手動解除 | 考生 | 可重新報考通知 |

### 15.3 Email Template 範例

**注意**：所有變數需使用 `validator.escape()` 或 `heml-entities` 套件 escape，防止 email header injection 和 HTML injection。

**考試結果通知**：
```
主旨：ACTC 考試成績通知 — {examTitle}

親愛的 {userName}：

您的考試「{examTitle}」已完成評分。

成績：{score}%
結果：{passed ? '及格' : '不及格'}

查看詳解：{baseUrl}/member#exam/:id/result

ACTC 團隊
```

**證書發放通知**（及格 + certificateEnabled）：
```
主旨：ACTC 證書已發放 — {examTitle}

親愛的 {userName}：

恭喜您通過「{examTitle}」認證考試！

證書編號：{certificateNumber}
有效期至：{expiresAt}

下載證書：{baseUrl}/api/member/exams/:id/certificate

ACTC 團隊
```

### 15.4 管理員測試 API

| 方法 | 路徑 | 功能 |
|---|---|---|
| POST | `/api/exams/:id/notify-test` | 發送測試通知（管理員） |

### 15.5 實作注意

- 使用 `services/email.js` 的 `sendMail()` 函數
- 考試提交時觸發：在 `4.4 自動計分` 第 7 步後呼叫
- 證書發放時觸發：在 `4.5 證書生成` 第 3 步後呼叫
- 若 SMTP 未設定：記錄 warning，不阻擋主流程

---

*End of Specification v4.0*
