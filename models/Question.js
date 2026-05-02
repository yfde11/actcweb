const mongoose = require('mongoose');
const Counter = require('./Counter');

const optionSchema = new mongoose.Schema({
    text: {
        type: String,
        required: true,
        maxlength: [500, 'Option text cannot exceed 500 characters']
    },
    label: {
        type: String,
        required: true
    }
}, { _id: false });

// D5 MIGRATION REQUIRED — dual exam fields are intentionally inconsistent:
//
// `exam`    — set at question-creation time for manually authored questions
//             (routes/exams.js POST /:id/questions and bulk import, buildQuestionData).
//             All admin queries (list, count, delete, reorder, statistics, preview,
//             clone) filter by `{ exam: examId }`. This field is undefined for
//             question-bank questions that were never explicitly authored under a
//             single exam.
//
// `examIds` — array field updated via `$addToSet` by examGeneration.js when a
//             question-bank exam is generated (both random and manual modes).
//             examGeneration.js matches unassigned bank questions with
//             `{ examIds: { $exists: false } }` or `{ examIds: { $size: 0 } }`.
//             This field is typically empty for manually authored questions.
//
// The two fields are NOT kept in sync. Consolidating to a single field requires
// a data migration:
//   1. For every document where `exam` is set and `examIds` is empty, push
//      `exam` into `examIds`.
//   2. Update all query sites in routes/exams.js that filter `{ exam: id }` to
//      filter `{ examIds: id }` (or `{ $or: [{ exam: id }, { examIds: id }] }`
//      during a transitional window).
//   3. Remove the `exam` field from the schema once all call sites are migrated.
// Do NOT remove either field or change any query until the migration is complete.
const questionSchema = new mongoose.Schema({
    exam: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Exam',
        index: true
    },
    examIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Exam',
        index: true
    }],
    domain: {
        type: Number,
        min: 1,
        max: 8,
        index: true,
        validate: {
            validator: function(v) {
                return v === undefined || (v >= 1 && v <= 8);
            },
            message: 'Domain must be between 1 and 8 (CISSP domains)'
        }
    },
    questionNumber: {
        type: Number
    },
    type: {
        type: String,
        enum: {
            values: ['multiple_choice', 'true_false', 'fill_in_blank'],
            message: 'Question type must be multiple_choice, true_false, or fill_in_blank'
        },
        required: true
    },
    difficulty: {
        type: String,
        enum: {
            values: ['easy', 'medium', 'hard'],
            message: 'Difficulty must be easy, medium, or hard'
        },
        required: true,
        default: 'medium',
        index: true
    },
    content: {
        type: String,
        required: [true, 'Question content is required'],
        maxlength: [2000, 'Question content cannot exceed 2000 characters']
    },
    options: [optionSchema],
    correctOptionIndex: {
        type: Number,
        min: 0,
        max: 5
    },
    correctBoolean: {
        type: Boolean
    },
    correctAnswers: [String],
    acceptableAnswers: [String],
    points: {
        type: Number,
        min: [1, 'Points must be at least 1'],
        max: [100, 'Points cannot exceed 100'],
        default: 1
    },
    explanation: {
        type: String,
        maxlength: [1000, 'Explanation cannot exceed 1000 characters']
    }
}, {
    timestamps: true
});

questionSchema.index({ domain: 1, difficulty: 1 });

questionSchema.pre('save', async function(next) {
    if (this.isNew && !this.questionNumber) {
        try {
            const counter = await Counter.getNextSequence('questionNumber');
            this.questionNumber = counter;
            next();
        } catch (error) {
            next(error);
        }
    } else {
        next();
    }
});

questionSchema.pre('save', function(next) {
    if (this.isModified('acceptableAnswers')) {
        this.acceptableAnswers = this.acceptableAnswers.map(a => a.toLowerCase().trim());
    }
    next();
});

// Note: Removed pre('remove') middleware as questions can now belong to multiple exams via examIds

module.exports = mongoose.model('Question', questionSchema);
