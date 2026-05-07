const express = require('express');
const mongoose = require('mongoose');
const ExamAccess = require('../models/ExamAccess');
const Exam = require('../models/Exam');
const User = require('../models/User');
const { adminAuth } = require('../middleware/adminAuth');
const { grantExamAccess, revokeExamAccess } = require('../services/examAccess');

const router = express.Router();

function errorResponse(res, statusCode, code, message, details = {}) {
    return res.status(statusCode).json({ error: { code, message, details } });
}

// GET /api/admin/exam-access - 列出所有授權記錄（可依 examId / userId 篩選）
router.get('/', adminAuth, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const { cursor, examId, userId, isRevoked } = req.query;

        const query = {};
        if (examId && mongoose.Types.ObjectId.isValid(examId)) {
            query.exam = new mongoose.Types.ObjectId(examId);
        }
        if (userId && mongoose.Types.ObjectId.isValid(userId)) {
            query.user = new mongoose.Types.ObjectId(userId);
        }
        if (isRevoked !== undefined && isRevoked !== '') {
            query.isRevoked = isRevoked === 'true';
        }

        if (cursor) {
            const [createdAt, id] = cursor.split('|');
            query.$or = [
                { createdAt: { $lt: new Date(createdAt) } },
                { createdAt: new Date(createdAt), _id: { $lt: new mongoose.Types.ObjectId(id) } }
            ];
        }

        const records = await ExamAccess.find(query)
            .sort({ createdAt: -1, _id: -1 })
            .limit(limit + 1)
            .populate('user', 'username fullName email')
            .populate('exam', 'title requiresPurchase price')
            .populate('grantedByUser', 'username fullName')
            .populate('revokedBy', 'username fullName');

        const hasMore = records.length > limit;
        if (hasMore) records.pop();

        const nextCursor = hasMore
            ? `${records[records.length - 1].createdAt.toISOString()}|${records[records.length - 1]._id}`
            : null;

        res.json({ data: records, pagination: { hasMore, nextCursor } });
    } catch (error) {
        console.error('List exam access error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// POST /api/admin/exam-access/grant - 手動授予存取權
// Body: { userId, examId, adminNote?, expiresAt? }
router.post('/grant', adminAuth, async (req, res) => {
    try {
        const { userId, examId, adminNote, expiresAt } = req.body;

        if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
            return errorResponse(res, 400, 'INVALID_USER_ID', '無效的使用者 ID');
        }
        if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
            return errorResponse(res, 400, 'INVALID_EXAM_ID', '無效的考試 ID');
        }

        const [user, exam] = await Promise.all([
            User.findById(userId).select('username fullName email'),
            Exam.findById(examId).select('title requiresPurchase')
        ]);
        if (!user) return errorResponse(res, 404, 'USER_NOT_FOUND', '找不到使用者');
        if (!exam) return errorResponse(res, 404, 'EXAM_NOT_FOUND', '找不到考試');

        let resolvedExpiresAt = null;
        if (expiresAt === null || expiresAt === '') {
            resolvedExpiresAt = null; // 永久
        } else if (expiresAt) {
            const d = new Date(expiresAt);
            if (isNaN(d.getTime())) {
                return errorResponse(res, 400, 'INVALID_DATE', '無效的到期日格式');
            }
            resolvedExpiresAt = d;
        } else {
            // 未傳入：預設 +1 年
            resolvedExpiresAt = new Date();
            resolvedExpiresAt.setFullYear(resolvedExpiresAt.getFullYear() + 1);
        }

        const access = await grantExamAccess({
            userId,
            examId,
            grantedBy: 'admin_manual',
            grantedByUserId: req.user.userId,
            expiresAt: resolvedExpiresAt,
            adminNote: (adminNote || '').trim() || null
        });

        // populate for response
        await access.populate([
            { path: 'user', select: 'username fullName email' },
            { path: 'exam', select: 'title requiresPurchase price' },
            { path: 'grantedByUser', select: 'username fullName' }
        ]);

        res.status(201).json({ data: access });
    } catch (error) {
        console.error('Grant exam access error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// PATCH /api/admin/exam-access/:id/revoke - 撤銷授權
// Body: { reason? }
router.patch('/:id/revoke', adminAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的授權 ID');
        }

        const access = await ExamAccess.findById(req.params.id);
        if (!access) return errorResponse(res, 404, 'NOT_FOUND', '授權記錄不存在');
        if (access.isRevoked) return errorResponse(res, 409, 'ALREADY_REVOKED', '此授權已撤銷');

        const revokedAccess = await revokeExamAccess(
            access.user.toString(),
            access.exam.toString(),
            req.user.userId,
            (req.body.reason || '').trim() || null
        );

        res.json({ data: revokedAccess });
    } catch (error) {
        console.error('Revoke exam access error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// DELETE /api/admin/exam-access/:id - 直接刪除授權記錄（永久，謹慎使用）
router.delete('/:id', adminAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的授權 ID');
        }
        const access = await ExamAccess.findByIdAndDelete(req.params.id);
        if (!access) return errorResponse(res, 404, 'NOT_FOUND', '授權記錄不存在');
        res.json({ data: { deleted: true } });
    } catch (error) {
        console.error('Delete exam access error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

module.exports = router;
