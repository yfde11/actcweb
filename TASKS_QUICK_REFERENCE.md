# ACTC 考試系統 - 任務快速參考
## 開發者用任務清單 (詳見 PROJECT_PLAN_2026-05.md 第一章)

---

## 優先級及分配

### 🔴 CRITICAL (立即開始)

#### 前端開發者 A - 會員考試 UI (A1-A5)
**總工時**: 80 小時 | **週期**: Week 1 (5/5-5/11)

| Task | 預估 | 狀態 | 檔案 | 備註 |
|------|------|------|------|------|
| A1.1 整合計時器警告 | 4h | TODO | `/public/member/index.html:L497` | 見 exam-optimization-patch.js |
| A1.2 修復視窗切換檢測 | 5h | TODO | `/public/member/index.html:L1720` | visibilityChangeCount 邏輯 |
| A1.3 修復時間計算 | 4h | TODO | `/public/member/index.html:L1762` | timeSpent 精確計算 |
| A1.4 修復證書 API | 3h | TODO | `/routes/member-exams.js:L1823` | 端點統一 |
| **A2.1** 開始考試流程 | 5h | INPROG (60%) | `/public/member/index.html:L1655` | 需優化加載狀態 |
| **A2.2** 繼續作答流程 | 6h | INPROG (50%) | `/public/member/index.html:L1694` | 恢復答案邏輯 |
| **A2.3** 選項隨機排列 | 6h | INPROG (40%) | `/public/member/index.html:L516` | 保持答案對應 |
| **A2.4** 答案自動保存 | 5h | TODO | localStorage + autosave 計時器 | 每30秒保存 |
| **A3.1** 提交確認與進度 | 4h | INPROG (70%) | `/public/member/index.html:L1762` | 顯示已答題目數 |
| **A3.2** 結果頁面優化 | 5h | INPROG (70%) | `/public/member/index.html:L546` | 通過/未通過視覺化 |
| **A3.3** 作弊判定展示 | 4h | TODO | 需補充邏輯 | 特殊訊息顯示 |
| **A3.4** 證書下載整合 | 3h | INPROG (80%) | `/public/member/index.html:L1820` | PDF 下載 |
| **A4.1** 歷史記錄展示 | 5h | INPROG (50%) | `/public/member/index.html:L382` | 按日期排序 |
| **A4.2** 明細頁面完成 | 6h | INPROG (50%) | `/public/member/index.html:L1854` | loadAttemptDetail 實現 |
| **A4.3** 統計數據補充 | 4h | TODO | 新增統計面板 | 總次數/通過數 |
| **A5.1** 小屏幕測試修復 | 6h | TODO | 375px/768px 測試 | 無文字截斷 |
| **A5.2** 觸屏互動優化 | 3h | TODO | hover→active 狀態 | 虛擬鍵盤調整 |
| **A5.3** 網路狀態指示 | 2h | TODO | 網路偵測 | 離線提示 |

#### 前端開發者 B - 統計報表 (B1-B4)
**總工時**: 45 小時 | **週期**: Week 2 (5/12-5/18)

| Task | 預估 | 狀態 | 檔案 | 備註 |
|------|------|------|------|------|
| **B1.1** API 回應驗證 | 2h | TODO | `/routes/exams.js:L700~800` | 執行 curl 測試 |
| **B1.2** 補充缺失欄位 | 3h | TODO | scoreDistribution, difficultyAnalysis | 實現聚合管道 |
| **B2.1** 統計卡片設計 | 6h | TODO | `/public/admin/question-bank.html` | 4 個 KPI 卡 |
| **B2.2** 分數分佈直方圖 | 8h | TODO | Chart.js 整合 | 柱狀圖 |
| **B2.3** 難度分析圖表 | 6h | TODO | 圓餅圖或水平條 | 通過率可視化 |
| **B3.1** 個人統計摘要 | 5h | TODO | `/public/member/index.html` 新區塊 | 會員側統計 |
| **B3.2** 進度視覺化 | 4h | TODO | 進度條 + 證書計數 | 百分比動畫 |
| **B3.3** 考試排名（可選）| 3h | BACKLOG | 排名計算邏輯 | 隱私保護 |
| **B4.1** CSV 下載按鈕 | 3h | BACKLOG | 使用既有 `/api/exams/:id/export` | 點擊下載 |
| **B4.2** PDF 報告（可選）| 3h | BACKLOG | 圖表截圖 + 摘要 | 非阻礙式 |

