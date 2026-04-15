const mongoose = require('mongoose');

const eventRegistrationSchema = new mongoose.Schema({
    event: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Event',
        required: [true, 'Event is required'],
        index: true
    },
    email: {
        type: String,
        required: [true, 'Email is required'],
        trim: true,
        lowercase: true,
        maxlength: [320, 'Email is too long']
    },
    name: {
        type: String,
        required: [true, 'Name is required'],
        trim: true,
        maxlength: [200, 'Name cannot exceed 200 characters']
    },
    phone: {
        type: String,
        trim: true,
        maxlength: [50, 'Phone cannot exceed 50 characters']
    },
    status: {
        type: String,
        required: true,
        enum: {
            values: ['confirmed', 'waitlist'],
            message: 'status must be confirmed or waitlist'
        }
    },
    waitlistPosition: {
        type: Number,
        min: [1, 'waitlistPosition must be at least 1']
    }
}, {
    timestamps: true
});

eventRegistrationSchema.index({ event: 1, email: 1 }, { unique: true });
eventRegistrationSchema.index({ event: 1, status: 1, waitlistPosition: 1 });
eventRegistrationSchema.index({ event: 1, status: 1, createdAt: 1 });

/** @param {string} email */
eventRegistrationSchema.statics.normalizeEmail = function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
};

module.exports = mongoose.model('EventRegistration', eventRegistrationSchema);
