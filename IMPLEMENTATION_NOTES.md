# 實裝指南 - ACTC 考試系統完成
## 關鍵實現細節及常見陷阱

---

## 一、會員端考試 UI 實現

### 重點 1: 計時器與警告邏輯

**現狀分析**:
- 計時器函數已存在 (`startTimeRemainingTimer` @ index.html:L1720)
- 缺少: 5 分鐘警告、visibility 監聽、cleanup
- 實現位置: `examsTab()` 函數內

**正確實現流程**:
```javascript
startTimeRemainingTimer() {
    if (this.timeRemainingInterval) clearInterval(this.timeRemainingInterval);
    
    // 關鍵 #1: 添加 visibility 監聽 (作弊檢測)
    this._visibilityChangeHandler = () => {
        if (document.hidden) {  // 用戶切換標籤
            this.visibilityChangeCount++;
            if (this.visibilityChangeCount <= 3) {
                alert(`警告：偵測到視窗切換（第 ${this.visibilityChangeCount} 次）\n請勿切換視窗。`);
            } else if (this.visibilityChangeCount > 10) {
                alert('偵測到異常頻繁的視窗切換，系統將標記作弊行為。');
            }
        }
    };
    document.addEventListener('visibilitychange', this._visibilityChangeHandler);
    
    // 關鍵 #2: 每秒更新計時器與檢查警告條件
    this.timeRemainingInterval = setInterval(() => {
        if (!this.currentAttempt?.expiresAt) return;
        const remaining = Math.max(0, Math.floor((new Date(this.currentAttempt.expiresAt) - new Date()) / 1000));
        
        // 關鍵 #3: 少於 5 分鐘時顯示警告
        if (remaining <= 300 && remaining > 0) {
            this.showTimeWarning = true;
        }
        
        // 時間到時自動提交
        if (remaining <= 0) {
            clearInterval(this.timeRemainingInterval);
            document.removeEventListener('visibilitychange', this._visibilityChangeHandler);
            alert('考試時間到！即將自動提交。');
            this.submitExam();
        }
    }, 1000);  // 必須是 1000ms
}
```

**常見陷阱**:
- ❌ `setInterval(1000)` 應為 `1000` 毫秒, 不是秒
- ❌ 忘記移除 visibility listener → 記憶體洩漏
- ❌ 多次呼叫 `startTimeRemainingTimer()` 而未清理舊的 interval
- ❌ `new Date(expiresAt)` 若時間戳格式不對會出現 NaN

**測試方法**:
```javascript
// 在 browser console 中執行
// 1. 開始考試
// 2. 切換標籤 (Alt+Tab 或 Cmd+Tab)
// 3. 檢查 alert 是否出現
// 4. 查看 examsTab().visibilityChangeCount 是否遞增
```

---

### 重點 2: 提交時發送完整資料

**後端期望格式** (routes/member-exams.js:L567-590):
```javascript
{
    attemptId: "...",  // 必須
    answers: [
        {
            questionId: "...",  // Question _id
            answer: value       // 依題型: 整數/boolean/字串
        }
    ],
    timeSpent: seconds,           // 秒數 (整數)
    visibilityChangeCount: number // 非負整數
}
```

**錯誤場景及修復**:
1. **答案對應錯誤**
   ```javascript
   // ❌ 錯誤: 使用題目序號而非 _id
   answers: [{ questionId: 1, answer: 0 }]  // 1 是序號, 不是 _id!
   
   // ✅ 正確
   answers: [{ 
       questionId: "507f1f77bcf86cd799439011",  // MongoDB _id
       answer: 0 
   }]
   ```

2. **答案類型不匹配**
   ```javascript
   // ❌ 錯誤: 單選題應是整數, 不是字串
   { questionId: "...", answer: "0" }
   
   // ✅ 正確
   { questionId: "...", answer: 0 }  // 整數
   
   // 判斷題應是 boolean
   { questionId: "...", answer: true }
   
   // 填空題應是字串
   { questionId: "...", answer: "Paris" }
   ```

3. **時間計算誤差**
   ```javascript
   // 目前 (錯誤)
   timeSpent: this.currentAttempt.timeLimit ?
       Math.floor((new Date() - new Date(this.currentAttempt.startedAt)) / 1000) : 0
   
   // ✅ 修正: 若 timeLimit = 0 (無限制), 仍應記錄時間
   timeSpent: Math.floor((new Date() - new Date(this.currentAttempt.startedAt)) / 1000)
   
   // 或者更精確
   const timeSpentMs = Date.now() - new Date(this.currentAttempt.startedAt).getTime();
   timeSpent: Math.floor(timeSpentMs / 1000)
   ```

