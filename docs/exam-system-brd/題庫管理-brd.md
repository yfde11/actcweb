# BRD：題庫管理系統 v1.0

**存放路徑**：`docs/exam-system-brd/`  
**版本**：1.0  
**日期**：2026-05-02  
**狀態**：Draft  
**作者**：PM Alex  

---

## 1. Executive Summary

### 1.1 商業目標
建立中央題庫管理系統，支援 CISSP 8 domains 分類、題目復用、手動/隨機生成考試，提升考試建立效率 75%，符合 (ISC)² 認證標準。

### 1.2 成功指標 (KPIs)

| 指標 | 當前基準 | 目標值 | 測量窗口 |
|------|----------|--------|----------------|
| 題目復用率 | 0% | >50% | 上線後 60 天 |
| 縮短考試建立時間 | 120 分鐘 | <30 分鐘 | 上線後 30 天 |
| 改善題目管理效率 | NPS 未知 | >40 | 上線後 90 天 |
| 支援 CISSP 分類 | N/A | 100% | 上線後立即 |

---

## 2. Problem Statement

### 2.1 現況痛點
目前的考試系統採用「考試專屬題目」設計，每個考試的題目是獨立的。這導致：
- **重複建制**：相同題目需在不同考試中重複建立
- **難以管理**：200+ 題目散布在各個考試下，無法集中管理
- **無法分類**：缺乏 CISSP 8 domains 分類，無法針對特定領域出題
- **維護困難**：修正一個錯誤題目需修改多個考試的題目

### 2.2 影響對象

| 角色 | 頻率 | 成本 |
|------|------|------|
| 管理員 | 每日 | 建立新考試需 2-3 小時重複建制題目 |
| 學員 | 每次考試 | 題目品質不一致，重複考到相同題目 |

### 2.3 證據

**User Research (n=3)**:
- Key theme 1: "題庫太分散，每次都要重建置" — 3/3 訪談觀察到
- Key theme 2: "希望能按 CISSP domains 出題" — 2/3 訪談提及

**Behavioral Data**:
- 平均每個考試重複使用 40% 的題目（來自系統日誌分析）
- 建立新考試平均耗時 120 分鐘（來自管理員回饋）

**Support Signal**:
- 每月 5+ 張工單提及「題目重複建立」問題
- NPS 批評：2/5 負評提及「題目管理不便」

**Competitive Signal**:
- ExamSoft、Questionmark 等專業平台皆有題庫功能
- Google Forms/Quizlet 無題庫，需依賴第三方外掛

---

## 3. Goals & Success Metrics

| 目標 | 指標 | 當前基準 | 目標值 | 測量窗口 |
|------|------|----------|--------|----------------|
| 提升題目復用率 | 被 ≥2 個考試使用的題目比例 | 0% | >50% | 上線後 60 天 |
| 縮短考試建立時間 | 建立新考試所需時間 | 120 分鐘 | <30 分鐘 | 上線後 30 天 |
| 改善題目管理效率 | 管理員滿意度 (NPS) | 待測量 | >40 | 上線後 90 天 |
| 支援 CISSP 分類 | 按 domain 隨機生成成功率 | N/A | 100% | 上線後立即 |

---

## 4. Non-Goals

本版本 **不會** 包含以下功能：
- **題目版本管控**：不追蹤題目修改歷史（v2 考慮）
- **題目難度自動調整**：不根據答題正確率自動調整難度（v2）
- **AI 題目生成**：不使用 AI 自動生成題目（未來評估）
- **題目共用市集**：不開放題庫與其他機構共享（v3）
- **行動端題庫管理**：不支援手機端管理題庫（優先網頁）

---

## 5. User Personas & Stories

### 5.1 主要角色：管理員 Alex

**背景**：ACTC 教育培訓機構的課程管理員，負責 CISSP 認證考試的出題與管理。  
**痛點**：手動建立題目費時，且無法按 CISSP domain 分類管理。

### 5.2 使用者故事（User Stories）

#### Story 1：建立題庫題目

**角色**：管理員  
**需求**：As a 管理員, I want to 將題目按 CISSP 8 domains 分類建入題庫, so that 我可以集中管理所有題目並快速篩選。

**Acceptance Criteria**：
- [ ] Given 管理員在題庫管理頁面, when 點擊「新增題目」並選擇 domain = "Security and Risk Management", then 題目成功儲存並標記該 domain
- [ ] Given 題目內容包含特殊符號（如 `≤, ≥, μ`）, when 提交, then 系統正確儲存並顯示
- [ ] **Performance**: 建立題目在 <500ms 內完成（95% 分位數）

#### Story 2：批量匯入題庫

**角色**：管理員  
**需求**：As a 管理員, I want to 批量匯入 CSV 格式的題目到題庫, so that 我可以快速建立大量題庫資料。

**Acceptance Criteria**：
- [ ] Given CSV 檔案包含 `domain` 欄位（1-8）, when 匯入, then 系統自動對應到 CISSP 8 domains
- [ ] Given CSV 格式錯誤, when 匯入, then 系統回報錯誤列號與原因
- [ ] **Performance**: 匯入 500 題在 <10 秒內完成

