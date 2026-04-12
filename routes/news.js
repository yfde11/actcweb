const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const News = require('../models/News');
const { adminAuth } = require('../middleware/adminAuth');
const { verifiedAuth } = require('../middleware/memberAuth');
const analyticsService = require('../services/googleAnalytics');
const { notifyAudienceByEmail, buildNewsEmailDoc } = require('../services/contentNotifications');

const router = express.Router();

// 確保上傳目錄存在
const uploadsDir = path.join(__dirname, '../uploads');
const imagesDir = path.join(uploadsDir, 'images');
const filesDir = path.join(uploadsDir, 'files');

[uploadsDir, imagesDir, filesDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Multer 配置 - 更新以支援新的欄位結構
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        if (file.fieldname === 'image' || file.fieldname === 'images') {
            cb(null, imagesDir);
        } else if (file.fieldname === 'file') {
            cb(null, filesDir);
        }
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    if (file.fieldname === 'image' || file.fieldname === 'images') {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'), false);
        }
    } else if (file.fieldname === 'file') {
        const allowedTypes = [
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only PPTX, PDF, and DOCX files are allowed'), false);
        }
    } else {
        cb(null, true);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
        files: 5
    }
});

const NOTIFY_AUDIENCES = ['none', 'verified_users', 'approved_members'];

async function notifyIfNewsPublished(news, prevStatus) {
    if (news.status !== 'published' || !NOTIFY_AUDIENCES.includes(news.notifyAudience) || news.notifyAudience === 'none') {
        return;
    }
    if (prevStatus === 'published') return;
    const { subject, html, text } = buildNewsEmailDoc(news);
    try {
        await notifyAudienceByEmail({ audience: news.notifyAudience, subject, html, text });
    } catch (e) {
        console.warn('News notify:', e.message);
    }
}

// ===================
// 公開路由 (前端使用)
// ===================

