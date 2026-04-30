const express = require('express');
const mongoose = require('mongoose');
const Event = require('../models/Event');
const EventRegistration = require('../models/EventRegistration');
const EventMaterial = require('../models/EventMaterial');
const EventSurveyResponse = require('../models/EventSurveyResponse');
const NotificationLog = require('../models/NotificationLog');
const {
    enrichEventsWithWaitlistCounts,
    cancelEventRegistration,
    recalculateRegisteredCount,
    normalizeLegacyStatus,
    deleteEventRegistrationRecord
} = require('../services/eventRegistrations');
const { adminAuth } = require('../middleware/adminAuth');
const { notifyAudienceByEmail, buildEventEmailDoc } = require('../services/contentNotifications');
const { sendEventNotification } = require('../services/eventNotifications');

function normalizeUploadedFilename(name) {
    if (!name) return '';
    const raw = String(name);
    try {
        return Buffer.from(raw, 'latin1').toString('utf8');
    } catch {
        return raw;
    }
}
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();
const PAYMENT_STATUSES = ['none', 'payment_pending', 'payment_submitted', 'paid', 'payment_rejected', 'refunded'];

function parseTaipeiLocalToUtc(input) {
    if (!input) return undefined;

    if (input instanceof Date) {
        return input;
    }

    if (typeof input !== 'string') {
        return new Date(input);
    }

    // datetime-local (YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss) should be
    // interpreted as Asia/Taipei local time, then converted to UTC for storage.
    const localMatch = input.match(
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
    );

    if (!localMatch) {
        return new Date(input);
    }

    const year = Number(localMatch[1]);
    const month = Number(localMatch[2]);
    const day = Number(localMatch[3]);
    const hour = Number(localMatch[4]);
    const minute = Number(localMatch[5]);
    const second = Number(localMatch[6] || 0);
    const taipeiOffsetMinutes = 8 * 60;

    const utcMs = Date.UTC(year, month - 1, day, hour, minute, second) - (taipeiOffsetMinutes * 60 * 1000);
    return new Date(utcMs);
}

// 配置 multer 用於檔案上傳
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        let uploadPath;
        
        if (file.fieldname === 'image' || file.fieldname === 'instructorPhoto') {
            uploadPath = 'uploads/images/';
        } else if (file.fieldname === 'file') {
            uploadPath = 'uploads/files/';
        } else {
            uploadPath = 'uploads/';
        }
        
        // 確保目錄存在
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        // 生成唯一檔名
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});

const fileFilter = (req, file, cb) => {
    if (file.fieldname === 'image' || file.fieldname === 'instructorPhoto') {
        // 圖片檔案類型檢查
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed for image fields'), false);
        }
    } else if (file.fieldname === 'file') {
        // 一般檔案類型檢查（20MB限制）
        if (file.size > 20 * 1024 * 1024) {
            cb(new Error('File size cannot exceed 20MB'), false);
        } else {
            cb(null, true);
        }
    } else {
        cb(null, true);
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 20 * 1024 * 1024 // 20MB
    }
});

const MATERIAL_ALLOWED_MIME_TYPES = new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
    'application/x-zip-compressed',
    'text/markdown',
    'text/plain',
    'image/png',
    'image/jpeg'
]);

const materialStorage = multer.diskStorage({
    destination: function materialDestination(req, file, cb) {
        const uploadPath = 'uploads/event-materials/';
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: function materialFilename(req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname || '');
        cb(null, `material-${uniqueSuffix}${ext}`);
    }
});

const materialUpload = multer({
    storage: materialStorage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: function materialFileFilter(req, file, cb) {
        if (MATERIAL_ALLOWED_MIME_TYPES.has(file.mimetype)) {
            return cb(null, true);
        }
        cb(new Error('Unsupported material file type'), false);
    }
});

const NOTIFY_AUDIENCES = ['none', 'verified_users', 'approved_members'];

function normalizeParticipantEmail(email) {
    return EventRegistration.normalizeEmail(email);
}

function normalizeRegistrationDoc(reg) {
    if (!reg) return reg;
    const plain = typeof reg.toObject === 'function' ? reg.toObject({ virtuals: true }) : { ...reg };
    plain.status = normalizeLegacyStatus(plain.status);
    if (plain.participantName == null && plain.name != null) {
        plain.participantName = plain.name;
    }
    if (plain.participantEmail == null && plain.email != null) {
        plain.participantEmail = EventRegistration.normalizeEmail(plain.email);
    }
    if (plain.participantPhone == null && plain.phone != null) {
        plain.participantPhone = plain.phone;
    }
    if (plain.organization == null && plain.org != null) {
        plain.organization = plain.org;
    }
    if (plain.adminNote == null) {
        plain.adminNote = '';
    }
    return plain;
}

