const mongoose = require('mongoose');

const examAccessSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    exam: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Exam',
        required: true,
        index: true
    },
    // 授權來源：payment = 金流付款（未來）; admin_manual = 管理員手動; free_exam = 考試本身免費
    grantedBy: {
        type: String,
        enum: ['payment', 'admin_manual', 'free_exam'],
        required: true
    },
    // 授權到期日（null = 永久）；付款型預設 +1 年，管理員可自訂
    expiresAt: {
        type: Date,
        default: null
    },
    // 管理員手動授權備註
    adminNote: {
        type: String,
        trim: true,
        maxlength: [500, 'Admin note cannot exceed 500 characters']
    },
    // 授權者（管理員 userId；free_exam 時為 null）
    grantedByUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    isRevoked: {
        type: Boolean,
        default: false,
        index: true
    },
    revokedAt: Date,
    revokedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    revokeReason: {
        type: String,
        trim: true,
        maxlength: [500, 'Revoke reason cannot exceed 500 characters']
    }
}, {
    timestamps: true
});

// 一個用戶對一個考試只有一筆授權記錄（upsert 更新）
examAccessSchema.index({ user: 1, exam: 1 }, { unique: true });
examAccessSchema.index({ exam: 1, isRevoked: 1 });
examAccessSchema.index({ expiresAt: 1 });

module.exports = mongoose.model('ExamAccess', examAccessSchema);
