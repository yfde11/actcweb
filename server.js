require('dotenv').config();

if (!process.env.JWT_SECRET) {
    if (process.env.NODE_ENV === 'production') {
        console.error('FATAL: 生產環境必須設定環境變數 JWT_SECRET');
        process.exit(1);
    }
    process.env.JWT_SECRET = 'actc_dev_only_jwt_secret_change_in_env';
}

const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');

const authRoutes = require('./routes/auth');
const newsRoutes = require('./routes/news');
const eventsRoutes = require('./routes/events');
const corporateMembersRoutes = require('./routes/corporate-members');
const usersRoutes = require('./routes/users');
const profileRoutes = require('./routes/profile');
const membershipRoutes = require('./routes/membership');
const memberNewsRoutes = require('./routes/member-news');
const memberEventsRoutes = require('./routes/member-events');
const workingGroupsRoutes = require('./routes/working-groups');
const adminWorkingGroupsRoutes = require('./routes/admin-working-groups');
const examRoutes = require('./routes/exams');
const memberExamRoutes = require('./routes/member-exams');
const questionBankRoutes = require('./routes/question-bank');
const cronRoutes = require('./routes/cron');
const adminCertRoutes = require('./routes/admin-certificates');
const adminCertTypeRoutes = require('./routes/admin-certificate-types');
const adminExamAccessRoutes = require('./routes/admin-exam-access');
const { ensureMongo } = require('./middleware/mongoReady');
const { bootstrapDatabase } = require('./lib/bootstrapDb');

const app = express();
const PORT = process.env.PORT || 5001;
const HOST = process.env.HOST || '0.0.0.0';

// 經 Caddy／Nginx 等反向代理時，正確辨識客戶端 IP 與協定
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            // 'unsafe-inline' + 'unsafe-eval' required for Alpine.js CDN build (eval()s x-data expressions)
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://cdn.tailwindcss.com", "https://cdnjs.cloudflare.com", "https://unpkg.com"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdn.tailwindcss.com", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "blob:"],
            fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
        },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
const _corsOrigins = (() => {
    const origins = [];
    if (process.env.SITE_URL) {
        origins.push(process.env.SITE_URL.replace(/\/$/, ''));
    }
    if (process.env.NODE_ENV !== 'production') {
        origins.push(
            'http://localhost:5001',
            'http://localhost:3000',
            'http://127.0.0.1:5001',
            'http://127.0.0.1:3000'
        );
    }
    return origins;
})();

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (_corsOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// API 一律需資料庫已連線（避免登入與後台操作回不明 500）
app.use('/api', ensureMongo);

// 靜態文件服務
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// 路由
app.use('/api/auth', authRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/corporate-members', corporateMembersRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/membership', membershipRoutes);
app.use('/api/member/news', memberNewsRoutes);
app.use('/api/member/events', memberEventsRoutes);
app.use('/api/working-groups', workingGroupsRoutes);
app.use('/api/admin/working-groups', adminWorkingGroupsRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/member/exams', memberExamRoutes);
app.use('/api/question-bank', questionBankRoutes);
app.use('/api/cron', cronRoutes);
app.use('/api/admin/certificates', adminCertRoutes);
app.use('/api/admin/certificate-types', adminCertTypeRoutes);
app.use('/api/admin/exam-access', adminExamAccessRoutes);


// Certificate verification (public)
const { verifyCertificate } = require('./services/examCertificates');
app.get('/api/certificates/verify/:certificateNumber', async (req, res) => {
    try {
        const result = await verifyCertificate(req.params.certificateNumber);
        if (!result.ok) {
            return res.status(result.statusCode).json({ error: { code: result.code, message: result.message } });
        }
        res.json({ data: result.data });
    } catch (error) {
        console.error('Verify certificate error:', error);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '伺服器錯誤' } });
    }
});

// 證書驗證頁面（直接訪問，無證書號碼）
app.get('/verify-certificate', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'verify-certificate.html'));
});