async function notifyIfEventPublished(event, prevStatus) {
    const pub = ['published', 'registration_open', 'registration_closed'].includes(event.status);
    if (!pub || !NOTIFY_AUDIENCES.includes(event.notifyAudience) || event.notifyAudience === 'none') return;
    if (['published', 'registration_open', 'registration_closed'].includes(prevStatus)) return;
    const { subject, html, text } = buildEventEmailDoc(event);
    try {
        await notifyAudienceByEmail({ audience: event.notifyAudience, subject, html, text });
    } catch (e) {
        console.warn('Event notify:', e.message);
    }
}

// 獲取所有活動 (公開)
router.get('/', async (req, res) => {
    try {
        const { 
            type, 
            status, 
            search, 
            tags, 
            upcoming, 
            page = 1, 
            limit = 10,
            sortBy = 'date',
            sortOrder = 'asc'
        } = req.query;

        // 建立查詢條件
        let query = {};
        
        // 類型篩選
        if (type) {
            query.type = type;
        }
        
        // 狀態篩選 (公開 API 只顯示已發布的活動)
        query.status = { $in: ['published', 'registration_open', 'registration_closed'] };
        
        // 搜尋功能
        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } },
                { shortDescription: { $regex: search, $options: 'i' } },
                { 'instructor.name': { $regex: search, $options: 'i' } },
                { location: { $regex: search, $options: 'i' } }
            ];
        }
        
        // 標籤篩選
        if (tags) {
            const tagArray = tags.split(',').map(tag => tag.trim());
            query.tags = { $in: tagArray };
        }
        
        // 即將到來的活動
        if (upcoming === 'true') {
            query.date = { $gte: new Date() };
        }

        // 排序
        let sortOptions = {};
        if (sortBy === 'date') {
            sortOptions.date = sortOrder === 'desc' ? -1 : 1;
        } else if (sortBy === 'title') {
            sortOptions.title = sortOrder === 'desc' ? -1 : 1;
        } else if (sortBy === 'createdAt') {
            sortOptions.createdAt = sortOrder === 'desc' ? -1 : 1;
        }
        
        // 分頁
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        // 執行查詢
        const events = await Event.find(query)
            .sort(sortOptions)
            .skip(skip)
            .limit(parseInt(limit))
            .select('-__v');

        const eventsOut = await enrichEventsWithWaitlistCounts(events);
        
        // 獲取總數
        const total = await Event.countDocuments(query);
        
        res.json({
            events: eventsOut,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / parseInt(limit)),
                totalItems: total,
                itemsPerPage: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Get events error:', error);
        res.status(500).json({
            message: 'Internal server error'
        });
    }
});

// 獲取所有活動 (管理員用)
router.get('/admin', adminAuth, async (req, res) => {
    try {
        const { 
            type, 
            status, 
            search, 
            tags, 
            page = 1, 
            limit = 10,
            sortBy = 'date',
            sortOrder = 'asc'
        } = req.query;

        // 建立查詢條件
        let query = {};
        
        // 類型篩選
        if (type) {
            query.type = type;
        }
        
        // 狀態篩選 (管理員可以看到所有狀態)
        if (status) {
            query.status = status;
        }
        
        // 搜尋功能
        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } },
                { shortDescription: { $regex: search, $options: 'i' } },
                { 'instructor.name': { $regex: search, $options: 'i' } },
                { location: { $regex: search, $options: 'i' } }
            ];
        }
        
        // 標籤篩選
        if (tags) {
            const tagArray = tags.split(',').map(tag => tag.trim());
            query.tags = { $in: tagArray };
        }

        // 排序
        let sortOptions = {};
        if (sortBy === 'date') {
            sortOptions.date = sortOrder === 'desc' ? -1 : 1;
        } else if (sortBy === 'title') {
            sortOptions.title = sortOrder === 'desc' ? -1 : 1;
        } else if (sortBy === 'createdAt') {
            sortOptions.createdAt = sortOrder === 'desc' ? -1 : 1;
        }
        
        // 分頁
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        // 執行查詢
        const events = await Event.find(query)
            .sort(sortOptions)
            .skip(skip)
            .limit(parseInt(limit))
            .select('-__v');

        const eventsOut = await enrichEventsWithWaitlistCounts(events);
        
        // 獲取總數
        const total = await Event.countDocuments(query);
        
        res.json({
            events: eventsOut,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / parseInt(limit)),
                totalItems: total,
                itemsPerPage: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Get admin events error:', error);
        res.status(500).json({
            message: 'Internal server error'
        });
    }
});

