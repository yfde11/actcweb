require('dotenv').config();

if (!process.env.JWT_SECRET) {
    if (process.env.NODE_ENV === 'production') {
        console.error('FATAL: 生產環境必須設定環境變數 JWT_SECRET');
        process.exit(1);
    }
    process.env.JWT_SECRET = 'actc_dev_only_jwt_secret_change_in_env';
}

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
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
const { ensureMongo } = require('./middleware/mongoReady');
const { bootstrapDatabase } = require('./lib/bootstrapDb');

const app = express();
const PORT = process.env.PORT || 5001;
const HOST = process.env.HOST || '0.0.0.0';

// 經 Caddy／Nginx 等反向代理時，正確辨識客戶端 IP 與協定
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

// 中間件（關閉 CSP：前台使用 Tailwind CDN 與內嵌 script）
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// 會員專區（靜態 SPA）
app.get('/member', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'member', 'index.html'));
});
app.get('/member/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'member', 'index.html'));
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
    res.status(404).json({ message: 'Route not found' });
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

    app.listen(PORT, HOST, () => {
        console.log(`🚀 Server listening on http://${HOST}:${PORT} (容器內埠；Docker 時由 Caddy 對外提供 80/443)`);
        console.log('📱 Admin path: /admin（對外請使用 SITE_URL 對應的網址 + /admin）');
    });
})
.catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
});