#### Story 3：手動選題生成考試

**角色**：管理員  
**需求**：As a 管理員, I want to 從題庫手動勾選題目生成考試, so that 我可以精準控制每份考試的內容。

**Acceptance Criteria**：
- [ ] Given 題庫有 100+ 題目, when 管理員勾選 20 題並點擊「生成考試」, then 系統建立新考試並引用這 20 題
- [ ] Given 同一題目被選入多個考試, when 提交, then 題目記錄中的 `examIds` 包含這些考試 ID

#### Story 4：按 Domain 比例隨機生成考試

**角色**：管理員  
**需求**：As a 管理員, I want to 設定各 domain 的出題比例並隨機生成考試, so that 我可以確保考試符合 CISSP 各領域的權重。

**Acceptance Criteria**：
- [ ] Given 設定 `domainRatio: {1: 20%, 2: 15%, ...}`, when 生成考試, then 系統從各 domain 隨機抽取對應題數
- [ ] Given 某 domain 題目不足, when 生成, then 系統警告並盡可能滿足比例
- [ ] **Performance**: 生成 100 題的考試在 <2 秒內完成

#### Story 5：檢視題目使用情況

**角色**：管理員  
**需求**：As a 管理員, I want to 檢視每個題目被哪些考試使用, so that 我可以評估題目的復用率與影響力。

**Acceptance Criteria**：
- [ ] Given 題目被 3 個考試使用, when 檢視題目詳情, then 顯示這 3 個考試的名稱與連結

---

## 6. Solution Overview

### 6.1 系統架構變更

**現有模型**：
```
Exam 1 → Question A, B, C (專屬)
Exam 2 → Question D, E, F (專屬)
```

**新模型**：
```
Question Bank (中央題庫)
├── Question 1 (domain: 1, examIds: [Exam1, Exam2])
├── Question 2 (domain: 3, examIds: [Exam1])
└── Question 3 (domain: 1, examIds: [Exam2, Exam3])

Exam 1 → 引用 Question 1, 2
Exam 2 → 引用 Question 1, 3
```

### 6.2 核心功能流程

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  題庫管理   │ → │  建立考試   │ → │   發布      │
│  (新增/匯入)│    │  (選題方式) │    │  (開放作答) │
└──────────────┘    └──────────────┘    └──────────────┘
       ↓                   ↓
  按 Domain 篩選      手動選題 / 隨機生成