// 獲取活動統計資訊 (管理員用)
router.get('/stats', adminAuth, async (req, res) => {
    try {
        const stats = await Event.aggregate([
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 }
                }
            }
        ]);
        
        const totalEvents = await Event.countDocuments();
        const upcomingEvents = await Event.countDocuments({
            date: { $gte: new Date() },
            status: { $in: ['published', 'registration_open'] }
        });
        
        // 新增檔案和圖片統計
        const eventsWithFiles = await Event.countDocuments({ 'file.path': { $exists: true, $ne: null } });
        const eventsWithImages = await Event.countDocuments({ 'image': { $exists: true, $ne: null } });
        
        res.json({
            totalEvents,
            upcomingEvents,
            eventsWithFiles,
            eventsWithImages,
            statusBreakdown: stats
        });
    } catch (error) {
        console.error('Get events stats error:', error);
        res.status(500).json({
            message: 'Internal server error'
        });
    }
});

// 創建活動 (需要認證，支援檔案上傳)
router.post('/', adminAuth, upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'file', maxCount: 1 },
    { name: 'instructorPhoto', maxCount: 1 }
]), async (req, res) => {
    try {
        const { 
            title, 
            type, 
            description, 
            shortDescription,
            date, 
            endDate,
            location, 
            virtualLocation,
            link,
            instructor,
            duration,
            capacity,
            price,
            status,
            tags,
            requirements,
            materials,
            notifyAudience = 'none'
        } = req.body;
        
        // 驗證必填字段
        if (!title || !type || !description || !date || !location) {
            return res.status(400).json({
                message: 'Title, type, description, date, and location are required'
            });
        }

        // 驗證活動類型
        const validTypes = ['meetup', 'workshop', 'course', 'conference', 'training', 'others'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({
                message: 'Invalid event type. Must be one of: ' + validTypes.join(', ')
            });
        }

        // 驗證狀態
        const validStatuses = ['draft', 'published', 'registration_open', 'registration_closed', 'cancelled', 'completed'];
        if (status && !validStatuses.includes(status)) {
            return res.status(400).json({
                message: 'Invalid status. Must be one of: ' + validStatuses.join(', ')
            });
        }

        if (!NOTIFY_AUDIENCES.includes(notifyAudience)) {
            return res.status(400).json({ message: 'notifyAudience 無效' });
        }

        // 處理檔案上傳
        let eventData = {
            title,
            type,
            description,
            shortDescription,
            date: parseTaipeiLocalToUtc(date),
            endDate: endDate ? parseTaipeiLocalToUtc(endDate) : undefined,
            location,
            virtualLocation,
            link: link || '',
            instructor: instructor ? JSON.parse(instructor) : {},
            duration: duration ? JSON.parse(duration) : {},
            capacity: capacity || undefined,
            price: price ? JSON.parse(price) : { isFree: true },
            status: status || 'draft',
            tags: tags ? JSON.parse(tags) : [],
            requirements,
            materials: materials ? JSON.parse(materials) : [],
            createdBy: req.user.userId,
            notifyAudience
        };

        // 處理活動圖片
        if (req.files && req.files.image) {
            eventData.image = '/' + req.files.image[0].path;
        }

        // 處理活動檔案
        if (req.files && req.files.file) {
            eventData.file = {
                path: '/' + req.files.file[0].path,
                originalName: normalizeUploadedFilename(req.files.file[0].originalname),
                size: req.files.file[0].size,
                mimeType: req.files.file[0].mimetype
            };
        }

        // 處理講師照片
        if (req.files && req.files.instructorPhoto && eventData.instructor) {
            eventData.instructor.photo = '/' + req.files.instructorPhoto[0].path;
        }

        // 創建活動
        const event = new Event(eventData);
        const prevStatus = 'draft';
        await event.save();
        await notifyIfEventPublished(event, prevStatus);

        res.status(201).json({
            message: 'Event created successfully',
            event
        });

    } catch (error) {
        console.error('Create event error:', error);
        
        // 處理不同類型的錯誤
        let errorMessage = 'Internal server error';
        let statusCode = 500;

        if (error.name === 'ValidationError') {
            errorMessage = Object.values(error.errors).map(e => e.message).join(', ');
            statusCode = 400;
        } else if (error.message) {
            errorMessage = error.message;
            statusCode = 400;
        }

        res.status(statusCode).json({
            message: errorMessage
        });
    }
});

