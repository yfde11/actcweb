const mongoose = require('mongoose');

const eventMaterialSchema = new mongoose.Schema(
    {
        event: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Event',
            required: [true, 'Event is required'],
            index: true
        },
        title: {
            type: String,
            required: [true, 'Title is required'],
            trim: true,
            maxlength: [200, 'Title cannot exceed 200 characters']
        },
        description: {
            type: String,
            trim: true,
            maxlength: [1000, 'Description cannot exceed 1000 characters']
        },
        category: {
            type: String,
            enum: ['pre_event', 'in_event', 'post_event', 'recording', 'certificate_related', 'other'],
            default: 'other'
        },
        accessLevel: {
            type: String,
            enum: ['public', 'login_required', 'registered_only', 'paid_only', 'attended_only'],
            default: 'registered_only'
        },
        file: {
            path: { type: String, trim: true },
            originalName: { type: String, trim: true },
            size: { type: Number, min: [0, 'File size cannot be negative'] },
            mimeType: { type: String, trim: true }
        },
        externalUrl: {
            type: String,
            trim: true
        },
        isActive: {
            type: Boolean,
            default: true
        },
        availableFrom: {
            type: Date
        },
        availableUntil: {
            type: Date
        },
        downloadCount: {
            type: Number,
            default: 0,
            min: [0, 'Download count cannot be negative']
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null
        }
    },
    {
        timestamps: true
    }
);

eventMaterialSchema.index({ event: 1, isActive: 1, accessLevel: 1, category: 1 });
eventMaterialSchema.index({ event: 1, createdAt: -1 });

module.exports = mongoose.model('EventMaterial', eventMaterialSchema);