// 證書驗證重定向：PDF QR code 連結至此，重定向至專屬驗證頁面
app.get('/verify-certificate/:certificateNumber', (req, res) => {
    res.redirect(`/pages/verify-certificate.html?verify=${encodeURIComponent(req.params.certificateNumber)}`);
});

// 會員專區（靜態 SPA）
app.get('/member', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'member', 'index.html'));
});
app.get('/member/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'member', 'index.html'));
});

// 獨立考試視窗
app.get('/exam', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'exam.html'));
});

// 首頁路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 管理後台路由
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});





// 新聞相關路由
app.get('/news', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'news.html'));
});

app.get('/news/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'news.html'));
});

app.get('/admin/news', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'admin-news.html'));
});

app.get('/corporate-members', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'corporate-members.html'));
});

app.get('/admin/corporate-members', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'admin-corporate-members.html'));
});

app.get('/admin/certificates', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'certificates.html'));
});
app.get('/admin/certificate-types', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'certificate-types.html'));
});
app.get('/admin/exam-access', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'exam-access.html'));
});

// 其他頁面路由
app.get('/about', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'about.html'));
});

app.get('/workgroups', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'workgroups.html'));
});



app.get('/secretariat', (req, res) => {
    res.redirect('/about');
});

// 404 處理
app.use('*', (req, res) => {
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ message: 'Route not found' });
    }
    res.redirect('/');
});

// 錯誤處理中間件
app.use((err, req, res, next) => {
    console.error(err.stack);
    
    // 處理 Multer 錯誤
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
            message: '檔案大小超過限制，每個檔案最大 5MB'
        });
    }
    
    if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({
            message: '檔案數量超過限制，最多可上傳 3 張圖片和 1 個附件'
        });
    }
    
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({
            message: '意外的檔案欄位'
        });
    }
    
    // 檔案類型錯誤
    if (err.message && err.message.includes('Only')) {
        return res.status(400).json({
            message: err.message
        });
    }
    
    // 一般錯誤
    res.status(500).json({ 
        message: err.message || 'Something went wrong!',
        error: process.env.NODE_ENV === 'development' ? err.message : {}
    });
});

// MongoDB 連接（連線成功後才啟動 HTTP，利於 Docker / 編排等待資料庫）
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/actc_website', {
    family: 4,
    serverSelectionTimeoutMS: parseInt(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || '10000', 10),
})
.then(async () => {
    console.log('✅ Connected to MongoDB');

    try {
        await bootstrapDatabase();
    } catch (err) {
        console.error('❌ Database bootstrap:', err.message);
    }

    // Wire cron job: auto-submit expired exam attempts every 5 minutes
    function callCronEndpoint() {
        const options = {
            hostname: '127.0.0.1',
            port: PORT,
            path: '/api/cron/expired-attempts',
            method: 'POST',
            headers: {
                'X-Cron-Secret': process.env.CRON_SECRET || 'your-cron-secret-here',
                'Content-Type': 'application/json'
            }
        };
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    console.warn(`⚠️  Cron expired-attempts: HTTP ${res.statusCode}`);
                }
            });
        });
        req.on('error', (err) => console.error('Cron expired-attempts error:', err.message));
        req.end();
    }

    setInterval(callCronEndpoint, 5 * 60 * 1000);

    app.listen(PORT, HOST, () => {
        console.log(`🚀 Server listening on http://${HOST}:${PORT} (容器內埠；Docker 時由 Caddy 對外提供 80/443)`);
        console.log('📱 Admin path: /admin（對外請使用 SITE_URL 對應的網址 + /admin）');
        try {
            const { isConfigured } = require('./services/email');
            if (!isConfigured()) {
                console.warn(
                    '⚠️  Email 未設定：信箱驗證信、重設密碼信、會籍通知將不會寄出。請設定 RESEND_API_KEY（推薦）或 SMTP_HOST + SMTP_USERNAME + SMTP_PASSWORD（見 env.docker.example）。'
                );
            }
        } catch {
            /* ignore */
        }
    });
})
.catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
});