**偵錯技巧**:
```javascript
// 在 submitExam() 中添加 console.log
console.log('提交資料:', {
    attemptId: this.currentAttempt.attemptId,
    answers: answersArray,
    timeSpent: this.currentAttempt.timeLimit ? ... : 0,
    visibilityChangeCount: this.visibilityChangeCount
});
```

---

### 重點 3: 證書下載路由匹配

**現況檢查**:
- 前端呼叫: `GET /api/member/exams/certificate/{certNumber}` (index.html:L1823)
- 後端實現: `GET /api/member/certificates` (member-exams.js:L804)
- **問題**: 路由不完全匹配!

**解決方案**:
1. 在 `routes/member-exams.js` 中確認存在:
   ```javascript
   // 應存在此端點
   router.get('/certificates', verifiedAuth, async (req, res) => {
       // 回傳用戶的所有證書
   });
   
   // 或此端點 (更直接)
   router.get('/:examId/certificate/:certNumber', verifiedAuth, async (req, res) => {
       // certNumber: "ACTC-EXAM-2026-000001"
       // 回傳 PDF 二進位
   });
   ```

2. 若不存在, 建立新端點:
   ```javascript
   // 新增於 routes/member-exams.js
   router.get('/certificate/:certNumber', verifiedAuth, async (req, res) => {
       try {
           const cert = await Certificate.findOne({
               certificateNumber: req.params.certNumber
           }).populate('exam');
           
           if (!cert) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
           
           // 生成 PDF (使用既有的 generateCertificatePDF 函數)
           const pdfBuffer = await generateCertificatePDF(cert);
           
           res.setHeader('Content-Type', 'application/pdf');
           res.setHeader('Content-Disposition', `attachment; filename="certificate-${cert.certificateNumber}.pdf"`);
           res.send(pdfBuffer);
       } catch (err) {
           console.error('証書下載錯誤:', err);
           res.status(500).json({ error: { code: 'INTERNAL_ERROR' } });
       }
   });
   ```

**路由註冊檢查** (server.js):
```javascript
// 確認在 server.js 中正確掛載
const memberExamsRoutes = require('./routes/member-exams');
app.use('/api/member/exams', memberExamsRoutes);

// 所以完整路由應該是
GET /api/member/exams/certificate/{certNumber}
//  ↑ /api/member/exams (掛載點)
//     ↑ /certificate/{certNumber} (路由)
```

---

### 重點 4: 恢復作答邏輯

**API 端點** (`GET /api/member/exams/:examId/resume`):
```javascript
// 後端應回傳
{
    data: {
        attemptId: "...",
        status: "in_progress",
        expiresAt: "2026-05-03T10:30:00Z",
        questions: [ /* 題目陣列 */ ],
        answers: [  // 關鍵: 用戶之前的答案
            { questionId: "...", answer: 0 },
            { questionId: "...", answer: true },
            // ...
        ]
    }
}
```

**前端恢復邏輯**:
```javascript
async resumeExam(examId, attemptId) {
    try {
        const res = await fetch(`/api/member/exams/${examId}/resume`, {
            headers: this.authHeaders(),
            credentials: 'include',
        });
        const data = await res.json();
        if (res.ok) {
            this.currentAttempt = data.data;
            
            // 關鍵: 恢復之前填寫的答案
            this.answers = {};  // 重置
            if (data.data.answers && Array.isArray(data.data.answers)) {
                data.data.answers.forEach(a => {
                    this.answers[a.questionId] = a.answer;
                });
            }
            
            // 重新啟動計時器
            this.startTimeRemainingTimer();
        } else {
            alert(data.error?.message || '繼續考試失敗');
        }
    } catch (e) {
        console.error('Resume exam error:', e);
        alert('網路錯誤');
    }
}
```

**陷阱**:
- ❌ 忘記恢復 `this.answers` 物件 → 用戶之前的答案丟失
- ❌ 假設 `data.data.answers` 一定存在 → 應檢查 undefined
- ❌ 不重新啟動計時器 → 顯示錯誤的剩餘時間

---

## 二、統計與報表實現

### 重點 1: 後端統計 API 完整性

