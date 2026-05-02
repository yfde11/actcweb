const mongoose = require('mongoose');

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

const questionSchema = new mongoose.Schema({
    exam: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Exam',
        required: true,
        index: true
    },
    questionNumber: {
        type: Number,
        required: true
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

questionSchema.index({ exam: 1, questionNumber: 1 }, { unique: true });
questionSchema.index({ exam: 1, difficulty: 1 });

questionSchema.pre('save', async function(next) {
    if (this.isNew && !this.questionNumber) {
        try {
            const lastQuestion = await this.constructor.findOne(
                { exam: this.exam },
                { questionNumber: 1 },
                { sort: { questionNumber: -1 } }
            );
            this.questionNumber = lastQuestion ? lastQuestion.questionNumber + 1 : 1;
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

questionSchema.pre('remove', async function(next) {
    try {
        await this.constructor.updateMany(
            { exam: this.exam, questionNumber: { $gt: this.questionNumber } },
            { $inc: { questionNumber: -1 } }
        );
        next();
    } catch (error) {
        next(error);
    }
});

module.exports = mongoose.model('Question', questionSchema);
