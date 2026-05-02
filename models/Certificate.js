const mongoose = require('mongoose');

const certificateSchema = new mongoose.Schema({
    certificateNumber: {
        type: String,
        required: true,
        unique: true,
        index: true,
        match: [/^ACTC-EXAM-\d{4}-\d{6}$/, 'Certificate number must match format ACTC-EXAM-YYYY-XXXXXX']
    },
    exam: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Exam',
        required: true,
        index: true
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    attempt: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ExamAttempt',
        required: true,
        unique: true
    },
    issuedAt: {
        type: Date,
        required: true,
        default: Date.now
    },
    expiresAt: {
        type: Date,
        default: null
    },
    downloadCount: {
        type: Number,
        default: 0,
        min: 0
    },
    lastDownloadedAt: {
        type: Date
    },
    isRevoked: {
        type: Boolean,
        default: false
    },
    revokedAt: {
        type: Date
    },
    revokeReason: {
        type: String,
        maxlength: [500, 'Revoke reason cannot exceed 500 characters']
    }
}, {
    timestamps: true
});

certificateSchema.index({ user: 1, exam: 1 });
certificateSchema.index({ issuedAt: -1 });

module.exports = mongoose.model('Certificate', certificateSchema);
