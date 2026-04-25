const mongoose = require('mongoose');

const notificationLogSchema = new mongoose.Schema(
    {
        event: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Event',
            default: null,
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
        type: {
            type: String,
            enum: [
                'registration_success',
                'payment_pending',
                'payment_confirmed',
                'payment_rejected',
                'event_reminder',
                'event_day_notice',
                'post_event_survey',
                'material_available',
                'certificate_available',
                'custom'
            ],
            required: [true, 'Notification type is required']
        },
        channel: {
            type: String,
            enum: ['email'],
            default: 'email'
        },
        recipientEmail: {
            type: String,
            trim: true,
            lowercase: true
        },
        subject: {
            type: String,
            trim: true,
            maxlength: [300, 'Subject cannot exceed 300 characters']
        },
        status: {
            type: String,
            enum: ['sent', 'failed', 'skipped'],
            default: 'skipped',
            index: true
        },
        errorMessage: {
            type: String,
            trim: true,
            maxlength: [2000, 'errorMessage cannot exceed 2000 characters']
        },
        sentAt: {
            type: Date,
            default: Date.now
        }
    },
    {
        timestamps: true
    }
);

notificationLogSchema.index({ event: 1, type: 1, createdAt: -1 });
notificationLogSchema.index({ recipientEmail: 1, createdAt: -1 });

module.exports = mongoose.model('NotificationLog', notificationLogSchema);