**必須檢查的欄位** (routes/exams.js 中的 `/api/exams/:id/statistics`):
```javascript
GET /api/exams/:id/statistics
Response:
{
    data: {
        totalAttempts: 10,           // 必須
        passedCount: 7,               // 通過人數
        failedCount: 3,               // 未通過人數
        averageScore: 75.5,           // 平均分數
        passRate: 70,                 // 通過率百分比 (0-100)
        scoreDistribution: {          // 分數分佈 (缺時需補)
            "0-10": 0,
            "10-20": 0,
            "20-30": 0,
            // ...
            "90-100": 7
        },
        difficultyAnalysis: {         // 難度分析 (缺時需補)
            easy: { passed: 5, total: 6, passRate: 83 },
            medium: { passed: 5, total: 7, passRate: 71 },
            hard: { passed: 2, total: 3, passRate: 67 }
        }
    }
}
```

**若缺 scoreDistribution, 補充方案**:
```javascript
// 在 routes/exams.js 的 GET /api/exams/:id/statistics 中添加

const scoreDistribution = {
    "0-10": 0, "10-20": 0, "20-30": 0, "40-50": 0,
    "50-60": 0, "60-70": 0, "70-80": 0, "80-90": 0, "90-100": 0
};

attempts.forEach(a => {
    if (a.score !== undefined) {
        const bucket = Math.floor(a.score / 10) * 10;
        const key = `${bucket}-${bucket+10}`;
        if (scoreDistribution.hasOwnProperty(key)) {
            scoreDistribution[key]++;
        }
    }
});

// 回傳時包含
result.scoreDistribution = scoreDistribution;
```

**驗證方法**:
```bash
# 在本地測試
curl -H "Authorization: Bearer {token}" \
     http://localhost:5001/api/exams/{examId}/statistics | jq .
     
# 檢查返回格式
# 應包含: totalAttempts, passedCount, failedCount, averageScore, passRate, scoreDistribution, difficultyAnalysis
```

---

### 重點 2: Chart.js 整合

**常用於此項目的圖表**:

1. **柱狀圖 (分數分佈)**:
```html
<!-- 在管理後台添加 canvas -->
<canvas id="scoreDistributionChart" class="max-h-[400px]"></canvas>

<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script>
const ctx = document.getElementById('scoreDistributionChart').getContext('2d');
const chart = new Chart(ctx, {
    type: 'bar',
    data: {
        labels: ['0-10%', '10-20%', '20-30%', /* ... */ '90-100%'],
        datasets: [{
            label: '考生人數',
            data: [0, 0, 1, 2, 3, 2, 5, 3, 4],  // 來自 API
            backgroundColor: 'rgba(54, 162, 235, 0.5)',
            borderColor: 'rgba(54, 162, 235, 1)',
            borderWidth: 1
        }]
    },
    options: {
        responsive: true,
        scales: {
            y: { beginAtZero: true }
        }
    }
});
</script>
```

2. **圓餅圖 (難度通過率)**:
```javascript
new Chart(ctx, {
    type: 'doughnut',  // 或 'pie'
    data: {
        labels: ['簡單', '中等', '困難'],
        datasets: [{
            data: [83, 71, 67],  // 通過率百分比
            backgroundColor: [
                '#10b981',  // 綠色 (簡單)
                '#f59e0b',  // 黃色 (中等)
                '#ef4444'   // 紅色 (困難)
            ]
        }]
    }
});
```

**常見問題**:
- ❌ Canvas 沒有高度 → 圖表看不見
  ```html
  <!-- 錯誤 -->
  <canvas id="chart"></canvas>
  
  <!-- 正確 -->
  <div class="h-96">  <!-- 加上容器高度 -->
      <canvas id="chart"></canvas>
  </div>
  ```

- ❌ 資料為字串而非數字 → 圖表不畫
  ```javascript
  // ❌ 錯誤
  data: ['10', '20', '30']  // 字串
  
  // ✅ 正確
  data: [10, 20, 30]  // 數字
  
  // 修復方法
  data: statistics.scoreDistribution.map(val => parseInt(val))
  ```

---

### 重點 3: 會員側統計面板

