const PDFDocument = require('pdfkit');
const Certificate = require('../models/Certificate');
const ExamAttempt = require('../models/ExamAttempt');
const Exam = require('../models/Exam');
const CourseAttendance = require('../models/CourseAttendance');
const User = require('../models/User');
const fs = require('fs');
const path = require('path');

/**
 * Shared certificate verification logic used by both the public API endpoint
 * and the member-exams router.
 *
 * Returns one of:
 *   { ok: true, data: { certificateNumber, issuedAt, expiresAt, certType, exam, course, user } }
 *   { ok: false, statusCode, code, message }
 *
 * @param {string} certificateNumber
 * @returns {Promise<Object>}
 */
async function verifyCertificate(certificateNumber) {
    const certificate = await Certificate.findOne({
        certificateNumber,
        isRevoked: { $ne: true }
    })
        .populate('exam', 'title')
        .populate('course', 'courseName')
        .populate('user', 'username fullName');

    if (!certificate) {
        return { ok: false, statusCode: 404, code: 'CERTIFICATE_NOT_FOUND', message: '證書不存在或已被撤銷' };
    }

    if (certificate.expiresAt && new Date() > certificate.expiresAt) {
        return { ok: false, statusCode: 403, code: 'CERTIFICATE_EXPIRED', message: '證書已過期' };
    }

    return {
        ok: true,
        data: {
            certificateNumber: certificate.certificateNumber,
            certType: certificate.certType,
            issuedAt: certificate.issuedAt,
            expiresAt: certificate.expiresAt,
            exam: certificate.exam,
            course: certificate.course,
            user: {
                username: certificate.user.username,
                fullName: certificate.user.fullName
            }
        }
    };
}

// Default font for Chinese support
const FONT_PATH = path.join(__dirname, '../fonts/NotoSansCJKtc-Regular.ttf');
const BOLD_FONT_PATH = path.join(__dirname, '../fonts/NotoSansCJKtc-Bold.otf');

/**
 * Check if Chinese font is available
 */
function hasChineseFont() {
    return fs.existsSync(FONT_PATH);
}

/**
 * Generate certificate PDF on-the-fly (streaming)
 * @param {string} certificateId - Certificate ID
 * @param {Object} res - Express response object (for streaming)
 * @returns {Promise<void>}
 */
