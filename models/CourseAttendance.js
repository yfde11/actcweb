const mongoose = require('mongoose');

const courseAttendanceSchema = new mongoose.Schema({
    courseName: {
        type: String,
        required: [true, '課程名稱為必填'],
        trim: true
    },
    courseCode: {
        type: String,
        trim: true
    },
    courseEnglishName: {
        type: String,
        trim: true
    },
    recipientName: {
        type: String,
        required: [true, '受證者姓名為必填'],
        trim: true
    },
    recipientEnglishName: {
        type: String,
        trim: true
    },
    recipientEmail: {
        type: String,
        trim: true,
        lowercase: true
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    attendanceDate: {
        type: Date,
        required: [true, '出席日期為必填']
    },
    completionHours: {
        type: Number,
        min: 0
    },
    instructorName: {
        type: String,
        trim: true
    },
    notes: {
        type: String,
        maxlength: [1000, '備註不得超過 1000 字元']
    },
    certificateIssued: {
        type: Boolean,
        default: false
    },
    certificate: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Certificate',
        sparse: true
    },
    lastEditedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    lastEditedAt: {
        type: Date
    },
    editHistory: [{
        editedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        editedAt: {
            type: Date,
            default: Date.now
        },
        changes: {
            type: Object,
            default: {}
        },
        reason: {
            type: String,
            trim: true,
            maxlength: [500, '修改原因不得超過 500 字元']
        }
    }],
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, '建立者為必填']
    }
}, {
    timestamps: true
});

courseAttendanceSchema.index({ user: 1, attendanceDate: -1 }, { sparse: true });
courseAttendanceSchema.index({ recipientEmail: 1, attendanceDate: -1 }, { sparse: true });
courseAttendanceSchema.index({ certificateIssued: 1 });
courseAttendanceSchema.index({ courseCode: 1 });
courseAttendanceSchema.index({ courseName: 1 });
courseAttendanceSchema.index({ recipientName: 1 });

module.exports = mongoose.model('CourseAttendance', courseAttendanceSchema);
