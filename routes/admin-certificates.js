const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const csv = require('csv-parser');
const stream = require('stream');
const validator = require('validator');
const Certificate = require('../models/Certificate');
const CertificateType = require('../models/CertificateType');
const CourseAttendance = require('../models/CourseAttendance');
const User = require('../models/User');
const { adminAuth } = require('../middleware/adminAuth');
const { issueCourseAttendanceCertificate } = require('../services/examCertificates');

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

const CSV_TEMPLATE_HEADERS = [
    'courseName',
    'courseEnglishName',
    'recipientName',
    'recipientEnglishName',
    'recipientEmail',
    'attendanceDate',
    'attendanceEndDate',
    'courseCode',
    'completionHours',
    'instructorName',
    'notes'
];

// Error response helper
function errorResponse(res, statusCode, code, message, details = {}) {
    return res.status(statusCode).json({
        error: { code, message, details }
    });
}

function parseAttendanceDate(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        return { error: '出席日期為必填' };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return { error: '出席日期格式必須為 YYYY-MM-DD' };
    }
    const [year, month, day] = raw.split('-').map(Number);
    const utcCheck = new Date(Date.UTC(year, month - 1, day));
    if (
        utcCheck.getUTCFullYear() !== year ||
        utcCheck.getUTCMonth() + 1 !== month ||
        utcCheck.getUTCDate() !== day
    ) {
        return { error: '出席日期不是合法日期' };
    }
    const parsed = new Date(`${raw}T00:00:00.000+08:00`);
    if (isNaN(parsed.getTime())) {
        return { error: '出席日期不是合法日期' };
    }
    const todayTaipei = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
    if (raw > todayTaipei) {
        return { error: '出席日期不可為未來日期' };
    }
    return { date: parsed };
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSearchTerm(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return escapeRegex(raw.slice(0, 100));
}

function normalizePositiveHours(value) {
    if (value === undefined || value === null || value === '') {
        return { value: undefined };
    }
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) {
        return { error: '完成時數若有填寫，必須為正數' };
    }
    return { value: num };
}

function normalizeRequiredEmail(value) {
    const email = String(value || '').trim().toLowerCase();
    if (!email) {
        return { error: '受證者 Email 為必填' };
    }
    if (!validator.isEmail(email)) {
        return { error: `Email 格式不正確：${email}` };
    }
    return { email };
}

function collectChanges(doc, updates) {
    const changes = {};
    for (const [field, nextValue] of Object.entries(updates)) {
        const prevValue = doc[field] instanceof Date
            ? doc[field].toISOString()
            : doc[field];
        const normalizedNext = nextValue instanceof Date
            ? nextValue.toISOString()
            : nextValue;
        if (String(prevValue ?? '') !== String(normalizedNext ?? '')) {
            changes[field] = { from: prevValue ?? null, to: normalizedNext ?? null };
        }
    }
    return changes;
}

