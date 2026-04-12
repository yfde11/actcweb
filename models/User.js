const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: [true, 'Username is required'],
        unique: true,
        trim: true,
        minlength: [3, 'Username must be at least 3 characters long']
    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: [4, 'Password must be at least 4 characters long'] // 降低最小長度以配合default密碼
    },
    role: {
        type: String,
        enum: ['admin', 'user'],
        default: 'user'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    isFirstLogin: {
        type: Boolean,
        default: true // 新用戶首次登入需要更改密碼
    },
    email: {
        type: String,
        trim: true,
        sparse: true // 允許多個null值，但不允許重複的非null值
    },
    fullName: {
        type: String,
        trim: true
    },
    lastLogin: {
        type: Date
    },
    /** 信箱驗證：未通過者不可登入 */
    emailVerified: {
        type: Boolean,
        default: false
    },
    emailVerificationToken: {
        type: String,
        select: false
    },
    emailVerificationExpires: {
        type: Date,
        select: false
    },
    /** 忘記密碼：仅存 SHA-256 hex，不存明文 token */
    passwordResetTokenHash: {
        type: String,
        select: false
    },
    passwordResetExpires: {
        type: Date,
        select: false
    },
    /** 會員審核：none=一般註冊者, pending, approved, rejected */
    membershipStatus: {
        type: String,
        enum: ['none', 'pending', 'approved', 'rejected'],
        default: 'none'
    },
    membershipAppliedAt: { type: Date },
    membershipApplicationNote: { type: String, trim: true, maxlength: 500 },
    membershipReviewedAt: { type: Date },
    membershipReviewNote: { type: String, trim: true, maxlength: 500 },
    /** 管理員核准會員時，是否允許管理最新消息／活動 */
    canManageContent: {
        type: Boolean,
        default: false
    },
    /** 是否接收內容通知郵件（僅已驗證 email 帳號會寄送） */
    emailSubscribed: {
        type: Boolean,
        default: true
    },
    phone: {
        type: String,
        trim: true,
        maxlength: [30, 'Phone too long']
    }
}, {
    timestamps: true
});

// 密碼驗證方法
userSchema.methods.comparePassword = async function(candidatePassword) {
    const bcrypt = require('bcryptjs');
    return bcrypt.compare(candidatePassword, this.password);
};

// 密碼更新方法
userSchema.methods.updatePassword = async function(newPassword) {
    this.password = newPassword; // 讓 pre-save middleware 處理加密
    this.isFirstLogin = false; // 更改密碼後標記為非首次登入
    return this.save();
};

// 密碼加密中間件
userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    
    const bcrypt = require('bcryptjs');
    this.password = await bcrypt.hash(this.password, 10);
    next();
});

module.exports = mongoose.model('User', userSchema);