// 更新活動 (需要認證，支援檔案上傳)
router.put('/:id', adminAuth, upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'file', maxCount: 1 },
    { name: 'instructorPhoto', maxCount: 1 }
]), async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;
        
        // 查找活動
        const event = await Event.findById(id);
        if (!event) {
            return res.status(404).json({
                message: 'Event not found'
            });
        }

        const prevStatus = event.status;

        // 驗證活動類型（如果提供）
        if (updateData.type) {
            const validTypes = ['meetup', 'workshop', 'course', 'conference', 'training', 'others'];
            if (!validTypes.includes(updateData.type)) {
                return res.status(400).json({
                    message: 'Invalid event type. Must be one of: ' + validTypes.join(', ')
                });
            }
        }

        // 驗證狀態（如果提供）
        if (updateData.status) {
            const validStatuses = ['draft', 'published', 'registration_open', 'registration_closed', 'cancelled', 'completed'];
            if (!validStatuses.includes(updateData.status)) {
                return res.status(400).json({
                    message: 'Invalid status. Must be one of: ' + validStatuses.join(', ')
                });
            }
        }

        // 處理日期欄位
        if (updateData.date) {
            updateData.date = parseTaipeiLocalToUtc(updateData.date);
        }
        if (Object.prototype.hasOwnProperty.call(updateData, 'endDate')) {
            if (updateData.endDate && String(updateData.endDate).trim() !== '') {
                updateData.endDate = parseTaipeiLocalToUtc(updateData.endDate);
            } else {
                updateData.endDate = null;
            }
        }
        if (Object.prototype.hasOwnProperty.call(updateData, '_id')) {
            delete updateData._id;
        }
        if (Object.prototype.hasOwnProperty.call(updateData, 'id')) {
            delete updateData.id;
        }

        // 處理 JSON 欄位
        if (updateData.instructor) {
            updateData.instructor = JSON.parse(updateData.instructor);
        }
        if (updateData.duration) {
            updateData.duration = JSON.parse(updateData.duration);
        }
        if (updateData.price) {
            updateData.price = JSON.parse(updateData.price);
        }
        if (updateData.tags) {
            updateData.tags = JSON.parse(updateData.tags);
        }
        if (updateData.materials) {
            updateData.materials = JSON.parse(updateData.materials);
        }

        if (updateData.notifyAudience !== undefined && !NOTIFY_AUDIENCES.includes(updateData.notifyAudience)) {
            return res.status(400).json({ message: 'notifyAudience 無效' });
        }

        // 處理檔案上傳
        if (req.files && req.files.image) {
            updateData.image = '/' + req.files.image[0].path;
            
            // 刪除舊圖片
            if (event.image && fs.existsSync(event.image.substring(1))) {
                fs.unlinkSync(event.image.substring(1));
            }
        }

        if (req.files && req.files.file) {
            updateData.file = {
                path: '/' + req.files.file[0].path,
                originalName: normalizeUploadedFilename(req.files.file[0].originalname),
                size: req.files.file[0].size,
                mimeType: req.files.file[0].mimetype
            };
            
            // 刪除舊檔案
            if (event.file && event.file.path && fs.existsSync(event.file.path.substring(1))) {
                fs.unlinkSync(event.file.path.substring(1));
            }
        }

        if (req.files && req.files.instructorPhoto && updateData.instructor) {
            updateData.instructor.photo = '/' + req.files.instructorPhoto[0].path;
            
            // 刪除舊講師照片
            if (event.instructor && event.instructor.photo && fs.existsSync(event.instructor.photo.substring(1))) {
                fs.unlinkSync(event.instructor.photo.substring(1));
            }
        }

        // 使用文件 save() 取代 findByIdAndUpdate，否則 endDate 的 v>=this.date 在「更新驗證」時
        // 看不到 DB 內的 date，this.date 變成 undefined 會一直誤判。
        event.set(updateData);
        const updatedEvent = await event.save();

        await notifyIfEventPublished(updatedEvent, prevStatus);

        res.json({
            message: 'Event updated successfully',
            event: updatedEvent
        });

    } catch (error) {
        console.error('Update event error:', error);
        
        // 處理不同類型的錯誤
        let errorMessage = 'Internal server error';
        let statusCode = 500;

        if (error.name === 'ValidationError') {
            errorMessage = Object.values(error.errors).map(e => e.message).join(', ');
            statusCode = 400;
        } else if (error.message) {
            errorMessage = error.message;
            statusCode = 400;
        }

        res.status(statusCode).json({
            message: errorMessage
        });
    }
});

