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

// Error response helper
function errorResponse(res, statusCode, code, message, details = {}) {
    return res.status(statusCode).json({
        error: { code, message, details }
    });
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
// Query: certType, isRevoked, userId, examId, limit, cursor
router.get('/', adminAuth, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const { cursor, certType, isRevoked, userId, examId } = req.query;

        const query = {};
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

        if (cursor) {
            const [issuedAt, id] = cursor.split('|');
            query.$or = [
                { issuedAt: { $lt: new Date(issuedAt) } },
                { issuedAt: new Date(issuedAt), _id: { $lt: new mongoose.Types.ObjectId(id) } }
            ];
        }

        const certs = await Certificate.find(query)
            .sort({ issuedAt: -1, _id: -1 })
            .limit(limit + 1)
            .populate('user', 'username email fullName')
            .populate('exam', 'title')
            .populate('course', 'courseName')
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

// GET /api/admin/certificates/export - CSV 匯出（上限 5000 筆，UTF-8 BOM）
// Query: certType, isRevoked, userId, examId
router.get('/export', adminAuth, async (req, res) => {
    try {
        const { certType, isRevoked, userId, examId } = req.query;

        const query = {};
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

        const certs = await Certificate.find(query)
            .sort({ issuedAt: -1, _id: -1 })
            .limit(5000)
            .populate('user', 'username email fullName')
            .populate('exam', 'title')
            .populate('course', 'courseName')
            .populate('attempt', 'score passed')
            .populate('revokedBy', 'username fullName')
            .lean();

        const csvRows = [];
        csvRows.push('證書編號,證書類型,姓名,使用者名稱,Email,考試/課程名稱,發證日期,到期日,狀態,撤銷原因,管理備註');

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
                escapeCSVField(user.username || ''),
                escapeCSVField(displayEmail),
                escapeCSVField(examOrCourse),
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
// Body: { courseName, courseCode?, recipientName, recipientEmail?, userId?, attendanceDate, completionHours?, instructorName?, notes?, certValidityYears?, certTypeId? }
// userId 選填：填入時嘗試關聯本會會員帳號，否則視為外部人士
router.post('/course-attendances', adminAuth, async (req, res) => {
    try {
        const { courseName, courseCode, recipientName, recipientEmail, userId, attendanceDate, completionHours, instructorName, notes, certValidityYears, certTypeId } = req.body;

        if (!courseName || !recipientName || !attendanceDate) {
            return errorResponse(res, 400, 'VALIDATION_ERROR', '課程名稱、受證者姓名及出席日期為必填');
        }

        const attendanceDateParsed = new Date(attendanceDate);
        if (isNaN(attendanceDateParsed.getTime())) {
            return errorResponse(res, 400, 'INVALID_DATE', '無效的出席日期格式');
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
        } else if (recipientEmail) {
            const emailNorm = recipientEmail.trim().toLowerCase();
            if (!validator.isEmail(emailNorm)) {
                return errorResponse(res, 400, 'INVALID_EMAIL', '受證者 Email 格式不正確');
            }
            const user = await User.findOne({ email: emailNorm }).select('_id');
            if (user) linkedUserId = user._id;
        }

        const normalizedEmail = recipientEmail ? recipientEmail.trim().toLowerCase() : undefined;

        const attendance = new CourseAttendance({
            courseName: courseName.trim(),
            courseCode: courseCode ? courseCode.trim() : undefined,
            recipientName: recipientName.trim(),
            recipientEmail: normalizedEmail,
            user: linkedUserId,
            attendanceDate: attendanceDateParsed,
            completionHours: completionHours ? Number(completionHours) : undefined,
            instructorName: instructorName ? instructorName.trim() : undefined,
            notes: notes ? notes.trim() : undefined,
            createdBy: req.user.userId
        });
        await attendance.save();

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
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// POST /api/admin/certificates/course-attendances/bulk - CSV 批次發課程型證書（上限 500 筆）
// Multipart: file (CSV), certValidityYears (optional), certTypeId (optional)
router.post('/course-attendances/bulk', adminAuth, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return errorResponse(res, 400, 'NO_FILE', '請上傳 CSV 檔案');
        }

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

        // Parse CSV
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

        const results = { success: 0, failed: 0, errors: [] };
        const successList = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNum = i + 2; // CSV row number (header = 1)

            const courseName = (row.courseName || row['課程名稱'] || '').trim();
            const courseCode = (row.courseCode || row['課程代碼'] || '').trim();
            const recipientName = (row.recipientName || row['姓名'] || '').trim();
            const recipientEmail = (row.recipientEmail || row.email || row['Email'] || '').trim().toLowerCase();
            const attendanceDateStr = (row.attendanceDate || row['出席日期'] || '').trim();
            const completionHoursStr = (row.completionHours || row['完成時數'] || '').trim();
            const instructorName = (row.instructorName || row['講師'] || '').trim();
            const notes = (row.notes || row['備註'] || '').trim();

            if (!courseName || !recipientName || !attendanceDateStr) {
                results.failed++;
                results.errors.push({ row: rowNum, message: '課程名稱、姓名及出席日期為必填欄位' });
                continue;
            }

            if (recipientEmail && !validator.isEmail(recipientEmail)) {
                results.failed++;
                results.errors.push({ row: rowNum, message: `Email 格式不正確：${recipientEmail}` });
                continue;
            }

            const attendanceDate = new Date(attendanceDateStr);
            if (isNaN(attendanceDate.getTime())) {
                results.failed++;
                results.errors.push({ row: rowNum, message: `無效的出席日期：${attendanceDateStr}` });
                continue;
            }

            try {
                // 嘗試以 Email 關聯會員帳號（找不到不報錯，視為外部人士）
                let linkedUserId = null;
                if (recipientEmail) {
                    const user = await User.findOne({ email: recipientEmail }).select('_id');
                    if (user) linkedUserId = user._id;
                }

                const attendance = new CourseAttendance({
                    courseName,
                    courseCode: courseCode || undefined,
                    recipientName,
                    recipientEmail: recipientEmail || undefined,
                    user: linkedUserId,
                    attendanceDate,
                    completionHours: completionHoursStr ? Number(completionHoursStr) : undefined,
                    instructorName: instructorName || undefined,
                    notes: notes || undefined,
                    createdBy: req.user.userId
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
                    recipientName,
                    email: recipientEmail || null,
                    certificateNumber: certificate.certificateNumber
                });
            } catch (err) {
                results.failed++;
                results.errors.push({ row: rowNum, message: err.message || '發證失敗' });
            }
        }

        res.json({
            data: {
                success: results.success,
                failed: results.failed,
                errors: results.errors,
                issued: successList
            }
        });
    } catch (error) {
        console.error('Bulk course attendance certificate error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

module.exports = router;