#### 後端開發者 - API 審計 & 優化 (C2, D1)
**總工時**: 25 小時 | **週期**: Week 2-3 (5/12-5/25)

| Task | 預估 | 狀態 | 檔案 | 備註 |
|------|------|------|------|------|
| **C2.1** 缺失端點檢查 | 5h | TODO | routes/member-exams.js | 驗證 7 個會員端點 |
| **C2.2** 回應格式統一 | 5h | TODO | 所有考試路由 | { data, error } 結構 |
| **C2.3** 認證與授權驗證 | 3h | TODO | middleware/memberAuth.js | JWT 檢驗 |
| **C2.4** 輸入驗證加強 | 2h | TODO | 答案驗證邏輯 | 類型檢查 |
| **D1.1** N+1 查詢消除 | 5h | DONE (95%) | routes/member-exams.js:L76 | 已優化 |
| **D1.2** 投影最小化 | 3h | TODO | .select() 使用 | 減少傳輸 |
| **D1.3** 查詢緩存實現 | 2h | BACKLOG | Redis 或記憶體快取 | 5-10min TTL |

#### QA 工程師 - 端到端測試 (C1)
**總工時**: 25 小時 | **週期**: Week 2-3 (5/12-5/25)

| 測試場景 | 預估 | 狀態 | 測試工具 | 通過率目標 |
|----------|------|------|---------|-----------|
| 正常考試流程 | 5h | TODO | Playwright | 100% |
| 邊界情況 | 5h | TODO | 手動 + 自動 | 100% |
| 會員權限 | 5h | TODO | 多帳號測試 | 100% |
| 管理員功能 | 5h | TODO | admin 帳號 | 100% |
| 性能基準 | 5h | TODO | k6/Artillery | < 2s P95 |

---

### 🟡 HIGH (Week 1-2 進行)

#### 後端開發者 - 資料庫與安全 (C3, C5)
**總工時**: 20 小時 | **週期**: Week 2-3

| Task | 預估 | 狀態 | 檔案 | 備註 |
|------|------|------|------|------|
| **C3.1** 模型關係驗證 | 3h | TODO | models/ | 檢查外鍵 |
| **C3.2** 索引性能檢查 | 3h | TODO | MongoDB | 運行 explain |
| **C3.3** 資料完整性驗證 | 2h | TODO | aggregation | 無孤立記錄 |
| **C3.4** 備份恢復演練 | 2h | TODO | mongodump/restore | 測試回復 |
| **C5.1** 認證授權檢查 | 3h | TODO | middleware/ | JWT 過期時間 |
| **C5.2** XSS 防護檢查 | 2h | TODO | input sanitization | DOMPurify |
| **C5.3** 注入風險檢查 | 2h | TODO | Mongoose 查詢 | 無動態查詢 |
| **C5.4** CSRF/CORS 檢查 | 2h | TODO | Helmet 配置 | CORS 白名單 |
| **C5.5** 費率限制 | 1h | BACKLOG | express-rate-limit | 提交限制 |

#### DevOps - 部署準備 (E1, E2, E3)
**總工時**: 18 小時 | **週期**: Week 4-5

| Task | 預估 | 狀態 | 檔案 | 備註 |
|------|------|------|------|------|
| **E1.1** 環境變數配置 | 2h | TODO | .env.example | 變數清單 |
| **E1.2** MongoDB 配置 | 2h | TODO | Atlas 後台 | 白名單 + 備份 |
| **E1.3** 字體檔案部署 | 2h | TODO | fonts/ | NotoSansCJK* |
| **E1.4** HTTPS 配置 | 2h | TODO | Render 設置 | SSL 證書 |
| **E2.1** 應用層監控 | 4h | TODO | Render/Datadog | 告警設置 |
| **E2.2** 基礎設施監控 | 3h | TODO | CPU/Memory | 儀表板 |
| **E2.3** 業務指標追蹤 | 2h | TODO | GA/Mixpanel | KPI 儀表板 |
| **E2.4** 日誌聚合 | 1h | TODO | ELK/Papertrail | 可搜尋 |
| **E3.1** 備份策略 | 3h | TODO | MongoDB backup | 30天保留 |
| **E3.2** 回滾計劃 | 3h | TODO | git tags | 快速回滾 |
| **E3.3** 故障通知 | 2h | TODO | Email/Slack | 告警配置 |

---

### 🟢 MEDIUM (並行進行)

#### 前端開發者 B - 跨瀏覽器 & 性能 (C4, D2, D4)
**總工時**: 25 小時 | **週期**: Week 3-4