// Shared: process an array of normalized records (issued from CSV or JSON body)
async function processBulkRecords(records, certValidityYears, resolvedCertTypeId, adminUserId) {
    const results = { success: 0, failed: 0, errors: [] };
    const successList = [];

    for (let i = 0; i < records.length; i++) {
        const rec = records[i];
        const rowNum = rec._rowNum || (i + 1);

        if (!rec.courseName || !rec.recipientName || !rec.attendanceDateStr || !rec.recipientEmail) {
            results.failed++;
            results.errors.push({ row: rowNum, recipientName: rec.recipientName || '', message: '課程名稱、姓名、出席日期及 Email 為必填欄位' });
            continue;
        }

        const emailResult = normalizeRequiredEmail(rec.recipientEmail);
        if (emailResult.error) {
            results.failed++;
            results.errors.push({ row: rowNum, recipientName: rec.recipientName || '', message: emailResult.error });
            continue;
        }

        const dateResult = parseAttendanceDate(rec.attendanceDateStr);
        if (dateResult.error) {
            results.failed++;
            results.errors.push({ row: rowNum, recipientName: rec.recipientName || '', message: dateResult.error });
            continue;
        }

        let attendanceEndDate;
        if (rec.attendanceEndDateStr) {
            const endDateResult = parseAttendanceDate(rec.attendanceEndDateStr);
            if (endDateResult.error) {
                results.failed++;
                results.errors.push({ row: rowNum, recipientName: rec.recipientName || '', message: endDateResult.error });
                continue;
            }
            if (endDateResult.date < dateResult.date) {
                results.failed++;
                results.errors.push({ row: rowNum, recipientName: rec.recipientName || '', message: '結束日期不可早於開始日期' });
                continue;
            }
            attendanceEndDate = endDateResult.date;
        }

        const hoursResult = normalizePositiveHours(rec.completionHoursStr);
        if (hoursResult.error) {
            results.failed++;
            results.errors.push({ row: rowNum, recipientName: rec.recipientName || '', message: hoursResult.error });
            continue;
        }

        try {
            let linkedUserId = null;
            const user = await User.findOne({ email: emailResult.email }).select('_id');
            if (user) linkedUserId = user._id;

            const attendance = new CourseAttendance({
                courseName: rec.courseName,
                courseEnglishName: rec.courseEnglishName || undefined,
                courseCode: rec.courseCode || undefined,
                recipientName: rec.recipientName,
                recipientEnglishName: rec.recipientEnglishName || undefined,
                recipientEmail: emailResult.email,
                user: linkedUserId,
                attendanceDate: dateResult.date,
                ...(attendanceEndDate ? { attendanceEndDate } : {}),
                completionHours: hoursResult.value,
                instructorName: rec.instructorName || undefined,
                notes: rec.notes || undefined,
                createdBy: adminUserId
            });
            await attendance.save();

            const { attendance: updatedAttendance, certificate } = await issueCourseAttendanceCertificate(
                attendance._id.toString(),
                certValidityYears,
                resolvedCertTypeId
            );

            results.success++;
            successList.push({
                row: rowNum,
                recipientName: rec.recipientName,
                email: rec.recipientEmail || null,
                certificateNumber: certificate.certificateNumber
            });
        } catch (err) {
            results.failed++;
            results.errors.push({ row: rowNum, recipientName: rec.recipientName || '', message: err.message || '發證失敗' });
        }
    }

    return { ...results, issued: successList };
}