// 刪除活動 (需要認證)
router.delete('/:id', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        // 查找活動
        const event = await Event.findById(id);
        if (!event) {
            return res.status(404).json({
                message: 'Event not found'
            });
        }

        // 刪除相關檔案
        if (event.image && fs.existsSync(event.image.substring(1))) {
            fs.unlinkSync(event.image.substring(1));
        }
        
        if (event.file && event.file.path && fs.existsSync(event.file.path.substring(1))) {
            fs.unlinkSync(event.file.path.substring(1));
        }
        
        if (event.instructor && event.instructor.photo && fs.existsSync(event.instructor.photo.substring(1))) {
            fs.unlinkSync(event.instructor.photo.substring(1));
        }

        await EventRegistration.deleteMany({ event: id });

        // 刪除活動
        await Event.findByIdAndDelete(id);

        res.json({
            message: 'Event deleted successfully'
        });

    } catch (error) {
        console.error('Delete event error:', error);
        res.status(500).json({
            message: 'Internal server error'
        });
    }
});

// 報名名單與候補筆數（管理員）
router.get('/:id/registrations', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, paymentStatus, attendanceStatus, search } = req.query;
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ message: 'Invalid event id' });
        }
        const event = await Event.findById(id).select('title status');
        if (!event) {
            return res.status(404).json({ message: 'Event not found' });
        }

        const query = { event: id };
        if (status) query.status = status;
        if (paymentStatus) query.paymentStatus = paymentStatus;
        if (attendanceStatus) query.attendanceStatus = attendanceStatus;
        if (search) {
            query.$or = [
                { participantName: { $regex: search, $options: 'i' } },
                { participantEmail: { $regex: search, $options: 'i' } },
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { participantPhone: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } },
                { organization: { $regex: search, $options: 'i' } }
            ];
        }

        const eventOid = new mongoose.Types.ObjectId(String(id));
        const aggMatch = { ...query, event: eventOid };
        const [regs, summaryRaw] = await Promise.all([
            EventRegistration.find(query)
                .sort({ status: 1, waitlistPosition: 1, createdAt: 1 })
                .lean(),
            EventRegistration.aggregate([
                { $match: aggMatch },
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        registered: { $sum: { $cond: [{ $in: ['$status', ['registered', 'confirmed']] }, 1, 0] } },
                        waitlisted: { $sum: { $cond: [{ $in: ['$status', ['waitlisted', 'waitlist']] }, 1, 0] } },
                        cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
                        payment_pending: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'payment_pending'] }, 1, 0] } },
                        payment_submitted: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'payment_submitted'] }, 1, 0] } },
                        paid: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'paid'] }, 1, 0] } },
                        attended: { $sum: { $cond: [{ $eq: ['$attendanceStatus', 'attended'] }, 1, 0] } },
                        no_show: { $sum: { $cond: [{ $eq: ['$attendanceStatus', 'no_show'] }, 1, 0] } }
                    }
                }
            ])
        ]);

        const summary = summaryRaw[0] || {
            total: 0,
            registered: 0,
            waitlisted: 0,
            cancelled: 0,
            payment_pending: 0,
            payment_submitted: 0,
            paid: 0,
            attended: 0,
            no_show: 0
        };

        res.json({
            eventId: id,
            title: event.title,
            registeredCountFromRegistrations: summary.registered || 0,
            waitlistCount: summary.waitlisted || 0,
            summary,
            registrations: regs.map((r) => normalizeRegistrationDoc(r))
        });
    } catch (error) {
        console.error('Get event registrations error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// 更新單筆報名紀錄（管理員）
router.patch('/:eventId/registrations/:registrationId', adminAuth, async (req, res) => {
    try {
        const { eventId, registrationId } = req.params;
        const event = await Event.findById(eventId).select('_id');
        if (!event) {
            return res.status(404).json({ message: 'Event not found' });
        }

        const reg = await EventRegistration.findOne({ _id: registrationId, event: event._id });
        if (!reg) {
            return res.status(404).json({ message: 'Registration not found' });
        }

        const update = {};
        if (Object.prototype.hasOwnProperty.call(req.body, 'paymentStatus')) {
            if (!PAYMENT_STATUSES.includes(req.body.paymentStatus)) {
                return res.status(400).json({
                    message: 'Invalid paymentStatus. Must be one of: ' + PAYMENT_STATUSES.join(', ')
                });
            }
            update.paymentStatus = req.body.paymentStatus;
        }

        if (Object.prototype.hasOwnProperty.call(req.body, 'adminNote')) {
            update.adminNote = String(req.body.adminNote || '').trim();
        }

        if (Object.keys(update).length === 0) {
            return res.status(400).json({ message: 'No valid fields to update' });
        }

        Object.assign(reg, update);
        await reg.save();

        res.json({
            message: 'Registration updated successfully',
            registration: normalizeRegistrationDoc(reg)
        });
    } catch (error) {
        console.error('Update event registration error:', error);
        if (error.name === 'ValidationError') {
            return res.status(400).json({ message: error.message });
        }
        res.status(500).json({ message: 'Internal server error' });
    }
});

// 移除單筆報名紀錄（管理員）
router.delete('/:eventId/registrations/:registrationId', adminAuth, async (req, res) => {
    try {
        const { eventId, registrationId } = req.params;
        const event = await Event.findById(eventId);
        if (!event) {
            return res.status(404).json({ message: 'Event not found' });
        }

        const reg = await EventRegistration.findOne({ _id: registrationId, event: event._id });
        if (!reg) {
            return res.status(404).json({ message: 'Registration not found' });
        }

        const result = await deleteEventRegistrationRecord(event, reg);
        res.json({
            message: 'Registration removed successfully',
            registrationStatus: result.registrationStatus,
            event: result.event
        });
    } catch (error) {
        console.error('Delete event registration error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// 獲取單個活動 (公開)
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const event = await Event.findById(id).select('-__v');
        
        if (!event) {
            return res.status(404).json({
                message: 'Event not found'
            });
        }

        // 檢查活動狀態
        if (!['published', 'registration_open', 'registration_closed'].includes(event.status)) {
            return res.status(404).json({
                message: 'Event not found'
            });
        }

        // 增加瀏覽次數
        event.views += 1;
        await event.save();

        const [enriched] = await enrichEventsWithWaitlistCounts([event]);
        res.json(enriched);
    } catch (error) {
        console.error('Get single event error:', error);
        res.status(500).json({
            message: 'Internal server error'
        });
    }
});

// 下載活動檔案 (公開)
router.get('/:id/download', async (req, res) => {
    try {
        const { id } = req.params;
        const event = await Event.findById(id);
        
        if (!event) {
            return res.status(404).json({
                message: 'Event not found'
            });
        }

        if (!event.file || !event.file.path) {
            return res.status(404).json({
                message: 'No file available for download'
            });
        }

        // 檢查檔案是否存在
        const filePath = event.file.path.substring(1);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                message: 'File not found on server'
            });
        }

        // 增加下載次數
        event.downloads += 1;
        await event.save();

        const normalizedName = normalizeUploadedFilename(event.file.originalName || path.basename(filePath));
        return res.download(path.resolve(filePath), normalizedName);

    } catch (error) {
        console.error('Download event file error:', error);
        res.status(500).json({
            message: 'Internal server error'
        });
    }
});