| Task | 預估 | 狀態 | 檢查項 | 備註 |
|------|------|------|--------|------|
| **C4.1** CSS 相容性 | 3h | TODO | grid/flex/backdrop | Tailwind CDN |
| **C4.2** JavaScript 相容性 | 4h | TODO | fetch/localStorage | Polyfill 需求 |
| **C4.3** 表單輸入相容性 | 2h | TODO | 虛擬鍵盤 | iOS Safari 優先 |
| **C4.4** 文字與字體相容性 | 1h | TODO | 中文渲染 | PDF 字體 |
| **D2.1** 圖片最佳化 | 3h | TODO | WebP/佔位符 | 200KB 目標 |
| **D2.2** JavaScript 分割 | 4h | TODO | 延遲載入 | 100KB 目標 |
| **D2.3** CSS 精簡 | 2h | TODO | common.css | 50KB 目標 |
| **D2.4** 緩存策略 | 1h | TODO | Cache-Control header | 1年快取 |
| **D4.1** 長列表虛擬滾動 | 2h | TODO | > 50 題最佳化 | FPS > 50 |
| **D4.2** 輸入去抖動 | 2h | TODO | debounce 搜尋/保存 | 300ms/1s |
| **D4.3** 記憶體洩漏檢查 | 1h | TODO | Chrome DevTools | 無遞增記憶體 |

#### 項目經理 - UAT 與文件 (E4, F1-F3)
**總工時**: 16 小時 | **週期**: Week 4-5

| Task | 預估 | 狀態 | 檔案 | 備註 |
|------|------|------|------|------|
| **E4.1** 測試用戶準備 | 1h | TODO | 3-5 帳號 | 不同角色 |
| **E4.2** 測試腳本編寫 | 2h | TODO | 操作步驟文檔 | 含截圖 |
| **E4.3** 反饋收集修復 | 1h | TODO | 缺陷追蹤 | Critical 優先 |
| **F1.1** API 文檔更新 | 2h | TODO | `/api/member/exams/result` | 補充端點 |
| **F1.2** 規格書更新 | 2h | TODO | SPEC.md v1.1.0 | 若有變更 |
| **F1.3** 部署指南完成 | 3h | TODO | DEPLOYMENT.md | Node/MongoDB/Render |
| **F1.4** 故障排除指南 | 2h | TODO | TROUBLESHOOTING.md | 10+ 常見問題 |
| **F2** 用戶指南 | 6h | BACKLOG | zh-TW 版本 | 會員+管理員 |
| **F3** 變更日誌 | 2h | BACKLOG | CHANGELOG.md | v1.0.0 記錄 |

---

### 🔵 LOW (視時間而定)

#### 效能最佳化進階 (D3)
**總工時**: 10 小時 | **週期**: Week 3-4（可推後至 v1.1）

| Task | 預估 | 優先級 | 備註 |
|------|------|--------|------|
| D3.1 API 響應基準測試 | 3h | BACKLOG | k6 負載測試 |
| D3.2 慢查詢日誌分析 | 2h | BACKLOG | > 100ms 查詢 |
| D3.3 非同步優化 | 3h | BACKLOG | 背景 PDF 生成 |
| D3.4 連接池管理 | 2h | BACKLOG | Mongoose 配置 |

#### 使用者指南 & 可選功能
**總工時**: 9 小時 | **優先級**: LOW

| Task | 預估 | 備註 |
|------|------|------|
| 會員用戶指南 | 3h | 含截圖 |
| 管理員操作指南 | 3h | 含操作步驟 |
| 考試排名功能 | 3h | 隱私保護 |
| PDF 報告匯出 | 3h | 非同步生成 |

---

## 週進度檢查清單

### Week 1 (5/5-5/11) - 會員考試 UI 完成
```
□ A1 計時器與作弊檢測 100% 完成
  □ 倒計時顯示正確
  □ 視窗切換計數器工作
  □ 5分鐘警告出現

□ A2 考試流程 80% 完成
  □ startExam 邏輯優化
  □ resumeExam 恢復答案
  □ 選項隨機排列
  □ 答案自動保存基本實現

□ A3 提交結果 70% 完成
  □ 提交確認對話框
  □ 結果頁面美化
  □ 證書下載功能

□ A4 歷史查看 50% 完成
  □ 歷史列表顯示
  □ 明細 modal 基本框架

□ A5 行動適配 30% 完成
  □ 375px 小屏測試
  □ 觸屏反饋

✓ 目標: 從會員帳號完成一次完整考試
```

