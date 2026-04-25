const mongoose = require('mongoose');

const eventRegistrationSchema = new mongoose.Schema({
    event: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Event',
        required: [true, 'Event is required'],
        index: true
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
        index: true
    },
    participantEmail: {
        type: String,
        required: [true, 'Email is required'],
        trim: true,
        lowercase: true,
        maxlength: [320, 'Email is too long']
    },
    participantName: {
        type: String,
        required: [true, 'Name is required'],
        trim: true,
        maxlength: [200, 'Name cannot exceed 200 characters']
    },
    participantPhone: {
        type: String,
        trim: true,
        maxlength: [50, 'Phone cannot exceed 50 characters']
    },
    organization: {
        type: String,
        trim: true,
        maxlength: [200, 'Organization cannot exceed 200 characters']
    },
    title: {
        type: String,
        trim: true,
        maxlength: [200, 'Title cannot exceed 200 characters']
    },
    status: {
        type: String,
        required: true,
        enum: {
            values: ['registered', 'waitlisted', 'pending_approval', 'cancelled', 'rejected'],
            message: 'status must be one of: registered, waitlisted, pending_approval, cancelled, rejected'
        }
    },
    paymentStatus: {
        type: String,
        enum: ['none', 'payment_pending', 'payment_submitted', 'paid', 'payment_rejected', 'refunded'],
        default: 'none'
    },
    attendanceStatus: {
        type: String,
        enum: ['not_checked_in', 'attended', 'no_show'],
        default: 'not_checked_in'
    },
    ticketType: {
        type: String,
        enum: ['free', 'regular', 'member', 'early_bird', 'group'],
        default: 'free'
    },
    amountDue: {
        type: Number,
        min: [0, 'Amount due cannot be negative'],
        default: 0
    },
    currency: {
        type: String,
        default: 'TWD'
    },
    paymentProof: {
        lastFiveDigits: {
            type: String,
            trim: true,
            maxlength: [20, 'lastFiveDigits cannot exceed 20 characters']
        },
        note: {
            type: String,
            trim: true,
            maxlength: [1000, 'Payment note cannot exceed 1000 characters']
        },
        amount: {
            type: Number,
            min: [0, 'Payment amount cannot be negative']
        },
        file: {
            path: { type: String, trim: true },
            originalName: { type: String, trim: true },
            size: { type: Number, min: [0, 'File size cannot be negative'] },
            mimeType: { type: String, trim: true }
        },
        submittedAt: { type: Date },
        reviewedAt: { type: Date },
        reviewedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },
        reviewNote: {
            type: String,
            trim: true,
            maxlength: [1000, 'Review note cannot exceed 1000 characters']
        }
    },
    waitlistPosition: {
        type: Number,
        min: [1, 'waitlistPosition must be at least 1']
    },
    checkedInAt: {
        type: Date
    },
    cancelledAt: {
        type: Date
    }
}, {
    timestamps: true,
    // 讀寫歷年 BSON 內額外欄位（例如舊的 name / email 未 migration 的報名筆）以便 API 可合併至 participant*。
    strict: false
});

eventRegistrationSchema.index({ event: 1, participantEmail: 1 }, { unique: true });
eventRegistrationSchema.index({ event: 1, status: 1, waitlistPosition: 1 });
eventRegistrationSchema.index({ event: 1, status: 1, createdAt: 1 });
eventRegistrationSchema.index({ event: 1, status: 1 });
eventRegistrationSchema.index({ participantEmail: 1 });

// Backward compatibility for existing code paths using old field names.
eventRegistrationSchema.virtual('email')
    .get(function getEmail() {
        return this.participantEmail;
    })
    .set(function setEmail(v) {
        this.participantEmail = v;
    });

eventRegistrationSchema.virtual('name')
    .get(function getName() {
        return this.participantName;
    })
    .set(function setName(v) {
        this.participantName = v;
    });

eventRegistrationSchema.virtual('phone')
    .get(function getPhone() {
        return this.participantPhone;
    })
    .set(function setPhone(v) {
        this.participantPhone = v;
    });

/** @param {string} email */
eventRegistrationSchema.statics.normalizeEmail = function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
};

eventRegistrationSchema.pre('validate', function normalizeRegistrationFields(next) {
    if (this.participantEmail) {
        this.participantEmail = String(this.participantEmail).trim().toLowerCase();
    }
    if (this.status === 'confirmed') {
        this.status = 'registered';
    }
    if (this.status === 'waitlist') {
        this.status = 'waitlisted';
    }
    if (this.status === 'waitlisted' && !this.waitlistPosition) {
        this.waitlistPosition = undefined;
    }
    next();
});

eventRegistrationSchema.set('toJSON', { virtuals: true });
eventRegistrationSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('EventRegistration', eventRegistrationSchema);