// 報名活動 (公開)
router.post('/:id/register', async (req, res) => {
    return res.status(403).json({
        code: 'MEMBER_LOGIN_REQUIRED',
        message: '活動報名需先登入會員並完成信箱驗證，請前往會員專區報名。'
    });
});

// 取消報名 (公開)
router.post('/:id/unregister', async (req, res) => {
    try {
        const { id } = req.params;
        const emailNorm = normalizeParticipantEmail(req.body.participantEmail);
        const result = await cancelEventRegistration(id, emailNorm);
        return res.json({
            message: result.message,
            registrationStatus: result.registrationStatus,
            event: result.event
        });
    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({ message: error.message });
        }
        console.error('Event unregistration error:', error);
        res.status(500).json({
            message: 'Internal server error'
        });
    }
});

// 管理員更新單筆報名狀態
router.patch('/registrations/:registrationId', adminAuth, async (req, res) => {
    try {
        const { registrationId } = req.params;
        const { status, paymentStatus, attendanceStatus, reviewNote, adminNote } = req.body;

        if (!mongoose.isValidObjectId(registrationId)) {
            return res.status(400).json({ message: 'Invalid registration id' });
        }

        const reg = await EventRegistration.findById(registrationId).populate('event');
        if (!reg) {
            return res.status(404).json({ message: 'Registration not found' });
        }

        const oldPaymentStatus = reg.paymentStatus;

        if (status) reg.status = status;
        if (paymentStatus) reg.paymentStatus = paymentStatus;
        if (attendanceStatus) reg.attendanceStatus = attendanceStatus;
        if (adminNote !== undefined) {
            reg.adminNote = String(adminNote || '').trim();
        }
        if (reviewNote !== undefined) {
            reg.paymentProof = reg.paymentProof || {};
            reg.paymentProof.reviewNote = String(reviewNote || '').trim();
            reg.paymentProof.reviewedAt = new Date();
            reg.paymentProof.reviewedBy = req.user?.userId || null;
        }

        if (attendanceStatus === 'attended') {
            reg.checkedInAt = new Date();
        }
        if (status === 'cancelled') {
            reg.cancelledAt = new Date();
        }

        await reg.save();
        await recalculateRegisteredCount(reg.event._id);

        if (oldPaymentStatus === 'payment_submitted' && reg.paymentStatus === 'paid') {
            await sendEventNotification({
                type: 'payment_confirmed',
                recipientEmail: reg.participantEmail,
                event: reg.event,
                registration: reg
            });
        }
        if (reg.paymentStatus === 'payment_rejected') {
            await sendEventNotification({
                type: 'payment_rejected',
                recipientEmail: reg.participantEmail,
                event: reg.event,
                registration: reg
            });
        }

        return res.json({
            message: 'Registration updated',
            registration: normalizeRegistrationDoc(reg)
        });
    } catch (error) {
        console.error('Patch registration error:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
});

// 管理員上傳活動教材
router.post('/:eventId/materials', adminAuth, materialUpload.single('file'), async (req, res) => {
    try {
        const { eventId } = req.params;
        const {
            title,
            description,
            category = 'other',
            accessLevel = 'registered_only',
            externalUrl = '',
            availableFrom,
            availableUntil
        } = req.body;

        if (!mongoose.isValidObjectId(eventId)) {
            return res.status(400).json({ message: 'Invalid event id' });
        }
        const event = await Event.findById(eventId).select('_id title');
        if (!event) {
            return res.status(404).json({ message: 'Event not found' });
        }
        if (!title || !String(title).trim()) {
            return res.status(400).json({ message: 'title is required' });
        }
        if (!req.file && !externalUrl) {
            return res.status(400).json({ message: 'file or externalUrl is required' });
        }

        const material = await EventMaterial.create({
            event: event._id,
            title: String(title).trim(),
            description: description ? String(description).trim() : '',
            category,
            accessLevel,
            file: req.file
                ? {
                      path: `/${req.file.path}`.replace(/\\/g, '/'),
                      originalName: normalizeUploadedFilename(req.file.originalname),
                      size: req.file.size,
                      mimeType: req.file.mimetype
                  }
                : undefined,
            externalUrl: externalUrl ? String(externalUrl).trim() : '',
            availableFrom: availableFrom ? new Date(availableFrom) : undefined,
            availableUntil: availableUntil ? new Date(availableUntil) : undefined,
            createdBy: req.user?.userId || null
        });

        return res.status(201).json({ message: 'Material uploaded', material });
    } catch (error) {
        console.error('Create event material error:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
});

router.get('/:eventId/materials/admin', adminAuth, async (req, res) => {
    try {
        const { eventId } = req.params;
        if (!mongoose.isValidObjectId(eventId)) {
            return res.status(400).json({ message: 'Invalid event id' });
        }
        const materials = await EventMaterial.find({ event: eventId }).sort({ createdAt: -1 }).lean();
        const normalized = materials.map((m) => ({
            ...m,
            file: m.file
                ? {
                      ...m.file,
                      originalName: normalizeUploadedFilename(m.file.originalName)
                  }
                : m.file
        }));
        return res.json({ materials: normalized });
    } catch (error) {
        console.error('Get admin materials error:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
});

router.delete('/materials/:materialId', adminAuth, async (req, res) => {
    try {
        const { materialId } = req.params;
        if (!mongoose.isValidObjectId(materialId)) {
            return res.status(400).json({ message: 'Invalid material id' });
        }
        const material = await EventMaterial.findById(materialId);
        if (!material) {
            return res.status(404).json({ message: 'Material not found' });
        }
        material.isActive = false;
        await material.save();
        return res.json({ message: 'Material deactivated' });
    } catch (error) {
        console.error('Delete material error:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
});

router.post('/:eventId/notify', adminAuth, async (req, res) => {
    try {
        const { eventId } = req.params;
        const { type, subject, message, target = 'all_registered' } = req.body;
        if (!mongoose.isValidObjectId(eventId)) {
            return res.status(400).json({ message: 'Invalid event id' });
        }
        const event = await Event.findById(eventId);
        if (!event) {
            return res.status(404).json({ message: 'Event not found' });
        }

        const baseQuery = { event: event._id };
        if (target === 'all_registered') {
            baseQuery.status = { $in: ['registered', 'pending_approval'] };
        } else if (target === 'paid_only') {
            baseQuery.paymentStatus = 'paid';
        } else if (target === 'attended_only') {
            baseQuery.attendanceStatus = 'attended';
        } else if (target === 'not_paid') {
            baseQuery.paymentStatus = { $in: ['payment_pending', 'payment_submitted', 'payment_rejected'] };
        } else if (target === 'not_surveyed') {
            const surveyUserIds = await EventSurveyResponse.distinct('user', { event: event._id, user: { $ne: null } });
            baseQuery.user = { $nin: surveyUserIds };
        }

        const regs = await EventRegistration.find(baseQuery).lean();
        let sent = 0;
        let failed = 0;
        let skipped = 0;

        for (const reg of regs) {
            // eslint-disable-next-line no-await-in-loop
            const result = await sendEventNotification({
                type: type || 'custom',
                recipientEmail: reg.participantEmail,
                event,
                registration: reg,
                customSubject: subject,
                customMessage: message
            });
            if (result.status === 'sent') sent += 1;
            else if (result.status === 'failed') failed += 1;
            else skipped += 1;
        }

        return res.json({ message: 'Notification job finished', counts: { sent, failed, skipped } });
    } catch (error) {
        console.error('Notify error:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
});

router.get('/:eventId/survey-results', adminAuth, async (req, res) => {
    try {
        const { eventId } = req.params;
        if (!mongoose.isValidObjectId(eventId)) {
            return res.status(400).json({ message: 'Invalid event id' });
        }
        const responses = await EventSurveyResponse.find({ event: eventId })
            .populate('user', 'username fullName email')
            .sort({ createdAt: -1 })
            .lean();

        const count = responses.length;
        const avg = (key) =>
            count > 0
                ? Number(
                      (
                          responses.reduce((sum, item) => sum + Number(item[key] || 0), 0) /
                          count
                      ).toFixed(2)
                  )
                : 0;

        return res.json({
            totalResponses: count,
            averageOverallRating: avg('overallRating'),
            averageInstructorRating: avg('instructorRating'),
            averageMaterialRating: avg('materialRating'),
            averageNps: avg('nps'),
            interestedAdvancedCourseCount: responses.filter((r) => !!r.interestedAdvancedCourse).length,
            interestedCorporateTrainingCount: responses.filter((r) => !!r.interestedCorporateTraining).length,
            interestedWorkgroupCount: responses.filter((r) => !!r.interestedWorkgroup).length,
            responses
        });
    } catch (error) {
        console.error('Survey results error:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
});

router.get('/:eventId/operation-summary', adminAuth, async (req, res) => {
    try {
        const { eventId } = req.params;
        if (!mongoose.isValidObjectId(eventId)) {
            return res.status(400).json({ message: 'Invalid event id' });
        }
        const event = await Event.findById(eventId).lean();
        if (!event) {
            return res.status(404).json({ message: 'Event not found' });
        }

        const [regs, materials, surveys] = await Promise.all([
            EventRegistration.find({ event: event._id }).lean(),
            EventMaterial.find({ event: event._id, isActive: true }).lean(),
            EventSurveyResponse.find({ event: event._id }).lean()
        ]);

        // 與「報名名單」modal 的「正式人數」一致：status 為已報名（含舊欄位 confirmed），不含待審核；勿僅讀 Event.registeredCount（寫入時機與規則不同，易過期或與畫面不一致）
        const isFormalSlot = (r) => {
            const s = r && r.status;
            return s === 'registered' || s === 'confirmed';
        };
        const isWaitlist = (r) => {
            const s = r && r.status;
            return s === 'waitlisted' || s === 'waitlist';
        };
        const isPendingApproval = (r) => (r && r.status) === 'pending_approval';
        const inPaymentAttendancePool = (r) => {
            const s = r && r.status;
            if (!s) return true;
            return s !== 'cancelled' && s !== 'rejected';
        };
        const formalRegisteredCount = regs.filter(isFormalSlot).length;
        const regPool = (pred) => regs.filter((r) => inPaymentAttendancePool(r) && pred(r));
        const summary = {
            event: {
                _id: event._id,
                title: event.title,
                date: event.date,
                endDate: event.endDate,
                location: event.location,
                status: event.status,
                capacity: event.capacity || null,
                registeredCount: formalRegisteredCount,
                registeredCountDenormalized: event.registeredCount != null ? event.registeredCount : 0
            },
            waitlistCount: regs.filter(isWaitlist).length,
            pendingApprovalCount: regs.filter(isPendingApproval).length,
            payment: {
                pending: regPool((r) => r.paymentStatus === 'payment_pending').length,
                submitted: regPool((r) => r.paymentStatus === 'payment_submitted').length,
                paid: regPool((r) => r.paymentStatus === 'paid').length
            },
            attendance: {
                attended: regPool((r) => r.attendanceStatus === 'attended').length,
                noShow: regPool((r) => r.attendanceStatus === 'no_show').length
            },
            materials: {
                count: materials.length,
                downloads: materials.reduce((sum, item) => sum + Number(item.downloadCount || 0), 0)
            },
            survey: {
                responses: surveys.length
            }
        };

        return res.json(summary);
    } catch (error) {
        console.error('Operation summary error:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
});

module.exports = router;