**應放置位置**: `/public/member/index.html` 中的 `examsTab()` 區塊
```html
<!-- 考試專區頂部新增 -->
<div class="bg-white p-6 rounded-lg shadow mb-6">
    <h3 class="text-lg font-semibold mb-4">我的成績統計</h3>
    
    <!-- 統計卡片網格 -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <!-- 考試次數 -->
        <div class="bg-blue-50 p-4 rounded">
            <p class="text-xs text-gray-600">參加考試</p>
            <p class="text-2xl font-bold text-blue-600" x-text="availableExams.reduce((c, e) => c + e.userAttempts.length, 0)"></p>
            <p class="text-xs text-gray-500">次</p>
        </div>
        
        <!-- 通過次數 -->
        <div class="bg-green-50 p-4 rounded">
            <p class="text-xs text-gray-600">已通過</p>
            <p class="text-2xl font-bold text-green-600" x-text="availableExams.reduce((c, e) => c + e.userAttempts.filter(a => a.passed).length, 0)"></p>
            <p class="text-xs text-gray-500">次</p>
        </div>
        
        <!-- 最高分 -->
        <div class="bg-purple-50 p-4 rounded">
            <p class="text-xs text-gray-600">最高分</p>
            <p class="text-2xl font-bold text-purple-600" x-text="Math.max(...availableExams.flatMap(e => e.userAttempts.map(a => a.score)), 0).toFixed(0)"></p>
            <p class="text-xs text-gray-500">分</p>
        </div>
        
        <!-- 平均分 -->
        <div class="bg-orange-50 p-4 rounded">
            <p class="text-xs text-gray-600">平均分</p>
            <p class="text-2xl font-bold text-orange-600" x-text="(() => { const all = availableExams.flatMap(e => e.userAttempts.map(a => a.score)); return all.length ? (all.reduce((a,b) => a+b) / all.length).toFixed(1) : 0; })()"></p>
            <p class="text-xs text-gray-500">分</p>
        </div>
    </div>
    
    <!-- 通過率進度條 -->
    <div class="mt-4">
        <p class="text-sm text-gray-600 mb-2">通過率</p>
        <div class="h-2 bg-gray-200 rounded">
            <div class="h-full bg-green-600 rounded" :style="{ width: (() => { 
                const passed = availableExams.reduce((c, e) => c + e.userAttempts.filter(a => a.passed).length, 0); 
                const total = availableExams.reduce((c, e) => c + e.userAttempts.length, 0);
                return total === 0 ? '0%' : (passed / total * 100).toFixed(0) + '%';
            })() }"></div>
        </div>
    </div>
</div>
```

**計算邏輯檢查**:
```javascript
// 驗證計算是否正確
const totalAttempts = availableExams.reduce((count, exam) => 
    count + exam.userAttempts.length, 0);

const passedAttempts = availableExams.reduce((count, exam) =>
    count + exam.userAttempts.filter(a => a.passed).length, 0);

const passRate = totalAttempts === 0 ? 0 : (passedAttempts / totalAttempts * 100);

console.log(`總: ${totalAttempts}, 通過: ${passedAttempts}, 通過率: ${passRate.toFixed(1)}%`);
```

---

## 三、後端 API 審計檢查清單

### API 端點完整性驗證

**必須存在的 7 個會員端點**:
```bash
# 1. 獲取可參加的考試
GET /api/member/exams
Authorization: Bearer {token}
Expected: { data: [...], pagination: {...} }

# 2. 開始考試
POST /api/member/exams/{examId}/start
Authorization: Bearer {token}
Expected: { data: { attemptId, questions, expiresAt } }

# 3. 繼續作答
GET /api/member/exams/{examId}/resume
Authorization: Bearer {token}
Expected: { data: { attemptId, questions, answers } }

# 4. 提交考卷
POST /api/member/exams/{examId}/submit
Body: { attemptId, answers, timeSpent, visibilityChangeCount }
Expected: { data: { score, passed, certificateNumber } }

# 5. 獲取我的證書
GET /api/member/certificates
Authorization: Bearer {token}
Expected: { data: [...] }

# 6. 下載證書 PDF
GET /api/member/exams/certificate/{certificateNumber}
Authorization: Bearer {token}
Expected: application/pdf 二進位

# 7. 獲取作答詳情 (歷史查看)
GET /api/member/exams/{examId}/result?attemptId={attemptId}
Authorization: Bearer {token}
Expected: { data: { questionSnapshot, answers, score, passed } }
```

**驗證指令** (使用 Postman 或 curl):
```bash
# 例子: 測試端點 #1
TOKEN="eyJhbGci..."  # 從登入取得
curl -H "Authorization: Bearer $TOKEN" \
     http://localhost:5001/api/member/exams | jq .

# 檢查項目
# - 狀態碼 200
# - 有 data 和 pagination
# - 資料格式正確
```

---

### 回應格式統一性檢查

