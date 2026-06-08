const express = require('express');
const router = express.Router();
const CertificateType = require('../models/CertificateType');
const { adminAuth } = require('../middleware/adminAuth');

function errorResponse(res, statusCode, code, message, details = {}) {
    return res.status(statusCode).json({
        error: { code, message, details }
    });
}

// GET /api/admin/certificate-types
router.get('/', adminAuth, async (req, res) => {
    try {
        const query = {};
        if (req.query.activeOnly === '1') {
            query.isActive = true;
        }
        const types = await CertificateType.find(query).sort({ name: 1 });
        res.json({ data: types });
    } catch (error) {
        console.error('List certificate types error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// POST /api/admin/certificate-types
router.post('/', adminAuth, async (req, res) => {
    try {
        const { name, titleZh, titleEn, prefix, bodyText, startingSequence } = req.body;
        if (!name || !titleZh) {
            return errorResponse(res, 400, 'VALIDATION_ERROR', '名稱與中文標題為必填');
        }
        if (!prefix || !/^[A-Z][A-Z0-9\-]+$/.test(prefix)) {
            return errorResponse(res, 400, 'VALIDATION_ERROR', '前綴格式不正確，須為大寫英文+數字+連字號（例：ACTC-CISSP）');
        }
        const existing = await CertificateType.findOne({ name: name.trim() });
        if (existing) {
            return errorResponse(res, 409, 'DUPLICATE_NAME', '此名稱已存在');
        }
        const existingPrefix = await CertificateType.findOne({ prefix: prefix.trim() });
        if (existingPrefix) {
            return errorResponse(res, 409, 'DUPLICATE_PREFIX', '此前綴已被使用');
        }
        const certType = new CertificateType({
            name: name.trim(),
            titleZh: titleZh.trim(),
            titleEn: titleEn ? titleEn.trim() : undefined,
            prefix: prefix.trim(),
            bodyText: bodyText ? bodyText.trim() : undefined,
            createdBy: req.user.userId
        });
        await certType.save();

        if (startingSequence !== undefined) {
            const startSeqNum = Number(startingSequence);
            if (!isNaN(startSeqNum) && startSeqNum >= 1) {
                const Counter = require('../models/Counter');
                const startVal = startSeqNum - 1;
                await Counter.findByIdAndUpdate(
                    certType.counterKey,
                    { $set: { seq: startVal } },
                    { upsert: true, new: true }
                );
            }
        }

        res.status(201).json({ data: certType });
    } catch (error) {
        console.error('Create certificate type error:', error);
        if (error.code === 11000) {
            return errorResponse(res, 409, 'DUPLICATE_NAME', '此名稱或前綴已存在');
        }
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// PATCH /api/admin/certificate-types/:id
router.patch('/:id', adminAuth, async (req, res) => {
    try {
        const { name, titleZh, titleEn, isActive, prefix, bodyText, confirmPrefixChange, startingSequence } = req.body;
        const update = {};
        if (name !== undefined) update.name = name.trim();
        if (titleZh !== undefined) update.titleZh = titleZh.trim();
        if (titleEn !== undefined) update.titleEn = titleEn.trim();
        if (isActive !== undefined) update.isActive = isActive;
        if (bodyText !== undefined) update.bodyText = bodyText ? bodyText.trim() : undefined;

        if (prefix !== undefined) {
            if (confirmPrefixChange !== true) {
                return errorResponse(res, 400, 'CONFIRM_REQUIRED', '修改前綴需勾選確認框');
            }
            if (!/^[A-Z][A-Z0-9\-]+$/.test(prefix)) {
                return errorResponse(res, 400, 'VALIDATION_ERROR', '前綴格式不正確');
            }
            update.prefix = prefix.trim();
            update.counterKey = prefix.trim().toLowerCase().replace(/-/g, '_') + '_cert_num';
        }

        const certType = await CertificateType.findByIdAndUpdate(
            req.params.id,
            { $set: update },
            { new: true, runValidators: true }
        );
        if (!certType) {
            return errorResponse(res, 404, 'NOT_FOUND', '找不到該證書類型');
        }

        if (prefix !== undefined && startingSequence !== undefined) {
            const startSeqNum = Number(startingSequence);
            if (!isNaN(startSeqNum) && startSeqNum >= 1) {
                const Counter = require('../models/Counter');
                const startVal = startSeqNum - 1;
                await Counter.findByIdAndUpdate(
                    certType.counterKey,
                    { $set: { seq: startVal } },
                    { upsert: true, new: true }
                );
            }
        }

        res.json({ data: certType });
    } catch (error) {
        console.error('Update certificate type error:', error);
        if (error.code === 11000) {
            return errorResponse(res, 409, 'DUPLICATE_NAME', '名稱或前綴已被使用');
        }
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// DELETE /api/admin/certificate-types/:id（軟刪除）
router.delete('/:id', adminAuth, async (req, res) => {
    try {
        const Exam = require('../models/Exam');
        // Find if any active exam uses this certificate type
        const activeExams = await Exam.find({ certTypeRef: req.params.id, isActive: true }, 'title');
        if (activeExams.length > 0) {
            const examTitles = activeExams.map(e => `「${e.title}」`).join('、');
            return errorResponse(res, 400, 'DEPENDENCY_ERROR', `無法停用此類型，因為它正被以下啟用中的考試使用：${examTitles}`);
        }

        const certType = await CertificateType.findByIdAndUpdate(
            req.params.id,
            { $set: { isActive: false } },
            { new: true }
        );
        if (!certType) {
            return errorResponse(res, 404, 'NOT_FOUND', '找不到該證書類型');
        }
        res.json({ data: { message: '證書類型已停用', certType } });
    } catch (error) {
        console.error('Delete certificate type error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// POST /api/admin/certificate-types/preview
router.post('/preview', adminAuth, async (req, res) => {
    try {
        const { titleZh, titleEn, bodyText } = req.body;
        const { generatePreviewPDF } = require('../services/examCertificates');
        
        await generatePreviewPDF({ titleZh, titleEn, bodyText }, res);
    } catch (error) {
        console.error('Preview certificate error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '產生預覽 PDF 失敗');
    }
});

module.exports = router;
