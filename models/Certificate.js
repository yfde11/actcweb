const mongoose = require('mongoose');

const certificateSchema = new mongoose.Schema({
    certificateNumber: {
        type: String,
        required: true,
        unique: true,
        match: [/^ACTC-(EXAM|COURSE)-\d{4}-\d{6}$/, 'Certificate number must match format ACTC-EXAM-YYYY-XXXXXX or ACTC-COURSE-YYYY-XXXXXX']
    },
    certType: {
        type: String,
        enum: ['exam', 'course'],
        required: true,
        default: 'exam'
    },
    exam: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Exam',
        required: false,
        index: true
    },
    course: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CourseAttendance',
        sparse: true
    },
    recipientName: {
        type: String,
        trim: true
    },
    recipientEmail: {
        type: String,
        trim: true,
        lowercase: true
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
        index: true,
        sparse: true
    },
    attempt: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ExamAttempt',
        required: false
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
    },
    revokedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    adminNote: {
        type: String,
        maxlength: [1000, 'Admin note cannot exceed 1000 characters']
    }
}, {
    timestamps: true
});

certificateSchema.index({ user: 1, exam: 1 });
certificateSchema.index({ issuedAt: -1 });
certificateSchema.index({ attempt: 1 }, { unique: true, sparse: true });
certificateSchema.index({ certType: 1, issuedAt: -1 });
certificateSchema.index({ isRevoked: 1, expiresAt: 1 });

module.exports = mongoose.model('Certificate', certificateSchema);
