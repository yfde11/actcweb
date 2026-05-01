# Exam System — Complete Workflow Specification
**Version**: 2.0 (Revised after Architect Review)  
**Date**: 2026-05-01  
**Authors**: Workflow Architect, Software Architect, Backend Architect, UX Architect  
**Status**: Approved (Post-Review)  
**Project**: ACTC Website (Node.js + Express + MongoDB + Alpine.js)  
**Deployment**: Render (Free Tier) + MongoDB Atlas

---

## 0. 決策紀錄

| 項目 | 決定 |
|---|---|
| 題型 | 選擇題、是非題、填空題（全自動計分） |
| 證書模板 | 每個考試可自訂（JSON 結構，非 HTML） |
| 重考規則 | 可重考，冷卻時間預設 **15 天**（管理員可調整） |
| 出題方式 | 從題庫**隨機抽固定數量**（管理員設定抽題數） |
| 計時 | Server-side `expiresAt` 為主，前端倒數 |
| PDF 生成 | **PDFKit**（非 Puppeteer，適應 Render 免費版記憶體限制） |
| 證書儲存 | `/uploads/certificates/`（**注意**：Render 免費版為暫態儲存，後續需接 S3/R2） |
| 證書編號 | MongoDB 原子計數器（非隨機，防碰撞） |
| 題目快照 | ExamAttempt 儲存題目快照，防範考後題目被修改 |
| 防作弊 | 前端 `visibilitychange` 偵測切視窗，記錄次數（非強制阻擋） |
| 冷卻時間覆寫 | 管理員可手動解除用戶 cooldown 限制（後台 API） |

---

## 1. 資料模型（v2 — 審查後修正）

### 1.1 Exam（考卷）