async function generateCertificatePDF(certificateId, res) {
    if (!hasChineseFont()) {
        throw new Error('CHINESE_FONT_NOT_FOUND');
    }

    const certificate = await Certificate.findById(certificateId)
        .populate('exam')
        .populate('course')
        .populate('user');

    if (!certificate) {
        throw new Error('CERTIFICATE_NOT_FOUND');
    }

    if (certificate.isRevoked) {
        throw new Error('CERTIFICATE_REVOKED');
    }

    const user = certificate.user;
    const isCourse = certificate.certType === 'course';

    // Get attempt for additional details (exam type only)
    let attempt = null;
    if (!isCourse && certificate.attempt) {
        attempt = await ExamAttempt.findById(certificate.attempt);
    }

    // Create PDF document
    const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margins: { top: 50, bottom: 50, left: 50, right: 50 }
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="certificate-${certificate.certificateNumber}.pdf"`);

    // Pipe PDF to response
    doc.pipe(res);

    // Register fonts
    doc.registerFont('Regular', FONT_PATH);
    doc.registerFont('Bold', BOLD_FONT_PATH || FONT_PATH);
    doc.font('Regular');

    // Certificate template (only exam type has template)
    const template = (!isCourse && certificate.exam && certificate.exam.certificateTemplate) ? certificate.exam.certificateTemplate : {};

    // Draw border
    if (template.customDesign?.borderColor) {
        doc.rect(30, 30, doc.page.width - 60, doc.page.height - 60)
           .strokeColor(template.customDesign.borderColor)
           .lineWidth(3)
           .stroke();
    } else {
        doc.rect(30, 30, doc.page.width - 60, doc.page.height - 60)
           .strokeColor('#1a365d')
           .lineWidth(2)
           .stroke();
    }

    // Logo (if specified)
    if (template.customDesign?.logoPath && fs.existsSync(path.join(__dirname, '..', template.customDesign.logoPath))) {
        doc.image(path.join(__dirname, '..', template.customDesign.logoPath),
                  doc.page.width / 2 - 50, 60, { width: 100 });
    }

    // Title
    doc.font('Bold')
       .fontSize(36)
       .fillColor('#1a365d')
       .text(template.title || (isCourse ? '課程結業證書' : '證書'), { align: 'center' });

    doc.moveDown(0.5);

    // Issuer
    doc.font('Regular')
       .fontSize(16)
       .fillColor('#4a5568')
       .text(`發證機構：${template.issuer || 'ACTC'}`, { align: 'center' });

    doc.moveDown(1.5);

    // Certificate Number
    doc.fontSize(12)
       .fillColor('#718096')
       .text(`證書編號：${certificate.certificateNumber}`, { align: 'center' });

    doc.moveDown(1);

    // Recipient name: prefer certificate.recipientName, fallback to user fields
    const recipientDisplayName = certificate.recipientName
        || (user && (user.fullName || user.username))
        || '—';

    doc.font('Bold')
       .fontSize(24)
       .fillColor('#2d3748')
       .text(recipientDisplayName, { align: 'center' });

    doc.moveDown(0.5);

    // Achievement text - differs by certType
    if (isCourse) {
        const courseName = certificate.course ? certificate.course.courseName : '本課程';
        doc.font('Regular')
           .fontSize(16)
           .text(`已完成「${courseName}」課程訓練`, { align: 'center' });
        // No score line for course certificates
    } else {
        const examTitle = certificate.exam ? certificate.exam.title : '考試';
        doc.font('Regular')
           .fontSize(16)
           .text(`已完成「${examTitle}」考試並通過認證`, { align: 'center' });

        // Score (if available, exam type only)
        if (attempt && attempt.score !== null) {
            doc.moveDown(0.5);
            doc.fontSize(14)
               .text(`成績：${attempt.score} 分`, { align: 'center' });
        }
    }

    doc.moveDown(2);

    // Issue date
    const issuedDate = certificate.issuedAt.toLocaleDateString('zh-TW', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    doc.fontSize(14)
       .text(`發證日期：${issuedDate}`, { align: 'center' });

    // Expiry date (if any)
    if (certificate.expiresAt) {
        const expiryDate = certificate.expiresAt.toLocaleDateString('zh-TW', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        doc.moveDown(0.5);
        doc.text(`有效期限：${expiryDate}`, { align: 'center' });
    } else {
        doc.moveDown(0.5);
        doc.text('有效期限：永久', { align: 'center' });
    }

    // Footer text
    if (template.customDesign?.footerText) {
        doc.moveDown(2);
        doc.fontSize(10)
           .fillColor('#a0aec0')
           .text(template.customDesign.footerText, { align: 'center' });
    }

    // Verification URL
    const siteUrl = (process.env.SITE_URL || 'https://actc.org.tw').replace(/\/$/, '');
    doc.moveDown(0.5);
    doc.fontSize(10)
       .text(`驗證網址：${siteUrl}/verify-certificate/${certificate.certificateNumber}`,
             { align: 'center' });

    // Finalize PDF
    doc.end();

    // Update download count
    certificate.downloadCount += 1;
    certificate.lastDownloadedAt = new Date();
    await certificate.save();
}

/**
 * Regenerate certificate (admin function)
 * @param {string} attemptId - ExamAttempt ID
 * @returns {Promise<Object>} New or existing certificate
 */
async function regenerateCertificate(attemptId) {
    const attempt = await ExamAttempt.findById(attemptId).populate('exam').populate('user', 'fullName username');
    if (!attempt) {
        throw new Error('ATTEMPT_NOT_FOUND');
    }

    if (!attempt.passed || attempt.cheatingDetected) {
        throw new Error('ATTEMPT_NOT_ELIGIBLE');
    }

    // Check if already exists (non-revoked)
    let certificate = await Certificate.findOne({ attempt: attemptId, isRevoked: false });
    if (certificate) {
        return certificate;
    }

    // Generate new certificate
    const Counter = require('../models/Counter');
    const seq = await Counter.getNextSequence('certificate_number');
    const year = new Date().getFullYear();
    const certNumber = `ACTC-EXAM-${year}-${String(seq).padStart(6, '0')}`;

    // Calculate expiresAt using certValidityYears fallback logic
    let expiresAt = null;
    const tmpl = attempt.exam.certificateTemplate || {};
    if (tmpl.certValidityYears !== undefined && tmpl.certValidityYears !== null) {
        if (tmpl.certValidityYears === 0) {
            expiresAt = null; // 永久有效
        } else {
            expiresAt = new Date();
            expiresAt.setFullYear(expiresAt.getFullYear() + tmpl.certValidityYears);
        }
    } else if (tmpl.validityPeriod > 0) {
        expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + tmpl.validityPeriod);
    }

    certificate = new Certificate({
        certificateNumber: certNumber,
        certType: 'exam',
        exam: attempt.exam._id,
        user: attempt.user._id || attempt.user,
        recipientName: attempt.user.fullName || attempt.user.username || null,
        attempt: attempt._id,
        expiresAt
    });

    await certificate.save();

    return certificate;
}

/**
 * Issue a course attendance certificate (admin function)
 * @param {string} attendanceId - CourseAttendance ID
 * @param {number} [certValidityYears] - validity in years; 0 = permanent; undefined = permanent
 * @returns {Promise<{ attendance, certificate }>}
 */
async function issueCourseAttendanceCertificate(attendanceId, certValidityYears) {
    const attendance = await CourseAttendance.findById(attendanceId).populate('user');
    if (!attendance) {
        throw new Error('ATTENDANCE_NOT_FOUND');
    }

    if (attendance.certificateIssued) {
        throw new Error('CERTIFICATE_ALREADY_ISSUED');
    }

    const Counter = require('../models/Counter');
    const seq = await Counter.getNextSequence('certificate_course_number');
    const year = new Date().getFullYear();
    const certNumber = `ACTC-COURSE-${year}-${String(seq).padStart(6, '0')}`;

    // Calculate expiresAt
    let expiresAt = null;
    if (certValidityYears !== undefined && certValidityYears !== null) {
        if (certValidityYears > 0) {
            expiresAt = new Date();
            expiresAt.setFullYear(expiresAt.getFullYear() + certValidityYears);
        }
        // 0 = 永久有效，expiresAt = null
    }

    const certificate = new Certificate({
        certificateNumber: certNumber,
        certType: 'course',
        course: attendance._id,
        user: attendance.user ? attendance.user._id : null,
        recipientName: attendance.recipientName,
        recipientEmail: attendance.recipientEmail || null,
        expiresAt
    });

    await certificate.save();

    // Update attendance record
    attendance.certificateIssued = true;
    attendance.certificate = certificate._id;
    await attendance.save();

    return { attendance, certificate };
}

module.exports = {
    verifyCertificate,
    generateCertificatePDF,
    regenerateCertificate,
    issueCourseAttendanceCertificate
};
