const mongoose = require('mongoose');

const eventSurveyResponseSchema = new mongoose.Schema(
    {
        event: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Event',
            required: [true, 'Event is required'],
            index: true
        },
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },
        registration: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'EventRegistration',
            default: null
        },
        overallRating: {
            type: Number,
            min: [1, 'overallRating must be between 1 and 5'],
            max: [5, 'overallRating must be between 1 and 5'],
            required: [true, 'overallRating is required']
        },
        instructorRating: {
            type: Number,
            min: [1, 'instructorRating must be between 1 and 5'],
            max: [5, 'instructorRating must be between 1 and 5']
        },
        materialRating: {
            type: Number,
            min: [1, 'materialRating must be between 1 and 5'],
            max: [5, 'materialRating must be between 1 and 5']
        },
        difficulty: {
            type: String,
            enum: ['too_easy', 'just_right', 'too_hard']
        },
        nps: {
            type: Number,
            min: [0, 'nps must be between 0 and 10'],
            max: [10, 'nps must be between 0 and 10']
        },
        mostValuable: {
            type: String,
            trim: true,
            maxlength: [2000, 'mostValuable cannot exceed 2000 characters']
        },
        improvementSuggestion: {
            type: String,
            trim: true,
            maxlength: [2000, 'improvementSuggestion cannot exceed 2000 characters']
        },
        interestedAdvancedCourse: {
            type: Boolean,
            default: false
        },
        interestedCorporateTraining: {
            type: Boolean,
            default: false
        },
        interestedWorkgroup: {
            type: Boolean,
            default: false
        },
        submittedAt: {
            type: Date,
            default: Date.now
        }
    },
    {
        timestamps: true
    }
);

eventSurveyResponseSchema.index({ event: 1, user: 1 }, { unique: true, partialFilterExpression: { user: { $type: 'objectId' } } });
eventSurveyResponseSchema.index({ event: 1, createdAt: -1 });

module.exports = mongoose.model('EventSurveyResponse', eventSurveyResponseSchema);
