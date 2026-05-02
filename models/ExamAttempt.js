const mongoose = require('mongoose');

const questionSnapshotSchema = new mongoose.Schema({
    questionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Question',
        required: true
    },
    questionNumber: {
        type: Number,
        required: true
    },
    type: {
        type: String,
        enum: ['multiple_choice', 'true_false', 'fill_in_blank'],
        required: true
    },
    content: {
        type: String,
        required: true
    },
    correctAnswer: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    points: {
        type: Number,
        required: true,
        min: 1
    },
    difficulty: {
        type: String,
        enum: ['easy', 'medium', 'hard'],
        required: true
    }
}, { _id: false });

const answerSchema = new mongoose.Schema({
    questionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Question',
        required: true
    },
    questionNumber: {
        type: Number,
        required: true
    },
    answer: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    isCorrect: {
        type: Boolean,
        default: false
    },
    pointsEarned: {
        type: Number,
        default: 0
    }
}, { _id: false });

const cheatingDetailSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['visibility_change', 'devtools', 'screenshot'],
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    warningNumber: {
        type: Number,
        min: 1
    }
}, { _id: false });

const examAttemptSchema = new mongoose.Schema({
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
    status: {
        type: String,
        enum: {
            values: ['in_progress', 'submitted', 'graded', 'expired', 'cancelled', 'auto_submitted_cheating'],
            message: 'Invalid attempt status'
        },
        default: 'in_progress',
        index: true
    },
    attemptNumber: {
        type: Number,
        required: true,
        min: 1
    },
    startedAt: {
        type: Date,
        required: true,
        default: Date.now
    },
    submittedAt: {
        type: Date
    },
    expiresAt: {
        type: Date,
        index: true
    },
    timeSpent: {
        type: Number,
        min: 0
    },
    questionSnapshot: [questionSnapshotSchema],
    answers: [answerSchema],
    score: {
        type: Number,
        min: 0,
        max: 100
    },
    passed: {
        type: Boolean
    },
    gradingDetails: {
        totalPoints: Number,
        earnedPoints: Number,
        correctCount: Number,
        incorrectCount: Number,
        unansweredCount: Number
    },
    visibilityChangeCount: {
        type: Number,
        default: 0,
        min: 0
    },
    warningCount: {
        type: Number,
        default: 0,
        min: 0
    },
    cheatingDetected: {
        type: Boolean,
        default: false,
        index: true
    },
    cheatingDetails: [cheatingDetailSchema],
    ipAddress: {
        type: String,
        trim: true
    },
    userAgent: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});

examAttemptSchema.index({ exam: 1, user: 1, status: 1 });
examAttemptSchema.index({ status: 1, expiresAt: 1 });
examAttemptSchema.index({ exam: 1, status: 1, startedAt: -1 });
examAttemptSchema.index(
    { exam: 1, user: 1 },
    { unique: true, partialFilterExpression: { status: 'in_progress' } }
);

examAttemptSchema.virtual('isExpired').get(function() {
    if (!this.expiresAt) return false;
    return new Date() > this.expiresAt;
});

examAttemptSchema.virtual('timeRemaining').get(function() {
    if (!this.expiresAt) return null;
    const remaining = Math.max(0, Math.floor((this.expiresAt - new Date()) / 1000));
    return remaining;
});

module.exports = mongoose.model('ExamAttempt', examAttemptSchema);
