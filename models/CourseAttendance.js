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
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, '使用者為必填']
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
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, '建立者為必填']
    }
}, {
    timestamps: true
});

courseAttendanceSchema.index({ user: 1, attendanceDate: -1 });
courseAttendanceSchema.index({ certificateIssued: 1 });

module.exports = mongoose.model('CourseAttendance', courseAttendanceSchema);