### Week 2 (5/12-5/18) - 統計報表 + 測試開始
```
□ B1 API 驗證 100% 完成
  □ 所有端點可測試
  □ 缺失欄位補充

□ B2 管理員統計 100% 完成
  □ 統計卡片展示
  □ 直方圖 & 圓餅圖

□ B3 會員統計 60% 完成
  □ 個人摘要卡片
  □ 進度條

□ C1 端到端測試開始
  □ 測試腳本編寫
  □ 基本流程測試

□ C2 後端 API 審計開始
  □ 回應格式檢查
  □ 認證檢驗

✓ 目標: 統計面板可展示, 測試用例 100% 覆蓋
```

### Week 3 (5/19-5/25) - 優化 + 集成測試
```
□ D1 資料庫最佳化 100% 完成
  □ 索引檢驗
  □ 查詢計劃優化

□ C3 資料庫一致性 100% 完成
  □ 外鍵完整
  □ 無孤立記錄

□ C4 跨瀏覽器測試 100% 完成
  □ Chrome/Safari/Firefox 測試
  □ iOS Safari 特殊處理

□ C5 安全性核查 100% 完成
  □ XSS 防護驗證
  □ JWT 時間檢查
  □ CORS 白名單

□ 文件更新 80% 完成
  □ API 文檔補充
  □ 部署指南基本完成

✓ 目標: 所有 QA 測試通過, 無阻礙性 bug
```

### Week 4 (5/26-6/1) - 部署準備 + UAT
```
□ E1 生產環境準備 100% 完成
  □ 環境變數配置
  □ MongoDB 備份啟用
  □ HTTPS 設置

□ E2 監控告警 100% 完成
  □ error rate 告警
  □ 業務 KPI 追蹤

□ E3 災難恢復 100% 完成
  □ 備份恢復測試
  □ 快速回滾計劃

□ E4 UAT 執行 100% 完成
  □ 客戶測試帳號已交付
  □ 反饋已分類

□ F1 文件完成 100% 完成
  □ DEPLOYMENT.md 完整
  □ API 文檔最終版

✓ 目標: 生產環境就緒, 客戶簽字驗收
```

### Week 5 (6/2-6/15) - 生產部署
```
□ 部署前檢查
  □ 部署檢查清單 100%
  □ 回滾計劃已驗證

□ 生產部署執行
  □ 代碼推送
  □ 資料庫遷移
  □ 健康檢查

□ 監控運行
  □ 告警無誤觸發
  □ 業務指標正常

□ 用戶支援
  □ 問題熱修復 < 1h
  □ 日常監控 + 日報

✓ 目標: 系統穩定運行, 日活用戶 > 50
```

---

## 開發者工作清單 (可複製使用)

### 前端開發者 A

**Week 1 優先順序**:
```
1. ✓ 整合計時器與警告 (4h) 
   - 修改 startTimeRemainingTimer() 
   - 驗證倒計時更新每秒
   - 測試 5分鐘警告

2. ✓ 視窗切換作弊檢測 (5h)
   - 添加 visibilitychange listener
   - 計數 > 10 時自動提交
   - 清理 listener (防洩漏)

3. ✓ 時間計算修復 (4h)
   - 驗證 timeSpent = (now - startedAt) / 1000
   - 補充到提交 body
   - 測試精度

4. ✓ 證書下載 API 統一 (3h)
   - 檢查前後端路由一致性
   - 若不一致，協調修改

5. 開始考試流程 (5h)
   - 優化 startExam() 加載狀態
   - 添加 5s 超時提示
   - 驗證錯誤顯示

6. 繼續作答流程 (6h)
   - 實現 resumeExam() 完整邏輯
   - 恢復之前答案
   - 重新啟動計時器

... (見上表詳情)
```

### 前端開發者 B

**Week 2 優先順序**:
```
1. ✓ API 驗證 (2h)
   - curl 測試 GET /api/exams/{id}/statistics
   - 檢查欄位完整性
   - 記錄缺失欄位

2. 補充 API 欄位 (3h, 與後端協調)
   - scoreDistribution 實現
   - difficultyAnalysis 實現

3. 統計卡片 (6h)
   - 4 個 KPI 卡片佈局
   - 數值計算與更新
   - 色彩編碼

4. 直方圖 (8h)
   - Chart.js CDN 載入
   - 分數分佈柱狀圖
   - 懸停提示

5. 圓餅圖 (6h)
   - 難度分析可視化
   - 通過率百分比

... (見上表詳情)
```

