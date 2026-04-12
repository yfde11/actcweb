const mongoose = require('mongoose');

const workingGroupSchema = new mongoose.Schema(
    {
        code: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true,
            maxlength: 32
        },
        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 200
        },
        subtitle: {
            type: String,
            trim: true,
            default: '',
            maxlength: 200
        },
        description: {
            type: String,
            required: true,
            trim: true,
            maxlength: 4000
        },
        sortOrder: {
            type: Number,
            default: 0
        },
        isActive: {
            type: Boolean,
            default: true
        }
    },
    { timestamps: true }
);

workingGroupSchema.index({ isActive: 1, sortOrder: 1 });

module.exports = mongoose.model('WorkingGroup', workingGroupSchema);