**所有考試 API 應使用統一格式**:
```javascript
// ✅ 正確格式 (列表)
{
    data: [ { _id, title, ... } ],
    pagination: { total, totalPages, page, limit }
}

// ✅ 正確格式 (單一資源)
{
    data: { _id, title, ... }
}

// ✅ 正確格式 (錯誤)
{
    error: {
        code: "EXAM_NOT_FOUND",
        message: "考試不存在",
        details: {}
    }
}

// ❌ 錯誤格式 (舊風格，不應使用)
{
    message: "錯誤訊息"
}

// ❌ 混合格式 (不統一)
{
    success: true,
    data: { ... }
}
```

**修復方法** (在 routes/member-exams.js 中):
```javascript
// 使用統一的錯誤回應函數
function errorResponse(res, statusCode, code, message, details = {}) {
    return res.status(statusCode).json({
        error: { code, message, details }
    });
}

// 使用方式
router.get('/:id/resume', verifiedAuth, async (req, res) => {
    try {
        const attempt = await ExamAttempt.findOne({ ... });
        if (!attempt) {
            return errorResponse(res, 404, 'EXAM_NOT_FOUND', '考試不存在');
        }
        
        res.json({ data: { attemptId: attempt._id, ... } });
    } catch (err) {
        return errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});
```

---

## 四、常見部署陷阱

### 1. 字體檔案缺失

**症狀**: 證書 PDF 中文顯示為方塊或亂碼

**原因**: `fonts/NotoSansCJKtc-*.ttf` 未包含在部署中

**修復**:
```bash
# 檢查字體檔案是否存在
ls -la /app/fonts/

# 若不存在，確保在 .gitignore 中允許提交
cat .gitignore | grep fonts

# 應該不在 ignore 清單中，或者:
git add fonts/ -f  # 強制添加
```

**或使用 CDN 方案**:
```javascript
// 在 services/examCertificates.js 中
const fontPath = process.env.FONT_CDN_URL 
    ? process.env.FONT_CDN_URL + '/NotoSansCJKtc-Regular.ttf'
    : path.join(__dirname, '../fonts/NotoSansCJKtc-Regular.ttf');
```

---

### 2. 環境變數遺漏

**必須檢查的變數**:
```bash
# 核心
JWT_SECRET=...  # 若缺失, 生產環境會拒絕啟動
MONGO_URI=...   # MongoDB 連接

# 郵件 (可選，但若啟用考試通知必須)
SMTP_HOST=...
SMTP_PORT=...
SMTP_USERNAME=...
SMTP_PASSWORD=...

# Cron 任務安全 (用於自動過期考試)
CRON_SECRET=...
CRON_ALLOWED_IPS=...

# 網站設定
SITE_URL=...  # 用於郵件中的連結
NODE_ENV=production  # 不要設成 development!
```

**檢查方法** (server.js 啟動時):
```bash
# 若缺 JWT_SECRET，應看到錯誤
# Error: JWT_SECRET is required in production

# 若缺其他，應看到警告
# Warning: SMTP not configured, email features disabled
```

---

### 3. MongoDB 連接失敗

**常見原因**:
1. IP 白名單未添加 Render 伺服器 IP
   - 解法: MongoDB Atlas → Network Access → 添加 Render IP

2. 連接字符串錯誤 (密碼特殊字符)
   - 解法: 使用 URI encoding: `password%40123`

3. 資料庫名稱錯誤
   - 檢查: `mongodb+srv://...@.../?retryWrites=true&w=majority` 末尾是否有 `/dbname`

---

### 4. CORS 與 HTTPS 混合內容

**症狀**: 前端無法調用 API, 或 HTTPS 警告

**檢查清單**:
```javascript
// server.js
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',  // ⚠️ 生產環境應指定具體域名
    credentials: true
}));

// HTTPS 強制重定向
if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
        if (req.header('x-forwarded-proto') !== 'https') {
            res.redirect(`https://${req.header('host')}${req.url}`);
        } else {
            next();
        }
    });
}
```

---

## 五、性能優化實踐

### 查詢優化案例

**原始查詢 (N+1 問題)**:
```javascript
// ❌ 不佳: 會執行多次查詢
const exams = await Exam.find({ status: 'active' });
const attempts = {};
for (const exam of exams) {
    attempts[exam._id] = await ExamAttempt.find({ exam: exam._id });
}
```

**優化後**:
```javascript
// ✅ 良好: 只查詢 2 次
const exams = await Exam.find({ status: 'active' });
const examIds = exams.map(e => e._id);
const attempts = await ExamAttempt.find({ exam: { $in: examIds } });

