const mongoose = require('mongoose');

const certificateTypeSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        unique: true
    },
    titleZh: {
        type: String,
        required: true,
        trim: true
    },
    titleEn: {
        type: String,
        trim: true
    },
    prefix: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        match: [/^[A-Z][A-Z0-9\-]+$/, 'Prefix must start with an uppercase letter and contain only uppercase letters, digits, and hyphens']
    },
    bodyText: {
        type: String,
        maxlength: [500, 'Body text cannot exceed 500 characters']
    },
    counterKey: {
        type: String,
        unique: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

certificateTypeSchema.pre('save', function(next) {
    if (this.isModified('prefix') && this.prefix) {
        this.counterKey = this.prefix.toLowerCase().replace(/-/g, '_') + '_cert_num';
    }
    next();
});

module.exports = mongoose.model('CertificateType', certificateTypeSchema);
