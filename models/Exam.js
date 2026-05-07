const mongoose = require('mongoose');

const examSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Title is required'],
        trim: true,
        maxlength: [200, 'Title cannot exceed 200 characters']
    },
    description: {
        type: String,
        trim: true,
        maxlength: [2000, 'Description cannot exceed 2000 characters']
    },
    shortDescription: {
        type: String,
        trim: true,
        maxlength: [200, 'Short description cannot exceed 200 characters']
    },
    status: {
        type: String,
        enum: {
            values: ['draft', 'published', 'active', 'closed', 'archived', 'deleted'],
            message: 'Status must be one of: draft, published, active, closed, archived, deleted'
        },
        default: 'draft'
    },
    examType: {
        type: String,
        enum: {
            values: ['quiz', 'certification'],
            message: 'Exam type must be quiz or certification'
        },
        default: 'quiz'
    },
    timeLimit: {
        type: Number,
        min: [0, 'Time limit cannot be negative'],
        max: [480, 'Time limit cannot exceed 480 minutes'],
        default: 0
    },
    passingScore: {
        type: Number,
        min: [0, 'Passing score cannot be negative'],
        max: [100, 'Passing score cannot exceed 100'],
        default: 70
    },
    maxAttempts: {
        type: Number,
        min: [0, 'Max attempts cannot be negative'],
        max: [10, 'Max attempts cannot exceed 10'],
        default: 1
    },
    cooldownPeriod: {
        type: Number,
        min: [0, 'Cooldown period cannot be negative'],
        max: [365, 'Cooldown period cannot exceed 365 days'],
        default: 15
    },
    questionsPerAttempt: {
        type: Number,
        min: [1, 'Questions per attempt must be at least 1']
    },
    difficultyRatio: {
        easy: {
            type: Number,
            min: 0,
            max: 100,
            default: 20
        },
        medium: {
            type: Number,
            min: 0,
            max: 100,
            default: 60
        },
        hard: {
            type: Number,
            min: 0,
            max: 100,
            default: 20
        }
    },
    startDate: {
        type: Date
    },
    endDate: {
        type: Date,
        validate: {
            validator: function(v) {
                if (!v || !this.startDate) return true;
                return v >= this.startDate;
            },
            message: 'End date must be after or equal to start date'
        }
    },
    shuffleQuestions: {
        type: Boolean,
        default: false
    },
    shuffleOptions: {
        type: Boolean,
        default: false
    },
    showCorrectAnswers: {
        type: String,
        enum: {
            values: ['immediately', 'after_submit', 'never'],
            message: 'Show correct answers must be immediately, after_submit, or never'
        },
        default: 'after_submit'
    },
    certificateEnabled: {
        type: Boolean,
        default: false
    },
    certificateTemplate: {
        title: String,
        issuer: {
            type: String,
            default: 'ACTC'
        },
        validityPeriod: {
            type: Number,
            default: 24
        },
        certValidityYears: {
            type: Number,
            min: 0,
            max: 99,
            default: 3
        },
        language: {
            type: String,
            default: 'zh-TW'
        },
        customDesign: {
            logoPath: {
                type: String,
                validate: {
                    validator: function(v) {
                        if (!v) return true;
                        return /^\/uploads\/.+/.test(v);
                    },
                    message: 'Logo path must be a valid upload path'
                }
            },
            borderColor: String,
            footerText: String
        }
    },
    allowedMembers: {
        type: String,
        enum: {
            values: ['all_approved', 'specific'],
            message: 'Allowed members must be all_approved or specific'
        },
        default: 'all_approved'
    },
    allowedMemberIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    questionCount: {
        type: Number,
        default: 0
    },
    totalPoints: {
        type: Number,
        default: 0
    },
    source: {
        type: String,
        enum: {
            values: ['manual', 'question_bank'],
            message: 'Source must be manual or question_bank'
        },
        default: 'manual'
    },
    domainRatio: {
        type: Map,
        of: Number,
        default: {}
    },
    questionRefs: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Question'
    }],
    tags: [String],
    // 付費控制
    requiresPurchase: {
        type: Boolean,
        default: false
    },
    price: {
        type: Number,
        default: 0,
        min: 0
    },
    currency: {
        type: String,
        default: 'TWD',
        enum: ['TWD', 'USD']
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, {
    timestamps: true
});

examSchema.index({ status: 1, startDate: 1, endDate: 1 });
examSchema.index({ createdBy: 1 });

examSchema.virtual('isAvailable').get(function() {
    if (this.status !== 'active') return false;
    const now = new Date();
    if (this.startDate && now < this.startDate) return false;
    if (this.endDate && now > this.endDate) return false;
    return true;
});

examSchema.virtual('statusLabel').get(function() {
    const labels = {
        draft: '草稿',
        published: '已發布',
        active: '進行中',
        closed: '已關閉',
        archived: '已歸檔',
        deleted: '已刪除'
    };
    return labels[this.status] || this.status;
});

examSchema.pre('save', function(next) {
    if (this.isModified('difficultyRatio')) {
        const { easy, medium, hard } = this.difficultyRatio;
        const total = easy + medium + hard;
        if (Math.abs(total - 100) > 1) {
            console.warn(`Difficulty ratio total is ${total}%, adjusting to 100%`);
            const factor = 100 / total;
            this.difficultyRatio.easy = Math.round(easy * factor);
            this.difficultyRatio.medium = Math.round(medium * factor);
            this.difficultyRatio.hard = 100 - this.difficultyRatio.easy - this.difficultyRatio.medium;
        }
    }
    next();
});

examSchema.pre('save', function(next) {
    if (!this.isModified('status')) return next();
    
    const validTransitions = {
        draft: ['published', 'active', 'deleted'],
        published: ['active', 'draft', 'deleted'],
        active: ['closed', 'deleted'],
        closed: ['archived', 'deleted'],
        archived: ['deleted'],
        deleted: []
    };
    
    if (this.isNew) return next();
    
    const modifiedPaths = this.modifiedPaths();
    if (!modifiedPaths.includes('status')) return next();
    
    next();
});

module.exports = mongoose.model('Exam', examSchema);