// 構建 map 供前端使用
const attemptsMap = {};
attempts.forEach(a => {
    if (!attemptsMap[a.exam]) attemptsMap[a.exam] = [];
    attemptsMap[a.exam].push(a);
});
```

**欄位投影優化**:
```javascript
// ❌ 加載完整文檔 (包括題目內容等)
const exams = await Exam.find({ status: 'active' });  // 列表中不需要完整題目

// ✅ 只加載必要欄位
const exams = await Exam.find({ status: 'active' })
    .select('title shortDescription timeLimit passingScore certificateEnabled');
```

---

### 前端渲染優化

**Alpine.js 中的常見瓶頸**:
```javascript
// ❌ 不佳: 每次模板更新都重新計算
<p x-text="availableExams.filter(e => e.userAttempts?.length > 0).length"></p>

// ✅ 良好: 預先計算
<p x-text="passedExamsCount"></p>

// 在 init() 中計算一次，或使用 computed
get passedExamsCount() {
    return this.availableExams.filter(e => 
        e.userAttempts?.length > 0
    ).length;
}
```

**循環渲染優化**:
```html
<!-- ❌ 不佳: 無 key binding -->
<template x-for="exam in exams">
    <div x-text="exam.title"></div>
</template>

<!-- ✅ 良好: 有 key binding -->
<template x-for="exam in exams" :key="exam._id">
    <div x-text="exam.title"></div>
</template>
```

---

## 六、偵錯技巧

### 瀏覽器 DevTools

**檢查 API 呼叫**:
1. F12 → Network 標籤
2. 進行考試操作 (開始、提交等)
3. 檢查 Request 與 Response:
   - Status: 應為 200, 401, 或 4xx/5xx
   - Headers: Authorization header 是否存在
   - Payload: 發送的資料格式是否正確
   - Response: 回傳的 JSON 格式是否預期

**檢查記憶體洩漏**:
1. F12 → Memory 標籤
2. Heap Snapshot (堆快照) - 記錄初始狀態
3. 操作頁面 (開啟/關閉考試多次)
4. Heap Snapshot - 記錄現在狀態
5. 比較: 記憶體應回到接近初始值，若一直增長表示洩漏

**檢查效能**:
1. F12 → Performance 標籤
2. 錄製一次考試流程
3. 分析: Long tasks (紅色), 幀率

---

### 後端偵錯

**啟用詳細日誌**:
```bash
# .env 中設置
DEBUG=actc:*
NODE_ENV=development

# 運行時
npm run dev
```

**查看資料庫狀態**:
```bash
# MongoDB shell
mongosh mongodb://...

# 檢查集合大小
db.examinattempts.countDocuments()

# 查看最新記錄
db.examinattempts.find().sort({ _id: -1 }).limit(1)

# 檢查索引是否被使用
db.examinattempts.find(...).explain("executionStats")
```

---

## 七、交付檢查清單

**開發完成後執行**:

```
□ 功能測試
  □ 完整考試流程 1 次
  □ 作弊檢測測試 (切換 11 次視窗)
  □ 計時器測試 (倒計時精確)
  □ 證書下載測試 (PDF 可開啟，中文正確)

□ 程式碼審查
  □ 無 console.log 殘留 (除非為 error 日誌)
  □ 無魔術數字 (應有註解或常數)
  □ Async/await 正確使用
  □ 錯誤處理完整

□ 相容性檢查
  □ Chrome 最新版本
  □ Safari 14+
  □ Firefox 88+
  □ 行動 Chrome (Android)
  □ 行動 Safari (iOS 14+)

□ 效能檢查
  □ API 回應時間 < 2s (P95)
  □ 前端首屏加載 < 2s
  □ 無明顯 jank (FPS 不低於 30)

□ 安全檢查
  □ 無 XSS 漏洞 (HTML 編碼)
  □ 無 SQL 注入 (使用 Mongoose)
  □ JWT token 驗證有效
  □ 敏感資訊未洩露到 localStorage

□ 文件完成
  □ 代碼註解清晰
  □ API 文檔更新
  □ 部署指南完整
  □ 已知問題記錄

□ 生產準備
  □ 環境變數完整
  □ 備份已測試
  □ 監控已配置
  □ 回滾計劃已驗證
```

---

**附註**: 此文件應與開發者分享，並在實裝時持續更新。