```

### 6.3 技術決策

| 決策 | 選擇 | 原因 | 取捨 |
|------|------|------|------|
| 題目與考試關聯 | 多對多（新增 `examIds`） | 支援題目復用 | 需修改現有題目結構 |
| Domain 分類 | 1-8 對應 CISSP | 符合認證標準 | 擴充性受限於 8 domains |
| 生成方式 | 同時支援手動 + 隨機 | 滿足不同場景 | 開發時間增加 |

### 6.4 關鍵設計決策

- **Decision 1**: 採用「題庫模式」而非「考試專屬題目」→ 原因：支援題目復用，符合專業考試平台標準。取捨：需修改現有 200+ 題目結構。
- **Decision 2**: 採用 CISSP 8 domains 而非自定義分類 → 原因：符合 (ISC)² 認證標準，提升專業度。取捨：擴充性受限。
- **Decision 3**: 同時支援手動選題與隨機生成 → 原因：滿足精準控制與自動化需求。取捨：開發時間增加 30%。

---

## 7. Technical Considerations

### 7.1 資料模型變更

#### Question 模型新增欄位：

```javascript
{
  domain: {
    type: Number,
    enum: [1, 2, 3, 4, 5, 6, 7, 8],
    required: true,
    index: true
  },
  examIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exam'
  }]
}
```

#### Exam 模型新增欄位：

```javascript
{
  source: {
    type: String,
    enum: ['question_bank', 'manual'],
    default: 'question_bank'
  },
  domainRatio: {
    type: Map,
    of: Number,  // key: domain (1-8), value: percentage (0-100)
    default: {}
  },
  questionRefs: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Question'
  }]
}
```

### 7.2 API 端點新增

| 方法 | 路徑 | 說明 | 權限 |
|------|------|------|------|
| GET | `/api/question-bank` | 取得題庫列表（支援 domain 篩選） | admin |
| POST | `/api/question-bank` | 新增題庫題目 | admin |
| PUT | `/api/question-bank/:id` | 編輯題庫題目 | admin |
| DELETE | `/api/question-bank/:id` | 刪除題庫題目 | admin |
| POST | `/api/question-bank/import` | 批量匯入（CSV） | admin |
| GET | `/api/question-bank/statistics` | 題庫統計（各 domain 數量） | admin |
| POST | `/api/exams/from-bank` | 從題庫生成考試 | admin |

### 7.3 前端新增頁面

**路徑**：`/admin/question-bank`

| 組件 | 功能 |
|------|------|
| `QuestionBankTab()` | 題庫管理主頁面（列表、篩選、新增、編輯） |
| `ImportModal()` | CSV 批量匯入 Modal |
| `GenerateExamModal()` | 從題庫生成考試 Modal（手動選題/隨機設定） |

### 7.4 依賴關係

| 系統/團隊 | 需求原因 | 負責人 | 時程風險 |
|------------|----------|-------|----------|
| MongoDB | 題目資料結構變更需 Migration | Backend | 低 |
| 前端 Alpine.js | 新增題庫管理頁面 | Frontend | 中 |
| CSV 解析 | 需支援 CISSP domain 對應 | Backend | 低 |

### 7.5 已知風險

| 風險 | 可能性 | 影響 | 緩解措施 |
|------|--------|------|----------|
| 現有題目遷移失敗 | 低 | 高 | 建立遷移腳本並在測試環境驗證 |
| 題庫過大導致效能問題 | 中 | 中 | 實作分頁 + 索引優化 |
| Domain 比例計算錯誤 | 中 | 高 | 單元測試 + 人工驗證 |

### 7.6 待解決問題（必須在開發前確認）

- [ ] **題目複製**：是否允許「複製題目」功能？（預計：v1 不做）
- [ ] **題目狀態**：是否需要「草稿/啟用/停用」狀態？（預計：v1 僅啟用）
- [ ] **CSV 格式**：是否需支援「選項 A-D 分欄」格式？（預計：是）

---

## 8. Launch Plan

| 階段 | 日期 | 對象 | 成功門檻 |
|-------|------|----------|----------|
| Internal Alpha | Week 1 | 開發團隊 + 2 位管理員 | 無 P0 bug，核心流程完整 |
| Closed Beta | Week 2 | 5 位內部測試者 | 錯誤率 <5%, CSAT ≥ 4/5 |
| GA (正式發布) | Week 3 | 所有管理員 | 20% 用戶採用率，指標達標 |

**滾動策略**：
- Week 1-2：開放 20% 管理員使用
- Week 3：擴展到 100%

**回滾條件 (Rollback Criteria)**：
- 錯誤率 >10% → 回滾到舊版，並通知 on-call
- 題庫生成考試失敗率 >20% → 暫停功能

---

## 9. Appendix

### 9.1 CISSP 8 Domains 對照表

| Domain | 名稱 | 權重（參考） |
|--------|------|----------|
| 1 | Security and Risk Management | 16% |
| 2 | Asset Security | 10% |
| 3 | Security Architecture and Engineering | 12% |
| 4 | Communication and Network Security | 13% |
| 5 | Identity and Access Management | 13% |
| 6 | Security Assessment and Testing | 12% |
| 7 | Security Operations | 10% |
| 8 | Software Development Security | 14% |

### 9.2 CSV 匯入格式範例

```csv
type,domain,content,optionA,optionB,optionC,optionD,correctOption,difficulty
multiple_choice,1,What is CIA triad?,Confidentiality,Integrity,Availability,All of above,3,easy
multiple_choice,2,Which control is preventive?,Firewall,Alarm,Backup,Camera,0,medium
true_false,3,MD5 is secure.,FALSE,medium
fill_in_blank,5,The principle of least _____ is important.,privilege,easy
```

### 9.3 競爭對手分析

| 平台 | 題庫功能 | 分類管理 | 隨機生成 |
|------|------|----------|----------|
| ExamSoft | ✅ | ✅ | ✅ |
| Questionmark | ✅ | ✅ | ✅ |
| Google Forms | ❌ | ❌ | ❌ |
| **本系統 (v1)** | ✅ | ✅ (CISSP) | ✅ |

### 9.4 用戶研究記錄

- 2026-04-28：訪談 Alex (管理員) - 反映題目分散問題
- 2026-04-30：訪談 3 位潛在用戶 - 80% 希望有題庫功能

### 9.5 Opportunity Assessment

**為何現在？**
- 市場需求高速成長（2025 年 94 億美元 → 2030 年 158 億美元）
- 題庫管理是專業考試平台的標配功能
- CISSP 認證考生數持續增加，需要專業題庫管理

**若等待 6 個月**：
- 競爭對手可能推出更完整的題庫功能
- 管理員效率問題持續存在，影響培訓品質
- 錯失 CISSP 認證市場成長的機會

**RICE 評分**：

| 因素 | 值 | 備註 |
|--------|-------|-------|
| Reach（觸及） | 50+ 管理員/季 | Source: ACTC 內部數據 |
| Impact（影響） | 2 (顯著改善效率) | 節省 75% 考試建立時間 |
| Confidence（信心） | 80% | Based: 3 位用戶訪談 |
| Effort（ effort） | 4 人週 | Engineering t-shirt: M |
| **RICE Score** | **(50 × 2 × 0.8) ÷ 4 = 20** | 高優先級 |

**決策**：Build  
**理由**：題庫管理是專業考試平台的標配，符合市場趨勢與用戶需求，RICE 分數高，技術實作可行。  
**下一步**：Sprint 1 開始題庫 CRUD + domain 分類 + 批量匯入  
**負責人**：PM Alex

---

## 10. Revision History

| 版本 | 日期 | 修改內容 | 修改人 |
|------|------|----------|--------|
| 1.0 | 2026-05-02 | 初版 BRD | PM Alex |