### 後端開發者

**Week 2-3 優先順序**:
```
1. ✓ API 端點驗證 (5h)
   - 測試 7 個會員端點
   - 記錄缺失/異常端點
   - 準備修復清單

2. 回應格式檢查 (5h)
   - 審計所有考試路由
   - 統一為 { data, error } 格式
   - 新增缺失欄位

3. 認證授權檢查 (3h)
   - JWT token 過期時間
   - 無效 token 應返回 401
   - 權限檢驗邏輯

4. 輸入驗證 (2h)
   - 答案格式驗證
   - 題型匹配檢查
   - 詳細錯誤訊息

5. N+1 查詢檢查 (3h)
   - 審計所有 find 操作
   - 使用 explain 驗證
   - 最多 2 次 DB 調用

6. 資料庫一致性 (5h)
   - 檢查外鍵完整
   - 無孤立記錄驗證
   - 備份恢復演練

... (見上表詳情)
```

---

## 常用命令速查

### 開發環境

```bash
# 啟動開發伺服器
npm run dev

# 測試考試 API (需登入令牌)
curl -H "Authorization: Bearer {token}" \
     http://localhost:5001/api/member/exams

# 手動建立管理員
node scripts/create-admin.js

# 播種考試資料
node scripts/populate-question-bank.js

# 運行 Puppeteer 煙霧測試
node scripts/test-question-bank-chrome.js
```

### 資料庫

```bash
# 連線 MongoDB (若本機)
mongosh mongodb://localhost:27017/actc_website

# 匯出備份
mongodump --uri="mongodb+srv://..." --out=./backup

# 恢復備份
mongorestore --uri="mongodb+srv://..." ./backup
```

### 前端測試

```bash
# 螢幕擷取測試 (UAT)
./qa-playwright-capture.sh http://localhost:5001 public/qa-screenshots

# Chrome DevTools 檢查性能
# 1. F12 開啟開發者工具
# 2. 進入 Performance 標籤
# 3. 記錄並分析考試流程
```

### Git 工作流

```bash
# 建立功能分支
git checkout -b feat/exam-ui-completion

# 定期推送
git push origin feat/exam-ui-completion

# 合併前檢查
git diff main...feat/exam-ui-completion

# 合併到 main
git checkout main && git pull
git merge feat/exam-ui-completion
git push origin main
```

---

## 風險速查表

| 風險 | 機率 | 影響 | 監控指標 |
|------|------|------|---------|
| UI 複雜度超支 | 中 | 延期 2-3 週 | Week 1 完成度 < 60% |
| API 異常 | 低 | 卡進度 | 無法測試端點 |
| 資料庫性能問題 | 中 | 無法上線 | 統計查詢 > 5s |
| 部署失敗 | 低 | 無法上線 | Week 4 部署檢查清單 < 80% |
| 客戶反饋過多 | 高 | 延期 1-2 週 | UAT 反饋 > 20 項 |

**應對**: 見 PROJECT_PLAN_2026-05.md 第三章

---

## 成功指標 (自檢)

### Week 1
- [ ] 可從會員帳號開始考試
- [ ] 計時器正常倒計時 (秒更新)
- [ ] 提交後顯示成績
- [ ] 視窗切換 10 次後自動提交
- [ ] 下載證書 PDF 成功

### Week 2
- [ ] 統計頁面顯示 4 個 KPI 卡
- [ ] 分數分佈圖表正確
- [ ] 所有 API 端點可測試
- [ ] QA 測試通過率 > 90%

### Week 3
- [ ] 資料庫查詢 < 100ms (P95)
- [ ] API 回應 < 1s (P95)
- [ ] 無 XSS 漏洞
- [ ] Chrome/Safari/Firefox 表現一致

### Week 4
- [ ] 備份恢復成功
- [ ] 監控告警已設置
- [ ] 文件 100% 完成
- [ ] 客戶 UAT 反饋 < 10 項重要問題

### Week 5
- [ ] 生產部署無故障
- [ ] 日活用戶 > 50
- [ ] 無重大 bug 報告
- [ ] 監控指標正常

---

## 聯繫方式

**項目經理**: (待定)  
**技術主管**: (待定)  
**Slack 頻道**: #exam-system-2026  
**日報**: 每日 16:00 (可選)  
**周會**: 每週一 10:00  
**緊急報告**: 立即 (Slack + 電話)

---

**最後更新**: 2026-05-03  
**下次更新**: 2026-05-12 (Week 1 結束)