// Helper: Escape CSV field
function escapeCSVField(field) {
    if (field === null || field === undefined) return '';
    const str = String(field);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

// Helper: Format date for CSV (Asia/Taipei)
function formatTaipeiDate(date) {
    if (!date) return '';
    const d = new Date(date);
    const offset = 8 * 60 * 60 * 1000;
    const taipei = new Date(d.getTime() + offset);
    const year = taipei.getUTCFullYear();
    const month = String(taipei.getUTCMonth() + 1).padStart(2, '0');
    const day = String(taipei.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// GET /api/admin/certificates - 全局列表（cursor 分頁）
// Query: certType, isRevoked, userId, examId, q, certificateNumber, recipientName, recipientEmail, courseName, courseCode, limit, cursor
router.get('/', adminAuth, async (req, res) => {
    try {
        const requestedLimit = parseInt(req.query.limit, 10);
        const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 20;
        const { cursor, certType, isRevoked, userId, examId, q, certificateNumber, recipientName, recipientEmail, courseName, courseCode } = req.query;

        const query = {};
        const andConditions = [];
        if (certType && ['exam', 'course'].includes(certType)) {
            query.certType = certType;
        }
        if (isRevoked !== undefined && isRevoked !== '') {
            query.isRevoked = isRevoked === 'true';
        }
        if (userId && mongoose.Types.ObjectId.isValid(userId)) {
            query.user = new mongoose.Types.ObjectId(userId);
        }
        if (examId && mongoose.Types.ObjectId.isValid(examId)) {
            query.exam = new mongoose.Types.ObjectId(examId);
        }

        const courseFilters = [];
        const courseNameTerm = normalizeSearchTerm(courseName);
        const courseCodeTerm = normalizeSearchTerm(courseCode);
        if (courseNameTerm) {
            courseFilters.push({ courseName: { $regex: courseNameTerm, $options: 'i' } });
        }
        if (courseCodeTerm) {
            courseFilters.push({ courseCode: { $regex: courseCodeTerm, $options: 'i' } });
        }
        if (courseFilters.length > 0) {
            const courseIds = await CourseAttendance.find({ $and: courseFilters }).distinct('_id');
            andConditions.push({ course: { $in: courseIds } });
        }

        const certificateNumberTerm = normalizeSearchTerm(certificateNumber);
        const recipientNameTerm = normalizeSearchTerm(recipientName);
        const recipientEmailTerm = normalizeSearchTerm(recipientEmail);
        if (certificateNumberTerm) {
            andConditions.push({ certificateNumber: { $regex: certificateNumberTerm, $options: 'i' } });
        }
        if (recipientNameTerm) {
            andConditions.push({ recipientName: { $regex: recipientNameTerm, $options: 'i' } });
        }
        if (recipientEmailTerm) {
            andConditions.push({ recipientEmail: { $regex: recipientEmailTerm.toLowerCase(), $options: 'i' } });
        }
        const qTerm = normalizeSearchTerm(q);
        if (qTerm) {
            const matchedCourseIds = await CourseAttendance.find({
                $or: [
                    { courseName: { $regex: qTerm, $options: 'i' } },
                    { courseCode: { $regex: qTerm, $options: 'i' } },
                    { recipientName: { $regex: qTerm, $options: 'i' } },
                    { recipientEmail: { $regex: qTerm.toLowerCase(), $options: 'i' } }
                ]
            }).distinct('_id');
            andConditions.push({
                $or: [
                    { certificateNumber: { $regex: qTerm, $options: 'i' } },
                    { recipientName: { $regex: qTerm, $options: 'i' } },
                    { recipientEmail: { $regex: qTerm.toLowerCase(), $options: 'i' } },
                    { course: { $in: matchedCourseIds } }
                ]
            });
        }

        if (cursor) {
            const [issuedAt, id] = cursor.split('|');
            if (!issuedAt || !id || isNaN(new Date(issuedAt).getTime()) || !mongoose.Types.ObjectId.isValid(id)) {
                return errorResponse(res, 400, 'INVALID_CURSOR', '無效的分頁游標');
            }
            andConditions.push({ $or: [
                { issuedAt: { $lt: new Date(issuedAt) } },
                { issuedAt: new Date(issuedAt), _id: { $lt: new mongoose.Types.ObjectId(id) } }
            ]});
        }

        if (andConditions.length > 0) {
            query.$and = andConditions;
        }

        const certs = await Certificate.find(query)
            .sort({ issuedAt: -1, _id: -1 })
            .limit(limit + 1)
            .populate('user', 'username email fullName')
            .populate('exam', 'title')
            .populate('course', 'courseName courseEnglishName courseCode recipientName recipientEnglishName recipientEmail attendanceDate attendanceEndDate completionHours instructorName notes')
            .populate('certTypeRef', 'name titleZh')
            .populate('attempt', 'score passed attemptNumber')
            .populate('revokedBy', 'username fullName');

        const hasMore = certs.length > limit;
        if (hasMore) certs.pop();

        const nextCursor = hasMore
            ? `${certs[certs.length - 1].issuedAt.toISOString()}|${certs[certs.length - 1]._id}`
            : null;

        res.json({
            data: certs,
            pagination: { hasMore, nextCursor }
        });
    } catch (error) {
        console.error('Admin list certificates error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// GET /api/admin/certificates/course-attendances/template.csv - 空白批次上傳範本
router.get('/course-attendances/template.csv', adminAuth, async (req, res) => {
    const sample = [
        '範例課程',
        'Sample Course',
        '王小明',
        'Wang Xiao Ming',
        'student@example.com',
        formatTaipeiDate(new Date()),
        '',
        'ACTC-COURSE-001',
        '6',
        '陳講師',
        '範例列，正式上傳前請刪除'
    ];
    const csvContent = '﻿' + CSV_TEMPLATE_HEADERS.join(',') + '\n' + sample.map(escapeCSVField).join(',') + '\n';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="certificate-upload-template.csv"');
    res.send(csvContent);
});

// GET /api/admin/certificates/export - CSV 匯出（上限 5000 筆，UTF-8 BOM）
// Query: certType, isRevoked, userId, examId, q
router.get('/export', adminAuth, async (req, res) => {
    try {
        const { certType, isRevoked, userId, examId, q } = req.query;

        const query = {};
        const andConditions = [];
        if (certType && ['exam', 'course'].includes(certType)) {
            query.certType = certType;
        }
        if (isRevoked !== undefined && isRevoked !== '') {
            query.isRevoked = isRevoked === 'true';
        }
        if (userId && mongoose.Types.ObjectId.isValid(userId)) {
            query.user = new mongoose.Types.ObjectId(userId);
        }
        if (examId && mongoose.Types.ObjectId.isValid(examId)) {
            query.exam = new mongoose.Types.ObjectId(examId);
        }
        const qTerm = normalizeSearchTerm(q);
        if (qTerm) {
            const matchedCourseIds = await CourseAttendance.find({
                $or: [
                    { courseName: { $regex: qTerm, $options: 'i' } },
                    { courseCode: { $regex: qTerm, $options: 'i' } },
                    { recipientName: { $regex: qTerm, $options: 'i' } },
                    { recipientEmail: { $regex: qTerm.toLowerCase(), $options: 'i' } }
                ]
            }).distinct('_id');
            andConditions.push({
                $or: [
                    { certificateNumber: { $regex: qTerm, $options: 'i' } },
                    { recipientName: { $regex: qTerm, $options: 'i' } },
                    { recipientEmail: { $regex: qTerm.toLowerCase(), $options: 'i' } },
                    { course: { $in: matchedCourseIds } }
                ]
            });
        }
        if (andConditions.length > 0) {
            query.$and = andConditions;
        }

        const certs = await Certificate.find(query)
            .sort({ issuedAt: -1, _id: -1 })
            .limit(5000)
            .populate('user', 'username email fullName')
            .populate('exam', 'title')
            .populate('course', 'courseName courseEnglishName courseCode attendanceDate attendanceEndDate completionHours instructorName')
            .populate('attempt', 'score passed')
            .populate('revokedBy', 'username fullName')
            .lean();

        const csvRows = [];
        csvRows.push('證書編號,證書類型,姓名,英文姓名,使用者名稱,Email,考試/課程名稱,英文課程名稱,課程代碼,出席日期,出席結束日期,完成時數,講師,發證日期,到期日,狀態,撤銷原因,管理備註');

        for (const cert of certs) {
            const user = cert.user || {};
            const displayName = cert.recipientName || user.fullName || user.username || '';
            const displayEmail = cert.recipientEmail || user.email || '';
            const examOrCourse = cert.certType === 'course'
                ? (cert.course ? cert.course.courseName : '')
                : (cert.exam ? cert.exam.title : '');
            const status = cert.isRevoked ? '已撤銷'
                : (cert.expiresAt && new Date(cert.expiresAt) < new Date() ? '已過期' : '有效');
            const row = [
                escapeCSVField(cert.certificateNumber),
                escapeCSVField(cert.certType === 'exam' ? '考試型' : '課程型'),
                escapeCSVField(displayName),
                escapeCSVField(cert.recipientEnglishName || ''),
                escapeCSVField(user.username || ''),
                escapeCSVField(displayEmail),
                escapeCSVField(examOrCourse),
                escapeCSVField(cert.course?.courseEnglishName || ''),
                escapeCSVField(cert.course?.courseCode || ''),
                cert.course?.attendanceDate ? formatTaipeiDate(cert.course.attendanceDate) : '',
                cert.course?.attendanceEndDate ? formatTaipeiDate(cert.course.attendanceEndDate) : '',
                escapeCSVField(cert.course?.completionHours || ''),
                escapeCSVField(cert.course?.instructorName || ''),
                formatTaipeiDate(cert.issuedAt),
                cert.expiresAt ? formatTaipeiDate(cert.expiresAt) : '永久',
                escapeCSVField(status),
                escapeCSVField(cert.revokeReason || ''),
                escapeCSVField(cert.adminNote || '')
            ];
            csvRows.push(row.join(','));
        }

        const BOM = '﻿';
        const csvContent = BOM + csvRows.join('\n');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `certificates-${timestamp}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csvContent);
    } catch (error) {
        console.error('Export certificates CSV error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// PATCH /api/admin/certificates/:id/expiry - 覆寫到期日
// Body: { expiresAt: ISO date or null, adminNote: string (required) }
router.patch('/:id/expiry', adminAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的證書 ID');
        }

        const { expiresAt, adminNote } = req.body;
        const note = (adminNote || '').trim();
        if (!note) {
            return errorResponse(res, 400, 'ADMIN_NOTE_REQUIRED', '管理備註為必填');
        }

        const cert = await Certificate.findById(req.params.id);
        if (!cert) {
            return errorResponse(res, 404, 'NOT_FOUND', '證書不存在');
        }

        if (expiresAt === null || expiresAt === '') {
            cert.expiresAt = null;
        } else if (expiresAt) {
            const d = new Date(expiresAt);
            if (isNaN(d.getTime())) {
                return errorResponse(res, 400, 'INVALID_DATE', '無效的日期格式');
            }
            cert.expiresAt = d;
        }
        cert.adminNote = note;

        await cert.save();
        res.json({ data: cert });
    } catch (error) {
        console.error('Patch certificate expiry error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// POST /api/admin/certificates/course-attendances - 手動單筆發課程型證書
// Body: { courseName, courseCode?, recipientName, recipientEmail, userId?, attendanceDate, attendanceEndDate?, completionHours?, instructorName?, notes?, certValidityYears?, certTypeId? }
// userId 選填：填入時嘗試關聯本會會員帳號，否則視為外部人士
router.post('/course-attendances', adminAuth, async (req, res) => {
    try {
        const { courseName, courseEnglishName, courseCode, recipientName, recipientEnglishName, recipientEmail, userId, attendanceDate, attendanceEndDate, completionHours, instructorName, notes, certValidityYears, certTypeId } = req.body;

        if (!courseName || !recipientName || !attendanceDate || !recipientEmail) {
            return errorResponse(res, 400, 'VALIDATION_ERROR', '課程名稱、受證者姓名、Email 及出席日期為必填');
        }

        const dateResult = parseAttendanceDate(attendanceDate);
        if (dateResult.error) {
            return errorResponse(res, 400, 'INVALID_DATE', dateResult.error);
        }

        let parsedAttendanceEndDate;
        if (attendanceEndDate !== undefined && attendanceEndDate !== null && String(attendanceEndDate).trim()) {
            const endDateResult = parseAttendanceDate(attendanceEndDate);
            if (endDateResult.error) {
                return errorResponse(res, 400, 'INVALID_DATE', endDateResult.error);
            }
            if (endDateResult.date < dateResult.date) {
                return errorResponse(res, 400, 'INVALID_DATE', '結束日期不可早於開始日期');
            }
            parsedAttendanceEndDate = endDateResult.date;
        }

        const emailResult = normalizeRequiredEmail(recipientEmail);
        if (emailResult.error) {
            return errorResponse(res, 400, 'INVALID_EMAIL', emailResult.error);
        }

        const hoursResult = normalizePositiveHours(completionHours);
        if (hoursResult.error) {
            return errorResponse(res, 400, 'INVALID_COMPLETION_HOURS', hoursResult.error);
        }

        // 選填：嘗試關聯會員帳號
        let linkedUserId = null;
        if (userId) {
            if (!mongoose.Types.ObjectId.isValid(userId)) {
                return errorResponse(res, 400, 'INVALID_USER_ID', '無效的使用者 ID 格式');
            }
            const user = await User.findById(userId);
            if (!user) {
                return errorResponse(res, 404, 'USER_NOT_FOUND', '找不到指定的使用者');
            }
            linkedUserId = userId;
        } else {
            const user = await User.findOne({ email: emailResult.email }).select('_id');
            if (user) linkedUserId = user._id;
        }

        const years = certValidityYears !== undefined ? Number(certValidityYears) : undefined;

        let resolvedCertTypeId = null;
        if (certTypeId) {
            if (!mongoose.Types.ObjectId.isValid(certTypeId)) {
                return errorResponse(res, 400, 'INVALID_CERT_TYPE_ID', '無效的證書類型 ID');
            }
            const ct = await CertificateType.findOne({ _id: certTypeId, isActive: true });
            if (!ct) {
                return errorResponse(res, 404, 'CERT_TYPE_NOT_FOUND', '找不到指定的證書類型');
            }
            resolvedCertTypeId = certTypeId;
        }

        const attendance = new CourseAttendance({
            courseName: courseName.trim(),
            courseEnglishName: courseEnglishName ? courseEnglishName.trim() : undefined,
            courseCode: courseCode ? courseCode.trim() : undefined,
            recipientName: recipientName.trim(),
            recipientEnglishName: recipientEnglishName ? recipientEnglishName.trim() : undefined,
            recipientEmail: emailResult.email,
            user: linkedUserId,
            attendanceDate: dateResult.date,
            ...(parsedAttendanceEndDate ? { attendanceEndDate: parsedAttendanceEndDate } : {}),
            completionHours: hoursResult.value,
            instructorName: instructorName ? instructorName.trim() : undefined,
            notes: notes ? notes.trim() : undefined,
            createdBy: req.user.userId
        });
        await attendance.save();

        const { attendance: updatedAttendance, certificate } = await issueCourseAttendanceCertificate(
            attendance._id.toString(),
            years,
            resolvedCertTypeId
        );

        res.status(201).json({ data: { attendance: updatedAttendance, certificate } });
    } catch (error) {
        console.error('Issue course attendance certificate error:', error);
        if (error.message === 'CERTIFICATE_ALREADY_ISSUED') {
            return errorResponse(res, 409, 'CERTIFICATE_ALREADY_ISSUED', '此出席紀錄已發過證書');
        }
        if (error.name === 'ValidationError') {
            const details = {};
            for (let field in error.errors) {
                details[field] = error.errors[field].message;
            }
            return errorResponse(res, 400, 'VALIDATION_ERROR', '欄位驗證失敗', details);
        }
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤', { debug: error.message });
    }
});

// PATCH /api/admin/certificates/:id/course-attendance - 編輯已發出的課程型證書資料
// Body: { courseName, courseEnglishName?, courseCode?, recipientName, recipientEnglishName?, recipientEmail, attendanceDate, attendanceEndDate?, completionHours?, instructorName?, notes?, editReason }
router.patch('/:id/course-attendance', adminAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的證書 ID');
        }

        const {
            courseName,
            courseEnglishName,
            courseCode,
            recipientName,
            recipientEnglishName,
            recipientEmail,
            attendanceDate,
            attendanceEndDate,
            completionHours,
            instructorName,
            notes,
            editReason
        } = req.body;

        const reason = String(editReason || '').trim();
        if (!reason) {
            return errorResponse(res, 400, 'EDIT_REASON_REQUIRED', '修改原因為必填');
        }
        if (!courseName || !recipientName || !attendanceDate || !recipientEmail) {
            return errorResponse(res, 400, 'VALIDATION_ERROR', '課程名稱、受證者姓名、Email 及出席日期為必填');
        }

        const dateResult = parseAttendanceDate(attendanceDate);
        if (dateResult.error) {
            return errorResponse(res, 400, 'INVALID_DATE', dateResult.error);
        }
        let parsedAttendanceEndDate;
        if (attendanceEndDate !== undefined && attendanceEndDate !== null && String(attendanceEndDate).trim()) {
            const endDateResult = parseAttendanceDate(attendanceEndDate);
            if (endDateResult.error) {
                return errorResponse(res, 400, 'INVALID_DATE', endDateResult.error);
            }
            if (endDateResult.date < dateResult.date) {
                return errorResponse(res, 400, 'INVALID_DATE', '結束日期不可早於開始日期');
            }
            parsedAttendanceEndDate = endDateResult.date;
        }
        const emailResult = normalizeRequiredEmail(recipientEmail);
        if (emailResult.error) {
            return errorResponse(res, 400, 'INVALID_EMAIL', emailResult.error);
        }
        const hoursResult = normalizePositiveHours(completionHours);
        if (hoursResult.error) {
            return errorResponse(res, 400, 'INVALID_COMPLETION_HOURS', hoursResult.error);
        }

        const cert = await Certificate.findById(req.params.id).populate('course');
        if (!cert) {
            return errorResponse(res, 404, 'NOT_FOUND', '證書不存在');
        }
        if (cert.certType !== 'course' || !cert.course) {
            return errorResponse(res, 400, 'NOT_COURSE_CERTIFICATE', '僅課程型證書可編輯課程發證資料');
        }

        const attendance = await CourseAttendance.findById(cert.course._id || cert.course);
        if (!attendance) {
            return errorResponse(res, 404, 'COURSE_ATTENDANCE_NOT_FOUND', '找不到課程出席紀錄');
        }

        const linkedUser = await User.findOne({ email: emailResult.email }).select('_id');
        const updates = {
            courseName: courseName.trim(),
            courseEnglishName: courseEnglishName ? courseEnglishName.trim() : undefined,
            courseCode: courseCode ? courseCode.trim() : undefined,
            recipientName: recipientName.trim(),
            recipientEnglishName: recipientEnglishName ? recipientEnglishName.trim() : undefined,
            recipientEmail: emailResult.email,
            user: linkedUser ? linkedUser._id : null,
            attendanceDate: dateResult.date,
            attendanceEndDate: parsedAttendanceEndDate,
            completionHours: hoursResult.value,
            instructorName: instructorName ? instructorName.trim() : undefined,
            notes: notes ? notes.trim() : undefined
        };

        const changes = collectChanges(attendance, updates);
        if (Object.keys(changes).length === 0) {
            return res.json({ data: { certificate: cert, attendance, changed: false } });
        }

        Object.assign(attendance, updates);
        attendance.lastEditedBy = req.user.userId;
        attendance.lastEditedAt = new Date();
        attendance.editHistory.push({
            editedBy: req.user.userId,
            editedAt: new Date(),
            changes,
            reason
        });
        await attendance.save();

        cert.recipientName = updates.recipientName;
        cert.recipientEnglishName = updates.recipientEnglishName;
        cert.recipientEmail = updates.recipientEmail;
        cert.user = updates.user;
        await cert.save();

        await cert.populate('course');
        await cert.populate('user', 'username email fullName');
        await cert.populate('certTypeRef', 'name titleZh');

        res.json({ data: { certificate: cert, attendance, changed: true } });
    } catch (error) {
        console.error('Edit course certificate error:', error);
        if (error.name === 'ValidationError') {
            const details = {};
            for (let field in error.errors) {
                details[field] = error.errors[field].message;
            }
            return errorResponse(res, 400, 'VALIDATION_ERROR', '欄位驗證失敗', details);
        }
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤', { debug: error.message });
    }
});

// POST /api/admin/certificates/course-attendances/bulk - CSV/JSON 批次發課程型證書（上限 500 筆）
// Multipart: file (CSV), certValidityYears (optional), certTypeId (optional) — legacy
// JSON body: { records: [...], certValidityYears?, certTypeId? } — new
router.post('/course-attendances/bulk', adminAuth, upload.single('file'), async (req, res) => {
    try {
        const certValidityYears = (req.body.certValidityYears !== undefined && req.body.certValidityYears !== '')
            ? Number(req.body.certValidityYears)
            : undefined;

        let resolvedCertTypeId = null;
        const certTypeIdBody = req.body.certTypeId;
        if (certTypeIdBody) {
            if (!mongoose.Types.ObjectId.isValid(certTypeIdBody)) {
                return errorResponse(res, 400, 'INVALID_CERT_TYPE_ID', '無效的證書類型 ID');
            }
            const ct = await CertificateType.findOne({ _id: certTypeIdBody, isActive: true });
            if (!ct) {
                return errorResponse(res, 404, 'CERT_TYPE_NOT_FOUND', '找不到指定的證書類型');
            }
            resolvedCertTypeId = certTypeIdBody;
        }

        let records;

        // === JSON body path (new) ===
        if (req.is('application/json') && req.body && Array.isArray(req.body.records)) {
            const jsonRecords = req.body.records;
            if (jsonRecords.length === 0) {
                return errorResponse(res, 400, 'EMPTY_RECORDS', 'records 陣列為空');
            }
            if (jsonRecords.length > 500) {
                return errorResponse(res, 400, 'TOO_MANY_ROWS', `每次批次上限 500 筆，目前共 ${jsonRecords.length} 筆`);
            }

            records = jsonRecords.map((r, i) => ({
                _rowNum: i + 1,
                courseName: (r.courseName || '').trim(),
                courseEnglishName: (r.courseEnglishName || '').trim(),
                courseCode: (r.courseCode || '').trim(),
                recipientName: (r.recipientName || '').trim(),
                recipientEnglishName: (r.recipientEnglishName || '').trim(),
                recipientEmail: (r.recipientEmail || '').trim().toLowerCase(),
                attendanceDateStr: (r.attendanceDate || '').trim(),
                attendanceEndDateStr: (r.attendanceEndDate || '').trim(),
                completionHoursStr: r.completionHours !== undefined && r.completionHours !== '' ? String(r.completionHours).trim() : '',
                instructorName: (r.instructorName || '').trim(),
                notes: (r.notes || '').trim()
            }));
        } else {
            // === Multipart CSV path (legacy, kept for backward compat) ===
            if (!req.file) {
                return errorResponse(res, 400, 'NO_FILE', '請上傳 CSV 檔案');
            }

            const rows = await new Promise((resolve, reject) => {
                const results = [];
                const readable = new stream.Readable();
                readable._read = () => {};
                readable.push(req.file.buffer);
                readable.push(null);
                readable
                    .pipe(csv())
                    .on('data', row => results.push(row))
                    .on('end', () => resolve(results))
                    .on('error', reject);
            });

            if (rows.length === 0) {
                return errorResponse(res, 400, 'EMPTY_FILE', 'CSV 檔案無資料');
            }

            if (rows.length > 500) {
                return errorResponse(res, 400, 'TOO_MANY_ROWS', `每次批次上限 500 筆，目前共 ${rows.length} 筆`);
            }

            records = rows.map((row, i) => ({
                _rowNum: i + 2,
                courseName: (row.courseName || row['課程名稱'] || '').trim(),
                courseEnglishName: (row.courseEnglishName || row['英文課程名稱'] || row['English Course Name'] || '').trim(),
                courseCode: (row.courseCode || row['課程代碼'] || '').trim(),
                recipientName: (row.recipientName || row['姓名'] || '').trim(),
                recipientEnglishName: (row.recipientEnglishName || row.englishName || row['English Name'] || row['英文姓名'] || '').trim(),
                recipientEmail: (row.recipientEmail || row.email || row['Email'] || '').trim().toLowerCase(),
                attendanceDateStr: (row.attendanceDate || row['出席日期'] || '').trim(),
                attendanceEndDateStr: (row.attendanceEndDate || row['出席結束日期'] || '').trim(),
                completionHoursStr: (row.completionHours || row['完成時數'] || '').trim(),
                instructorName: (row.instructorName || row['講師'] || '').trim(),
                notes: (row.notes || row['備註'] || '').trim()
            }));
        }

        const result = await processBulkRecords(records, certValidityYears, resolvedCertTypeId, req.user.userId);

        res.json({
            data: {
                success: result.success,
                failed: result.failed,
                errors: result.errors,
                issued: result.issued
            }
        });
    } catch (error) {
        console.error('Bulk course attendance certificate error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

module.exports = router;
