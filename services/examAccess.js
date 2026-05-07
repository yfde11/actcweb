const ExamAccess = require('../models/ExamAccess');

const ACCESS_VALIDITY_YEARS = 1;

/**
 * 檢查用戶是否有考試存取權
 * @param {string} userId
 * @param {string} examId
 * @returns {Promise<{ hasAccess: boolean, reason: string|null, expiresAt: Date|null, grantedBy: string|null }>}
 */
async function checkExamAccess(userId, examId) {
    const access = await ExamAccess.findOne({ user: userId, exam: examId });

    if (!access) {
        return { hasAccess: false, reason: 'NO_ACCESS', expiresAt: null, grantedBy: null };
    }

    if (access.isRevoked) {
        return { hasAccess: false, reason: 'ACCESS_REVOKED', expiresAt: null, grantedBy: access.grantedBy };
    }

    if (access.expiresAt && new Date() > access.expiresAt) {
        return { hasAccess: false, reason: 'ACCESS_EXPIRED', expiresAt: access.expiresAt, grantedBy: access.grantedBy };
    }

    return {
        hasAccess: true,
        reason: null,
        expiresAt: access.expiresAt,
        grantedBy: access.grantedBy
    };
}

/**
 * 授予用戶考試存取權（upsert：若已存在則更新）
 * @param {Object} opts
 * @param {string} opts.userId
 * @param {string} opts.examId
 * @param {string} opts.grantedBy - 'payment' | 'admin_manual' | 'free_exam'
 * @param {string|null} [opts.grantedByUserId] - 管理員 userId
 * @param {Date|null} [opts.expiresAt] - 未傳入時自動計算 +1 年（free_exam 為 null）
 * @param {string} [opts.adminNote]
 * @returns {Promise<Object>} ExamAccess document
 */
async function grantExamAccess({ userId, examId, grantedBy, grantedByUserId = null, expiresAt, adminNote }) {
    let resolvedExpiresAt;
    if (expiresAt !== undefined) {
        resolvedExpiresAt = expiresAt; // null = 永久，Date = 指定到期
    } else if (grantedBy !== 'free_exam') {
        resolvedExpiresAt = new Date();
        resolvedExpiresAt.setFullYear(resolvedExpiresAt.getFullYear() + ACCESS_VALIDITY_YEARS);
    } else {
        resolvedExpiresAt = null;
    }

    const access = await ExamAccess.findOneAndUpdate(
        { user: userId, exam: examId },
        {
            $set: {
                grantedBy,
                grantedByUser: grantedByUserId,
                expiresAt: resolvedExpiresAt,
                adminNote: adminNote || null,
                isRevoked: false,
                revokedAt: null,
                revokedBy: null,
                revokeReason: null
            }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return access;
}

/**
 * 撤銷用戶的考試存取權
 * @param {string} userId
 * @param {string} examId
 * @param {string} adminUserId - 執行撤銷的管理員
 * @param {string} [reason]
 * @returns {Promise<Object|null>}
 */
async function revokeExamAccess(userId, examId, adminUserId, reason) {
    const access = await ExamAccess.findOneAndUpdate(
        { user: userId, exam: examId },
        {
            $set: {
                isRevoked: true,
                revokedAt: new Date(),
                revokedBy: adminUserId,
                revokeReason: reason || null
            }
        },
        { new: true }
    );
    return access;
}

module.exports = { checkExamAccess, grantExamAccess, revokeExamAccess };