// 獲取已發布的新聞列表
router.get('/published', async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 10, 
            featured, 
            tag, 
            search 
        } = req.query;

        const filter = { status: 'published' };
        
        // 篩選條件
        if (featured === 'true') {
            filter.featured = true;
        }
        
        if (tag) {
            filter.tags = { $in: [tag.toLowerCase()] };
        }
        
        if (search) {
            filter.$or = [
                { title: { $regex: search, $options: 'i' } },
                { content: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const news = await News.find(filter)
            .sort({ publishDate: -1 })
            .limit(parseInt(limit))
            .skip(skip)
            .populate('author', 'username fullName')
            .select('title summary imageUrl videoUrl videoType publishDate viewCount tags featured analyticsId');

        const total = await News.countDocuments(filter);

        res.json({
            news,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Get published news error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// 獲取單篇新聞詳情並追蹤瀏覽
router.get('/published/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const news = await News.findOne({ _id: id, status: 'published' })
            .populate('author', 'username fullName');
        
        if (!news) {
            return res.status(404).json({ message: 'News not found' });
        }

        // 增加瀏覽次數
        await news.incrementViewCount();

        res.json({
            news,
            trackingCode: analyticsService.generateTrackingCode(news.analyticsId, news.title)
        });
    } catch (error) {
        console.error('Get single news error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// 獲取熱門新聞
router.get('/trending', async (req, res) => {
    try {
        const { limit = 5, days = 7 } = req.query;
        const trendingNews = await analyticsService.getTrendingNews(parseInt(limit), parseInt(days));
        res.json(trendingNews);
    } catch (error) {
        console.error('Get trending news error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// 獲取精選新聞
router.get('/featured', async (req, res) => {
    try {
        const { limit = 5 } = req.query;
        const featuredNews = await News.getFeatured(parseInt(limit));
        res.json(featuredNews);
    } catch (error) {
        console.error('Get featured news error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// 獲取所有標籤
router.get('/tags', async (req, res) => {
    try {
        const tags = await News.aggregate([
            { $match: { status: 'published' } },
            { $unwind: '$tags' },
            { $group: { _id: '$tags', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 20 }
        ]);
        
        res.json(tags.map(tag => ({
            name: tag._id,
            count: tag.count
        })));
    } catch (error) {
        console.error('Get tags error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// ===================
// 管理路由 (需要認證)
// ===================

// 獲取所有新聞 (管理員)
router.get('/admin', adminAuth, async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 20, 
            status, 
            search,
            sortBy = 'createdAt',
            order = 'desc'
        } = req.query;

        const filter = {};
        
        if (status && status !== 'all') {
            filter.status = status;
        }
        
        if (search) {
            filter.$or = [
                { title: { $regex: search, $options: 'i' } },
                { content: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOrder = order === 'desc' ? -1 : 1;
        const sortObj = { [sortBy]: sortOrder };

        const news = await News.find(filter)
            .sort(sortObj)
            .limit(parseInt(limit))
            .skip(skip)
            .populate('author', 'username fullName');

        const total = await News.countDocuments(filter);

        // 獲取統計數據
        const stats = await News.aggregate([
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                    totalViews: { $sum: '$viewCount' }
                }
            }
        ]);

        res.json({
            news,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            },
            stats: stats.reduce((acc, stat) => {
                acc[stat._id] = {
                    count: stat.count,
                    totalViews: stat.totalViews
                };
                return acc;
            }, {})
        });
    } catch (error) {
        console.error('Get admin news error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// 創建新聞 (管理員)
router.post('/admin', adminAuth, upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'images', maxCount: 3 },
    { name: 'file', maxCount: 1 }
]), async (req, res) => {
    try {
        const { 
            title, 
            content, 
            description, 
            videoUrl, 
            publishDate, 
            status = 'draft',
            tags,
            featured = false,
            notifyAudience = 'none'
        } = req.body;
        
        // 驗證必填字段
        if (!title || !content) {
            return res.status(400).json({
                message: 'Title and content are required'
            });
        }

        if (!NOTIFY_AUDIENCES.includes(notifyAudience)) {
            return res.status(400).json({ message: 'notifyAudience 無效' });
        }

        // 處理上傳的圖片
        let imageUrl = '';
        let images = [];
        
        if (req.files?.image) {
            imageUrl = `/uploads/images/${req.files.image[0].filename}`;
        }
        
        if (req.files?.images) {
            images = req.files.images.map(file => `/uploads/images/${file.filename}`);
        }

        // 處理附件
        const file = req.files?.file?.[0] ? 
            `/uploads/files/${req.files.file[0].filename}` : '';

        // 處理標籤
        const tagsArray = tags ? 
            (Array.isArray(tags) ? tags : tags.split(','))
                .map(tag => tag.trim().toLowerCase())
                .filter(tag => tag.length > 0) 
            : [];

        // 創建新聞
        const news = new News({
            title,
            content,
            description: description || content.substring(0, 200) + '...',
            imageUrl,
            videoUrl: videoUrl || '',
            publishDate: publishDate ? new Date(publishDate) : new Date(),
            status,
            tags: tagsArray,
            featured: featured === 'true' || featured === true,
            author: req.user.userId,
            // 保留舊欄位以向後兼容
            date: publishDate ? new Date(publishDate) : new Date(),
            images,
            file,
            notifyAudience
        });

        const prevStatus = 'draft';
        await news.save();

        // 獲取完整資訊
        const populatedNews = await News.findById(news._id)
            .populate('author', 'username fullName');

        await notifyIfNewsPublished(populatedNews, prevStatus);

        res.status(201).json({
            message: 'News created successfully',
            news: populatedNews
        });

    } catch (error) {
        console.error('Create news error:', error);
        handleFileUploadError(error, req, res);
    }
});

// 更新新聞 (管理員)
router.put('/admin/:id', adminAuth, upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'images', maxCount: 3 },
    { name: 'file', maxCount: 1 }
]), async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            title, 
            content, 
            description, 
            imageUrl: newImageUrl,
            videoUrl, 
            publishDate, 
            status,
            tags,
            featured,
            removeImage = false,
            notifyAudience
        } = req.body;
        
        // 查找新聞
        const news = await News.findById(id);
        if (!news) {
            return res.status(404).json({ message: 'News not found' });
        }

        const prevStatus = news.status;

        if (notifyAudience !== undefined && !NOTIFY_AUDIENCES.includes(notifyAudience)) {
            return res.status(400).json({ message: 'notifyAudience 無效' });
        }

        // 處理圖片更新
        let imageUrl = news.imageUrl;
        let images = news.images;

        // 處理直接傳入的 imageUrl（JSON 請求）
        if (newImageUrl !== undefined && newImageUrl !== imageUrl) {
            imageUrl = newImageUrl;
        }

        if (removeImage === 'true' || removeImage === true) {
            // 刪除舊圖片
            if (imageUrl) {
                const oldImagePath = path.join(__dirname, '..', imageUrl);
                if (fs.existsSync(oldImagePath)) {
                    fs.unlinkSync(oldImagePath);
                }
            }
            imageUrl = '';
        }

        if (req.files?.image) {
            // 刪除舊圖片
            if (imageUrl) {
                const oldImagePath = path.join(__dirname, '..', imageUrl);
                if (fs.existsSync(oldImagePath)) {
                    fs.unlinkSync(oldImagePath);
                }
            }
            imageUrl = `/uploads/images/${req.files.image[0].filename}`;
        }

        if (req.files?.images) {
            // 刪除舊圖片
            images.forEach(imgPath => {
                const fullPath = path.join(__dirname, '..', imgPath);
                if (fs.existsSync(fullPath)) {
                    fs.unlinkSync(fullPath);
                }
            });
            images = req.files.images.map(file => `/uploads/images/${file.filename}`);
        }

        // 處理附件更新
        let file = news.file;
        if (req.files?.file) {
            if (file) {
                const oldFilePath = path.join(__dirname, '..', file);
                if (fs.existsSync(oldFilePath)) {
                    fs.unlinkSync(oldFilePath);
                }
            }
            file = `/uploads/files/${req.files.file[0].filename}`;
        }

        // 處理標籤
        const tagsArray = tags ? 
            (Array.isArray(tags) ? tags : tags.split(','))
                .map(tag => tag.trim().toLowerCase())
                .filter(tag => tag.length > 0) 
            : news.tags;

        // 更新新聞
        const updateData = {
            title: title || news.title,
            content: content || news.content,
            description: description || news.description,
            videoUrl: videoUrl !== undefined ? videoUrl : news.videoUrl,
            publishDate: publishDate ? new Date(publishDate) : news.publishDate,
            status: status || news.status,
            tags: tagsArray,
            featured: featured !== undefined ? (featured === 'true' || featured === true) : news.featured,
            // 更新舊欄位
            date: publishDate ? new Date(publishDate) : news.date,
            images,
            file
        };

        if (notifyAudience !== undefined) {
            updateData.notifyAudience = notifyAudience;
        }

        // 只在 imageUrl 有變化時才更新
        if (imageUrl !== news.imageUrl) {
            updateData.imageUrl = imageUrl;
        }

        const updatedNews = await News.findByIdAndUpdate(id, updateData, { 
            new: true, 
            runValidators: true 
        }).populate('author', 'username fullName');

        await notifyIfNewsPublished(updatedNews, prevStatus);

        res.json({
            message: 'News updated successfully',
            news: updatedNews
        });

    } catch (error) {
        console.error('Update news error:', error);
        handleFileUploadError(error, req, res);
    }
});

// 刪除新聞 (管理員)
router.delete('/admin/:id', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        const news = await News.findById(id);
        if (!news) {
            return res.status(404).json({ message: 'News not found' });
        }

        // 刪除相關文件
        const filesToDelete = [];
        
        if (news.imageUrl) filesToDelete.push(news.imageUrl);
        if (news.images) filesToDelete.push(...news.images);
        if (news.file) filesToDelete.push(news.file);

        filesToDelete.forEach(filePath => {
            const fullPath = path.join(__dirname, '..', filePath);
            if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath);
            }
        });

        // 刪除新聞
        await News.findByIdAndDelete(id);

        res.json({ message: 'News deleted successfully' });

    } catch (error) {
        console.error('Delete news error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// 批量操作 (管理員)
router.post('/admin/batch', adminAuth, async (req, res) => {
    try {
        const { action, ids, data } = req.body;
        
        if (!action || !ids || !Array.isArray(ids)) {
            return res.status(400).json({ 
                message: 'Action and IDs array are required' 
            });
        }

        let result;
        
        switch (action) {
            case 'delete':
                // 批量刪除
                const newsToDelete = await News.find({ _id: { $in: ids } });
                
                // 刪除文件
                for (const news of newsToDelete) {
                    const filesToDelete = [];
                    if (news.imageUrl) filesToDelete.push(news.imageUrl);
                    if (news.images) filesToDelete.push(...news.images);
                    if (news.file) filesToDelete.push(news.file);

                    filesToDelete.forEach(filePath => {
                        const fullPath = path.join(__dirname, '..', filePath);
                        if (fs.existsSync(fullPath)) {
                            fs.unlinkSync(fullPath);
                        }
                    });
                }
                
                result = await News.deleteMany({ _id: { $in: ids } });
                break;
                
            case 'updateStatus':
                if (!data || !data.status) {
                    return res.status(400).json({ 
                        message: 'Status is required for updateStatus action' 
                    });
                }
                result = await News.updateMany(
                    { _id: { $in: ids } },
                    { $set: { status: data.status } }
                );
                break;
                
            case 'toggleFeatured':
                const newsItems = await News.find({ _id: { $in: ids } });
                for (const news of newsItems) {
                    news.featured = !news.featured;
                    await news.save();
                }
                result = { modifiedCount: newsItems.length };
                break;
                
            default:
                return res.status(400).json({ 
                    message: 'Invalid action. Supported actions: delete, updateStatus, toggleFeatured' 
                });
        }

        res.json({
            message: `Batch ${action} completed successfully`,
            modifiedCount: result.modifiedCount || result.deletedCount
        });

    } catch (error) {
        console.error('Batch operation error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// 更新瀏覽次數 (Google Analytics)
router.post('/admin/update-analytics', adminAuth, async (req, res) => {
    try {
        const { days = 7 } = req.body;
        const result = await analyticsService.updateNewsViewCounts(days);
        res.json(result);
    } catch (error) {
        console.error('Update analytics error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// 獲取 Analytics 狀態
router.get('/admin/analytics-status', adminAuth, async (req, res) => {
    try {
        const status = analyticsService.getStatus();
        res.json(status);
    } catch (error) {
        console.error('Get analytics status error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// ===================
// 向後兼容的舊路由
// ===================

// 舊的獲取所有新聞路由 (保持向後兼容)
router.get('/', async (req, res) => {
    try {
        const news = await News.find({ status: 'published' })
            .sort({ publishDate: -1, createdAt: -1 })
            .select('-__v')
            .limit(20);

        res.json(news);
    } catch (error) {
        console.error('Get news error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// 舊的創建新聞路由 (保持向後兼容)
router.post('/', verifiedAuth, upload.fields([
    { name: 'images', maxCount: 3 },
    { name: 'file', maxCount: 1 }
]), async (req, res) => {
    try {
        const { title, description, date, link } = req.body;
        
        if (!title || !description) {
            return res.status(400).json({
                message: 'Title and description are required'
            });
        }

        const images = req.files?.images?.map(file => 
            `/uploads/images/${file.filename}`) || [];
        const file = req.files?.file?.[0] ? 
            `/uploads/files/${req.files.file[0].filename}` : '';

        const news = new News({
            title,
            description,
            content: description, // 將 description 也設為 content
            date: date ? new Date(date) : new Date(),
            publishDate: date ? new Date(date) : new Date(),
            status: 'published', // 舊 API 預設為已發布
            images,
            file,
            link: link || '',
            author: req.authUser._id,
            notifyAudience: 'none'
        });

        await news.save();

        res.status(201).json({
            message: 'News created successfully',
            news
        });

    } catch (error) {
        console.error('Create news error:', error);
        handleFileUploadError(error, req, res);
    }
});

// 錯誤處理輔助函數
function handleFileUploadError(error, req, res) {
    // 清理上傳的文件
    if (error.message.includes('Only') && req.files) {
        Object.values(req.files).flat().forEach(file => {
            fs.unlink(file.path, (err) => {
                if (err) console.error('Error deleting file:', err);
            });
        });
    }

    let errorMessage = 'Internal server error';
    let statusCode = 500;

    if (error.code === 'LIMIT_FILE_SIZE') {
        errorMessage = '檔案大小超過限制，每個檔案最大 5MB';
        statusCode = 400;
    } else if (error.code === 'LIMIT_FILE_COUNT') {
        errorMessage = '檔案數量超過限制，最多可上傳 5 個檔案';
        statusCode = 400;
    } else if (error.message.includes('Only')) {
        errorMessage = error.message;
        statusCode = 400;
    } else if (error.name === 'ValidationError') {
        errorMessage = Object.values(error.errors).map(e => e.message).join(', ');
        statusCode = 400;
    } else if (error.message) {
        errorMessage = error.message;
    }

    res.status(statusCode).json({ message: errorMessage });
}

module.exports = router;