```
Exam {
  title: String (required, max 200)
  description: String (required, max 2000)
  shortDescription: String (max 200)
  status: 'draft' | 'published' | 'active' | 'closed' | 'archived' (default 'draft')
  examType: 'quiz' | 'certification' (default 'quiz')
  timeLimit: Number (minutes, 0=no timer, min 0, max 480)
  passingScore: Number (percentage 0-100, default 70, min 0, max 100)
  maxAttempts: Number (0=unlimited, default 1, min 0, max 10)
  cooldownPeriod: Number (days, default 15, min 0, max 365)
  questionsPerAttempt: Number (required if using question pool, min 1)
    // 預設 0 = 全部題目都出
  startDate: Date
  endDate: Date
  shuffleQuestions: Boolean (default false)
  shuffleOptions: Boolean (default false)
  showCorrectAnswers: 'immediately' | 'after_submit' | 'never' (default 'after_submit')
  certificateEnabled: Boolean (default false)
  certificateTemplate: {
    title: String,
    issuer: String (default 'ACTC'),
    validityPeriod: Number (months, 0=forever),
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

**Indexes**:
- `{ status: 1 }`
- `{ status: 1, startDate: 1, endDate: 1 }`（複合索引，優化「可報考列表」查詢）
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

### 1.2 Question（題目）— v2 修正

```
Question {
  exam: ObjectId ref:Exam (required, index: true)
  questionNumber: Number (required, auto-assigned on create)
  type: 'multiple_choice' | 'true_false' | 'fill_in_blank' (required)
  content: String (required, max 2000)
  // MC options
  options: [
    { text: String (required, max 500), label: String (required) }
  ]  // MC only, 2-6 options, label must be unique per question
  // 修正：分開欄位代替 Mixed
  correctOptionIndex: Number,       // MC only: 0-based index of correct option
  correctBoolean: Boolean,          // T/F only: true or false
  correctAnswers: [String],         // Fill only: primary answer
  acceptableAnswers: [String],      // Fill only: case-insensitive alternatives (auto-lowercased)
  points: Number (default 1, min 1, max 100)
  explanation: String (max 1000)
  createdAt, updatedAt: Date (auto)
}
```

**Indexes**:
- `{ exam: 1, questionNumber: 1 }` (unique compound)
- `{ exam: 1 }`（優化查詢）

**Pre-save hooks**:
- 自動分配 `questionNumber` = max + 1
- `acceptableAnswers` 自動轉小寫
- 刪除時重新編號後續題目

### 1.3 ExamAttempt（作答）— v2 修正

```
ExamAttempt {
  exam: ObjectId ref:Exam (required, index: true)
  user: ObjectId ref:User (required, index: true)
  status: 'in_progress' | 'submitted' | 'graded' | 'expired' | 'cancelled'
  attemptNumber: Number (required, min 1, auto-incremented per user+exam)
  startedAt: Date (required)
  submittedAt: Date
  expiresAt: Date (startedAt + timeLimit, null if no timer)
  timeSpent: Number (seconds, computed on submit)
  
  // 題目快照：儲存考試當下的題目內容，防範考後題目被修改
  questionSnapshot: [{
    questionId: ObjectId ref:Question
    questionNumber: Number
    type: String
    content: String
    options: [{ text: String, label: String }]  // MC only
    points: Number
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
  
  ipAddress: String (audit)
  userAgent: String (audit)
  createdAt, updatedAt: Date (auto)
}
```

**Indexes**:
- `{ exam: 1, user: 1, status: 1 }`
- `{ user: 1 }`
- `{ status: 1, expiresAt: 1 }`（優化 Cron 查詢）

**Virtuals**: `isExpired`（expiresAt < now）, `timeRemaining`（秒）

### 1.4 Certificate（證書）— v2 修正

```
Certificate {
  certificateNumber: String (unique, pattern: 'ACTC-EXAM-YYYY-XXXXXX', index: true)
  exam: ObjectId ref:Exam (required, index: true)
  user: ObjectId ref:User (required, index: true)
  attempt: ObjectId ref:ExamAttempt (required)
  issuedAt: Date (required)
  expiresAt: Date (null if forever)
  pdfPath: String  // /uploads/certificates/{userId}/{certificateNumber}.pdf
  pdfSize: Number (bytes)
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

### 1.5 Counter（原子計數器）— 新增

```
Counter {
  _id: String (e.g., 'certificate_number')
  seq: Number (current sequence value)
}
```

**用途**：生成證書編號時原子遞增，防碰撞

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
     └── cancel ──> [cancelled]                             │
                                                   └── certificate ──> [certificate_issued]
```

---

## 3. API 端點（v2 — 審查後新增）

### 3.1 管理端 `/api/exams`（adminAuth）

| 方法 | 路徑 | 功能 |
|---|---|---|
| GET | `/api/exams` | 考卷列表（分頁、篩選） |
| POST | `/api/exams` | 建立考卷 |
| GET | `/api/exams/:id` | 考卷詳情（含題目） |
| PUT | `/api/exams/:id` | 更新考卷 |
| DELETE | `/api/exams/:id` | 刪除考卷（cascade 刪除題目、作答、證書） |
| PATCH | `/api/exams/:id/status` | 變更狀態（含轉換驗證） |
| POST | `/api/exams/:id/preview` | **新增** 預覽考試（渲染題目，不儲存） |
| GET | `/api/exams/:id/questions` | 題目列表（分頁） |
| POST | `/api/exams/:id/questions` | 新增題目 |
| PUT | `/api/exams/:id/questions/:qid` | 更新題目 |
| DELETE | `/api/exams/:id/questions/:qid` | 刪除題目（自動重新編號） |
| PATCH | `/api/exams/:id/questions/reorder` | **新增** 批量重排題目 |
| POST | `/api/exams/:id/questions/bulk` | **新增** 批量匯入（CSV/JSON） |
| GET | `/api/exams/:id/attempts` | 作答紀錄（分頁、篩選） |
| GET | `/api/exams/:id/statistics` | 統計（平均分、及格率、各題正確率） |
| POST | `/api/exams/:id/certificates/regenerate` | **新增** 重新生成失敗的證書 |
| GET | `/api/exams/:id/export-attempts` | **新增** 匯出成績（CSV） |
| DELETE | `/api/exams/:id/attempts/:attemptId/cooldown` | **新增** 管理員手動解除用戶 cooldown |

### 3.2 會員端 `/api/member/exams`（verifiedAuth）

| 方法 | 路徑 | 功能 |
|---|---|---|
| GET | `/api/member/exams` | 可報考列表（含用戶嘗試資訊） |
| GET | `/api/member/exams/:id` | 考卷資訊（不含答案，含用戶嘗試紀錄） |
| POST | `/api/member/exams/:id/start` | 開始考試（含隨機抽題） |
| GET | `/api/member/exams/:id/resume` | **新增** 繼續考試 |
| POST | `/api/member/exams/:id/submit` | 提交答案（自動計分） |
| PATCH | `/api/member/exams/:id/save-progress` | **新增** 儲存進度（自動存檔） |
| POST | `/api/member/exams/:id/cancel` | **新增** 取消進行中考試 |
| GET | `/api/member/exams/:id/result` | 查看成績（可指定 attemptId） |
| GET | `/api/member/exams/:id/certificate` | 下載證書 |
| GET | `/api/me/exam-history` | 我的作答紀錄 |

---

## 4. 核心流程（v2 — 審查後修正）

### 4.1 開始考試（含 Race Condition 防護）

```
1. 檢查資格：登入 + 信箱驗證 + membershipStatus='approved'
2. 檢查考試狀態：status='active' + 在期限內
3. 檢查重考限制：
   - graded attempts >= maxAttempts → 403
   - last graded attempt + cooldownPeriod > now → 403（顯示下次可考時間）
4. 檢查是否有 in_progress attempt：
   - findOne({ exam, user, status: 'in_progress' }) → 存在則 resume
5. Lazy Expiry 檢查：
   - 若 found attempt.expiresAt < now → auto-expire + grade → return result
6. **原子建立**（防 Race Condition）：
   - findOneAndUpdate(
       { exam, user, status: 'in_progress' },
       { $setOnInsert: { attemptNumber, startedAt, expiresAt, status: 'in_progress' } },
       { upsert: true, new: true }
     )
7. 隨機抽題：
   - 若 questionsPerAttempt < questionCount：
     - 從題庫隨機抽 questionsPerAttempt 題
   - 否則：回傳全部題目
8. 儲存題目快照到 attempt.questionSnapshot
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
```

### 4.3 提交考試

```
1. 驗證：
   - attempt 屬於該用戶
   - status = 'in_progress'
   - Lazy Expiry: 若 expiresAt < now → force expire
2. 收集答案：
   - 前端傳 [{ questionId, answer }]
   - 未出現在 answers 的快照題目 = unanswered（answer=null）
3. 更新 attempt：
   - status → 'submitted'
   - submittedAt = now
   - timeSpent = submittedAt - startedAt
   - visibilityChangeCount（從前端傳）
4. 觸發計分（4.4）
5. 回傳結果
```

### 4.4 自動計分

```
1. 讀取 attempt.questionSnapshot
2. 讀取 attempt.answers
3. 逐題比對：
   - MC: answer === correctOptionIndex
   - T/F: String(answer).toLowerCase() === String(correctBoolean).toLowerCase()
   - Fill: String(answer).trim().toLowerCase() in correctAnswers or acceptableAnswers
4. 計算：
   - totalPoints = sum(snapshot points)
   - earnedPoints = sum(pointsEarned)
   - score = (earnedPoints / totalPoints) * 100
   - passed = score >= exam.passingScore
   - gradingDetails = { totalPoints, earnedPoints, correctCount, incorrectCount, unansweredCount }
5. 更新 attempt：
   - status → 'graded'
   - gradedAt = now
   - score, passed, gradingDetails
6. 若 passed AND exam.certificateEnabled：
   - 觸發證書生成（4.5）
7. 依 showCorrectAnswers 回傳詳解
```

### 4.5 證書生成

```
1. 檢查是否已存在（idempotent）：findOne({ attempt }) → 存在則 skip
2. 生成證書編號：
   - Counter.findOneAndUpdate({ _id: 'certificate_number' }, { $inc: { seq: 1 } }, { new: true, upsert: true })
   - Format: ACTC-EXAM-{YYYY}-{seq padded to 6 digits}
3. 使用 PDFKit 生成 PDF：
   - 讀取 exam.certificateTemplate
   - 載入中文字型（NotoSansTC）
   - 繪製：考生姓名、考試名稱、分數、日期、證書編號
4. 儲存：
   - /uploads/certificates/{userId}/{certificateNumber}.pdf
   - fs.mkdirSync 確保目錄存在
5. 寫入 Certificate 紀錄：
   - certificateNumber, exam, user, attempt, issuedAt, expiresAt, pdfPath, pdfSize
6. （可選）寄信通知考生
```

---

## 5. 失敗模式與復原（v2 — 完整）

| 情境 | 處理方式 |
|---|---|
| **計時到期** | Lazy Expiry + Cron 每小時掃瞄，確保過期 attempt 被自動提交 |
| **斷線重連** | 檢查 in_progress attempt，resume |
| **超過 maxAttempts** | 403 MAX_ATTEMPTS_REACHED |
| **cooldown 未過** | 403，回傳 nextAttemptAt 時間戳 |
| **考試已關閉** | 允許 startedAt < endDate 的 attempt 提交；拒絕新 start |
| **證書生成失敗** | 記錄 certificateStatus='failed'，admin 可透過 `/certificates/regenerate` 重試 |
| **PDF 遺失（Render 重啟）** | 404 + 提示管理員重新生成；**長期解法：接 S3/R2** |
| **Race Condition on start** | findOneAndUpdate with upsert 確保唯一 in_progress |
| **提交衝突（timer + manual）** | expiresAt < now 時拒絕 manual submit，走 expire flow |
| **題目被修改後查看成績** | 使用 questionSnapshot，不影響已 grading 的結果 |

---

## 6. Cron Job 需求

**注意**：Render 免費版無原生 Cron，需使用外部服務（如 [cron-job.org](https://cron-job.org)）呼叫認證端點。

| Job | 頻率 | 端點 | 功能 |
|---|---|---|---|
| 過期嘗試清理 | 每小時 | `GET /api/cron/expired-attempts`（需 cron secret） | 將 expiresAt < now 的 in_progress 自動提交 |
| 考試自動關閉 | 每小時 | `GET /api/cron/close-expired-exams` | 將 endDate < now 的 active 設為 closed |
| 孤檔清理 | 每天 | `GET /api/cron/cleanup-orphaned-files` | 掃描 /uploads/certificates/，刪除無 DB 紀錄的 PDF |

---

## 7. 前端 UI 規範（UX Architect 建議）

### 7.1 會員端

| 頁面 | 路由 | 說明 |
|---|---|---|
| 考試列表 | `member/index.html#exams` | 卡片式列表，顯示狀態徽章 |
| 考試詳情 | `member/index.html#exam/:id` | 考試資訊、歷史紀錄、開始按鈕 |
| 考試作答 | `member/index.html#exam/:id/take` | 計時器、題目導航、書籤、自動存檔 |
| 成績查詢 | `member/index.html#exam/:id/result` | 分數、詳解、證書下載 |
| 我的證書 | `member/index.html#certificates` | 證書列表、下載 |

### 7.2 考試作答介面

```
┌─ Sticky Top Bar ───────────────────────┐
│  考試名稱          ⏱ 45:30  [提交試卷]  │
├────────────────────────────────────────┤
│  [題號] 題幹內容                        │
│                                         │
│  ○ A. 選項一                            │
│  ○ B. 選項二                            │
│  ○ C. 選項三                            │
│  ○ D. 選項四                            │
│                                         │
│  [上一題]  3/20  [下一題]  [加入書籤]   │
├────────────────────────────────────────┤
│  [Mobile Bottom: 題目導航面板（可展開）]  │
└────────────────────────────────────────┘
```

**題目導航面板**：
- ⚪ 未作答 | 🔵 已作答 | 🟡 書籤 | ⚫ 當前

**自動存檔**：每 30 秒 + 答案變更 debounce 500ms

**離開提醒**：`beforeunload` 事件，未儲存時顯示確認

### 7.3 管理端

| 頁面 | 路由 | 說明 |
|---|---|---|
| 考試列表 | `/admin` 新增「考試管理」tab | 表格顯示所有考試、狀態、統計 |
| 建立/編輯 | Modal 或獨立頁面 | 基本資訊、規則設定 |
| 題目管理 | Tab 切換 | 題目列表、新增、批量匯入、預覽 |
| 成績總覽 | Tab 切換 | 作答紀錄、匯出 CSV |
| 證書管理 | Tab 切換 | 證書列表、註銷、重新生成 |

---

## 8. 測試案例（70+ 項）

### 8.1 Admin: Exam Management

| # | 測試案例 | 輸入 | 預期 |
|---|----------|------|------|
| A1 | 建立考卷 - 成功 | 有效資料 | 201, status=draft |
| A2 | 建立考卷 - 缺 title | 無 title | 400 驗證錯誤 |
| A3 | 發布考卷 - 成功 | draft + >=1 題 | 200, status=published |
| A4 | 發布考卷 - 無題目 | draft + 0 題 | 400 "至少需要 1 題" |
| A5 | 非法狀態轉換 | draft → active | 400 "Cannot transition..." |
| A6 | 刪除考卷 - cascade | 有題目、作答 | 200, 全刪 |

### 8.2 Admin: Question Management

| # | 測試案例 | 輸入 | 預期 |
|---|----------|------|------|
| Q1 | 新增 MC - 成功 | 有效 MC | 201 |
| Q2 | 新增 MC - 選項 <2 | 1 選項 | 400 "MC needs 2-6 options" |
| Q3 | 新增 T/F - 成功 | 有效 T/F | 201 |
| Q4 | 新增 Fill - 成功 | 有效 Fill | 201 |
| Q5 | 刪除題目 - 重排 | 刪除第 3 題 | 200, 4,5→3,4 |
| Q6 | 批量匯入 - CSV | 10 題 CSV | 201, 10 題新增 |

### 8.3 Member: Exam Start

| # | 測試案例 | 輸入 | 預期 |
|---|----------|------|------|
| S1 | 開始考試 - 成功 | 符合資格 | 201, attempt + 題目 |
| S2 | 開始考試 - resume | 有 in_progress | 200, 現有 attempt |
| S3 | 開始考試 - maxAttempts | graded >= max | 403 MAX_ATTEMPTS |
| S4 | 開始考試 - cooldown | 冷卻中 | 403 + nextAttemptAt |
| S5 | 開始考試 - race | 同時 2 次 start | 僅 1 個 attempt 建立 |
| S6 | 開始考試 - lazy expire | in_progress 但已過期 | 自動 expire + 回傳結果 |

### 8.4 Member: Exam Submit & Grade

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

### 8.5 Certificate

| # | 測試案例 | 輸入 | 預期 |
|---|----------|------|------|
| C1 | 下載證書 - 成功 | 有效 | PDF 下載 |
| C2 | 下載證書 - 不存在 | 無證書 | 404 |
| C3 | 下載證書 - 已註銷 | isRevoked=true | 403 |
| C4 | 下載證書 - 計數 | 有效 | downloadCount++ |
| C5 | 重新生成 - 成功 | cert gen failed | 200, 重新生成 |

---

## 9. 風險與限制

| 風險 | 嚴重度 | 緩解措施 |
|---|---|---|
| **Render 免費版暫態儲存** | 高 | 證書 PDF 在重啟後遺失；後續接 S3/R2 |
| **MongoDB Atlas 512MB 限制** | 中 | 定期清理舊作答紀錄；限制證書 PDF 大小 |
| **無原生 Cron** | 中 | 使用 cron-job.org 或 Render 付費版 |
| **PDFKit 中文字型** | 中 | 需 bundle NotoSansTC（~15MB） |
| **大量同時考試** | 低 | 隨機抽題改用 app-level shuffle（<500 題時） |

---

## 10. 待確認問題

| # | 問題 | 狀態 |
|---|---|---|
| 1 | 冷卻時間管理員可否覆寫？ | ✅ 可覆寫（後台提供 admin API 手動解除 cooldown） |
| 2 | 是否需要匯出成績 CSV 的欄位自訂？ | ⬜ 待確認 |
| 3 | 證書預設語言？ | ✅ 中文 (zh-TW) |
| 4 | 是否需要在後台顯示防作弊記錄（切視窗次數）？ | ⬜ 待確認 |
| 5 | 是否需要題庫標籤/分類功能？ | ⬜ 待確認 |

---

## 11. 實作計畫

| 階段 | 內容 | 檔案 | 預估 |
|---|---|---|---|
| **Phase 1** | 資料模型（4 models + Counter） | `models/Exam.js`, `Question.js`, `ExamAttempt.js`, `Certificate.js`, `Counter.js` | 2h |
| **Phase 2** | 管理端 API CRUD + 狀態轉換驗證 | `routes/exams.js` | 4h |
| **Phase 3** | 會員端 API（報名、作答、提交） | `routes/member-exams.js` | 4h |
| **Phase 4** | 計分服務 + 隨機抽題 | `services/examGrading.js` | 3h |
| **Phase 5** | 證書生成服務（PDFKit） | `services/certificateGeneration.js` | 3h |
| **Phase 6** | Cron 端點 + 外部 Cron 設定 | `routes/cron.js` | 1h |
| **Phase 7** | 後台管理頁面 | `public/admin-exams.html` | 6h |
| **Phase 8** | 會員作答頁面 + 自動存檔 | `public/member/index.html` 新增 tab | 6h |
| **Phase 9** | 整合路由 + bootstrap 範例資料 | `server.js`, `lib/bootstrapDb.js` | 1h |
| **Phase 10** | 測試 + 修 bug | — | 4h |

**總計**：~34 小時

---

*End of Specification v2.0*
