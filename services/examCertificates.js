const PDFDocument = require('pdfkit');
const Certificate = require('../models/Certificate');
const CertificateType = require('../models/CertificateType');
const ExamAttempt = require('../models/ExamAttempt');
const Exam = require('../models/Exam');
const CourseAttendance = require('../models/CourseAttendance');
const Counter = require('../models/Counter');
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
        .populate('user', 'username fullName englishName')
        .populate('certTypeRef', 'name titleZh');

    if (!certificate) {
        return { ok: false, statusCode: 404, code: 'CERTIFICATE_NOT_FOUND', message: '證書不存在或已被撤銷' };
    }

    if (certificate.expiresAt && new Date() > certificate.expiresAt) {
        return { ok: false, statusCode: 403, code: 'CERTIFICATE_EXPIRED', message: '證書已過期' };
    }

    if (!certificate.user && certificate.recipientEmail) {
        const linkedUser = await User.findOne({ email: certificate.recipientEmail.toLowerCase() }).select('username fullName englishName');
        if (linkedUser) {
            certificate.user = linkedUser;
            Certificate.updateOne({ _id: certificate._id }, { $set: { user: linkedUser._id } }).catch(err => console.error('Link user to certificate in verify error:', err));
        }
    }

    return {
        ok: true,
        data: {
            certificateNumber: certificate.certificateNumber,
            certType: certificate.certType,
            certTypeName: certificate.certTypeRef?.titleZh || null,
            issuedAt: certificate.issuedAt,
            expiresAt: certificate.expiresAt,
            exam: certificate.exam,
            course: certificate.course,
            recipientName: certificate.recipientName || null,
            recipientEnglishName: certificate.recipientEnglishName || null,
            recipientEmail: certificate.recipientEmail || null,
            holderName: certificate.recipientName
                || (certificate.user && (certificate.user.fullName || certificate.user.username))
                || '—',
            holderEnglishName: certificate.recipientEnglishName
                || (certificate.user && certificate.user.englishName)
                || null,
            user: certificate.user
                ? { username: certificate.user.username, fullName: certificate.user.fullName, englishName: certificate.user.englishName }
                : { username: null, fullName: certificate.recipientName || null, englishName: certificate.recipientEnglishName || null }
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
function drawCertificateLayout(doc, data) {
    const W = doc.page.width;   // 841.89
    const H = doc.page.height;  // 595.28
    const NAVY  = '#003366';
    const GOLD  = '#D4AF37';
    const GRAY  = '#888888';
    const cx    = W / 2;
    const marginX  = 55;
    const contentW = W - marginX * 2;

    // ── Borders ───────────────────────────────────────────────────────────────
    doc.rect(18, 18, W - 36, H - 36)
       .strokeColor(GOLD).lineWidth(3).stroke();
    doc.rect(30, 30, W - 60, H - 60)
       .strokeColor(NAVY).lineWidth(1.5).stroke();

    // ── Logo ──────────────────────────────────────────────────────────────────
    const logoPath = path.join(__dirname, '../public/assets/images/actc-logo.png');
    const logoFallback = path.join(__dirname, '../public/assets/images/actc-logo.jpg');
    const logoSrc = fs.existsSync(logoPath) ? logoPath : (fs.existsSync(logoFallback) ? logoFallback : null);

    const LOGO_H   = 50;
    const LOGO_TOP = 55;
    if (logoSrc) {
        doc.image(logoSrc, cx - 30, LOGO_TOP, { height: LOGO_H, fit: [60, LOGO_H] });
    }

    // ── Title ─────────────────────────────────────────────────────────────────
    const titleTop = 100;
    doc.font('Bold').fontSize(28).fillColor(NAVY)
       .text(data.titleZh, marginX, titleTop, { width: contentW, align: 'center' });

    const subtitleTop = 132;
    doc.font('Regular').fontSize(11).fillColor(NAVY)
       .text(data.titleEn, marginX, subtitleTop, { width: contentW, align: 'center' });

    // ── Gold divider ──────────────────────────────────────────────────────────
    const dividerY = 150;
    doc.moveTo(W * 0.25, dividerY).lineTo(W * 0.75, dividerY)
       .strokeColor(GOLD).lineWidth(1).stroke();

    // ── Award phrase ──────────────────────────────────────────────────────────
    const awardZhY = 167;
    doc.font('Bold').fontSize(13).fillColor(NAVY)
       .text('特此頒發予', marginX, awardZhY, { width: contentW, align: 'center' });

    const awardEnY = 181;
    doc.font('Regular').fontSize(10).fillColor(NAVY)
       .text('This certificate is hereby awarded to', marginX, awardEnY, { width: contentW, align: 'center' });

    // ── Recipient name & Spacing adjustment ────────────────────────────────────
    // ── Recipient name & Spacing adjustment ────────────────────────────────────
    let nameY = 216;
    let congratsZhY = 286;
    let congratsEnY = 303;
    let titleNameY = 338;
    let nameEnY = 244;

    const hasEnName = !!(data.recipientEnglishName && data.recipientEnglishName.trim());

    if (hasEnName) {
        nameY = 202;
        congratsZhY = 292;
        congratsEnY = 309;
        titleNameY = 345;
    }

    doc.font('Bold').fontSize(hasEnName ? 32 : 34).fillColor(NAVY)
       .text(data.recipientDisplayName, marginX, nameY, { width: contentW, align: 'center' });

    if (hasEnName) {
        doc.font('Regular').fontSize(18).fillColor(NAVY)
           .text(data.recipientEnglishName.trim(), marginX, nameEnY, { width: contentW, align: 'center' });
    }

    // ── Congrats phrase ───────────────────────────────────────────────────────
    doc.font('Bold').fontSize(15).fillColor(NAVY)
       .text('恭喜順利完成', marginX, congratsZhY, { width: contentW, align: 'center' });

    doc.font('Regular').fontSize(11).fillColor(NAVY)
       .text('has successfully completed', marginX, congratsEnY, { width: contentW, align: 'center' });

    // ── Standalone course/exam name ───────────────────────────────────────────
    doc.font('Bold').fontSize(18).fillColor(NAVY)
       .text(data.customBodyText || data.displayTitle, marginX + 40, titleNameY, { width: contentW - 80, align: 'center' });

    // ── Course / Exam info — two-column layout ────────────────────────────────
    const infoLabelY = 394;
    const infoLabelEnY = 409;
    const infoValueY = 398;

    const colLeftX  = cx - 230;
    const colRightX = cx + 50;
    const colW      = 175;

    if (data.isCourse && data.course) {
        // Left — Course Date
        doc.font('Bold').fontSize(13).fillColor(NAVY)
           .text('課程日期', colLeftX, infoLabelY);
        doc.font('Regular').fontSize(10).fillColor(GRAY)
           .text('Course Date', colLeftX, infoLabelEnY);
        if (data.course.attendanceDate) {
            const d = new Date(data.course.attendanceDate);
            const dateVal = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
            doc.font('Bold').fontSize(16).fillColor(NAVY)
               .text(dateVal, colLeftX + 90, infoValueY);
        }
        // Right — Course Duration
        doc.font('Bold').fontSize(13).fillColor(NAVY)
           .text('課程時數', colRightX, infoLabelY);
        doc.font('Regular').fontSize(10).fillColor(GRAY)
           .text('Course Duration', colRightX, infoLabelEnY);
        if (data.course.completionHours) {
            doc.font('Bold').fontSize(16).fillColor(NAVY)
               .text(`${data.course.completionHours}小時`, colRightX + 90, infoLabelY - 1);
            doc.font('Regular').fontSize(10).fillColor(GRAY)
               .text(`${data.course.completionHours} Hours`, colRightX + 90, infoLabelEnY);
        }
    } else if (!data.isCourse) {
        // Left — Issue Date
        const d = new Date(data.issuedAt);
        const issuedDateVal = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
        doc.font('Bold').fontSize(13).fillColor(NAVY)
           .text('發證日期', colLeftX, infoLabelY);
        doc.font('Regular').fontSize(10).fillColor(GRAY)
           .text('Issue Date', colLeftX, infoLabelEnY);
        doc.font('Bold').fontSize(16).fillColor(NAVY)
           .text(issuedDateVal, colLeftX + 90, infoValueY);
        // Right — Validity
        doc.font('Bold').fontSize(13).fillColor(NAVY)
           .text('有效期限', colRightX, infoLabelY);
        doc.font('Regular').fontSize(10).fillColor(GRAY)
           .text('Valid Until', colRightX, infoLabelEnY);
        if (data.expiresAt) {
            const dExp = new Date(data.expiresAt);
            const expiryDateVal = `${dExp.getFullYear()}.${String(dExp.getMonth() + 1).padStart(2, '0')}.${String(dExp.getDate()).padStart(2, '0')}`;
            doc.font('Bold').fontSize(16).fillColor(NAVY)
               .text(expiryDateVal, colRightX + 90, infoValueY);
        } else {
            doc.font('Bold').fontSize(16).fillColor(NAVY)
               .text('永久', colRightX + 90, infoLabelY - 1);
            doc.font('Regular').fontSize(10).fillColor(GRAY)
               .text('Permanent', colRightX + 90, infoLabelEnY);
        }
    }

    // ── Bottom section ────────────────────────────────────────────────────────
    const bottomY = 455;

    // Left — Certificate number
    doc.font('Bold').fontSize(11).fillColor(NAVY)
       .text('證書編號：', colLeftX, bottomY);
    doc.font('Regular').fontSize(10).fillColor(GRAY)
       .text('Certificate No.', colLeftX, bottomY + 15);

    const certNum = data.certificateNumber;
    const lastHyphenIndex = certNum.lastIndexOf('-');
    const certNumPrefix = lastHyphenIndex !== -1 ? certNum.substring(0, lastHyphenIndex + 1) : certNum;
    const certNumSerial = lastHyphenIndex !== -1 ? certNum.substring(lastHyphenIndex + 1) : '';

    doc.font('Bold').fontSize(11).fillColor(NAVY)
       .text(certNumPrefix, colLeftX + 90, bottomY);
    doc.font('Bold').fontSize(11).fillColor(NAVY)
       .text(certNumSerial, colLeftX + 90, bottomY + 15);

    // Right — Signature block side-by-side with Chairman
    const signPath = path.join(__dirname, '../public/assets/images/EricMaoSign.png');
    const sigImgW = 100;
    const sigImgH = 30;
    if (fs.existsSync(signPath)) {
        doc.image(signPath, colRightX, bottomY - 3,
                  { height: sigImgH, fit: [sigImgW, sigImgH] });
    }

    const sigTextX = colRightX + sigImgW + 5;
    doc.font('Bold').fontSize(12).fillColor(NAVY)
       .text('理事長', sigTextX, bottomY + 2);
    doc.font('Regular').fontSize(10).fillColor(GRAY)
       .text('Chairman', sigTextX, bottomY + 16);

    // Organization name (centered below signature + chairman)
    const orgW = 195;
    const orgX = colRightX - 10;
    doc.font('Bold').fontSize(11).fillColor(NAVY)
       .text('國際資訊安全人才培育與推廣協會', orgX, bottomY + 38, { width: orgW, align: 'center' });
    doc.font('Regular').fontSize(9).fillColor(GRAY)
       .text('Association of Cybersecurity Talent Cultivation', orgX, bottomY + 52, { width: orgW, align: 'center' });

    // ── Footer ────────────────────────────────────────────────────────────────
    const footerY = 537;
    doc.font('Regular').fontSize(7).fillColor(GRAY)
       .text(`© ${new Date().getFullYear()} 國際資訊安全人才培育與推廣協會保留所有權利`,
             marginX + 10, footerY, { width: contentW - 20, align: 'center' });

    const siteUrl = (process.env.SITE_URL || 'https://actc.org.tw').replace(/\/$/, '');
    doc.fontSize(7).fillColor(GRAY)
       .text(`驗證：${siteUrl}/verify-certificate/${data.certificateNumber}`,
             marginX + 10, footerY + 11, { width: contentW - 20, align: 'center' });
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
        .populate('user')
        .populate('certTypeRef');

    if (!certificate) {
        throw new Error('CERTIFICATE_NOT_FOUND');
    }

    if (certificate.isRevoked) {
        throw new Error('CERTIFICATE_REVOKED');
    }

    let user = certificate.user;
    if (!user && certificate.recipientEmail) {
        user = await User.findOne({ email: certificate.recipientEmail.toLowerCase() });
        if (user) {
            certificate.user = user._id;
            Certificate.updateOne({ _id: certificate._id }, { $set: { user: user._id } }).catch(err => console.error('Link user to certificate error:', err));
        }
    }
    const isCourse = certificate.certType === 'course';

    // Recipient name: prefer certificate.recipientName, fallback to user fields
    const recipientDisplayName = certificate.recipientName
        || (user && (user.fullName || user.username))
        || '—';

    // Recipient English name: prefer certificate.recipientEnglishName, fallback to user fields
    let recipientEnglishName = certificate.recipientEnglishName
        || (user && user.englishName)
        || null;

    // Solidify to DB if empty on certificate but present on user profile
    if (!certificate.recipientEnglishName && user && user.englishName) {
        certificate.recipientEnglishName = user.englishName;
        certificate.save().catch(err => console.error('Solidify recipientEnglishName error:', err));
    }

    // Create PDF document — A4 landscape: 841.89 × 595.28 pt
    const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margins: { top: 0, bottom: 0, left: 0, right: 0 }
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="certificate-${certificate.certificateNumber}.pdf"`);

    // Pipe PDF to response
    doc.pipe(res);

    // Register fonts
    doc.registerFont('Regular', FONT_PATH);
    doc.registerFont('Bold', BOLD_FONT_PATH || FONT_PATH);

    const titleZh = certificate.certTypeRef?.titleZh
        || (isCourse ? '課程結業證書' : '資安能力認證證書');
    const titleEn = certificate.certTypeRef?.titleEn
        || (isCourse ? 'Course Completion Certificate' : 'Cybersecurity Competency Certificate');

    const displayTitle = isCourse
        ? (certificate.course ? `【${certificate.course.courseName}】` : '【本課程】')
        : (certificate.exam   ? `【${certificate.exam.title}】`        : '【本考試】');

    const examTitle  = certificate.exam   ? certificate.exam.title         : '考試';
    const courseName = certificate.course ? certificate.course.courseName   : '本課程';

    let customBodyText = certificate.certTypeRef?.bodyText;
    if (customBodyText) {
        const issuedDateStrForBody = certificate.issuedAt.toLocaleDateString('zh-TW', {
            year: 'numeric', month: 'long', day: 'numeric'
        });
        customBodyText = customBodyText
            .replace(/\{\{name\}\}/g, recipientDisplayName)
            .replace(/\{\{examTitle\}\}/g, examTitle)
            .replace(/\{\{courseName\}\}/g, courseName)
            .replace(/\{\{date\}\}/g, issuedDateStrForBody)
            .replace(/\{\{certNumber\}\}/g, certificate.certificateNumber);
    }

    const data = {
        certificateNumber: certificate.certificateNumber,
        isCourse,
        recipientDisplayName,
        recipientEnglishName,
        titleZh,
        titleEn,
        customBodyText,
        displayTitle,
        course: isCourse && certificate.course ? {
            attendanceDate: certificate.course.attendanceDate,
            completionHours: certificate.course.completionHours
        } : null,
        issuedAt: certificate.issuedAt,
        expiresAt: certificate.expiresAt
    };

    drawCertificateLayout(doc, data);

    // Finalize PDF
    doc.end();

    // Update download count
    certificate.downloadCount += 1;
    certificate.lastDownloadedAt = new Date();
    await certificate.save();
}

/**
 * Generate preview certificate PDF on-the-fly
 * @param {Object} previewData - { titleZh, titleEn, bodyText }
 * @param {Object} res - Express response object
 */
async function generatePreviewPDF(previewData, res) {
    if (!hasChineseFont()) {
        throw new Error('CHINESE_FONT_NOT_FOUND');
    }

    const { titleZh, titleEn, bodyText } = previewData;
    const isCourse = true; // Preview defaults to course layout format for display

    const recipientDisplayName = '陳小明';
    const recipientEnglishName = 'John Doe';
    const certificateNumber = 'ACTC-PREVIEW-2026-000001';
    
    const displayTitle = '【ISO 27001 資訊安全管理系統主導稽核員課程】';
    const examTitle = 'CISM 國際資訊安全經理人認證考試';
    const courseName = 'ISO 27001 資訊安全管理系統主導稽核員課程';
    
    let customBodyText = bodyText;
    if (customBodyText) {
        const issuedDateStrForBody = new Date().toLocaleDateString('zh-TW', {
            year: 'numeric', month: 'long', day: 'numeric'
        });
        customBodyText = customBodyText
            .replace(/\{\{name\}\}/g, recipientDisplayName)
            .replace(/\{\{examTitle\}\}/g, examTitle)
            .replace(/\{\{courseName\}\}/g, courseName)
            .replace(/\{\{date\}\}/g, issuedDateStrForBody)
            .replace(/\{\{certNumber\}\}/g, certificateNumber);
    }

    const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margins: { top: 0, bottom: 0, left: 0, right: 0 }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="preview.pdf"');

    doc.pipe(res);

    doc.registerFont('Regular', FONT_PATH);
    doc.registerFont('Bold', BOLD_FONT_PATH || FONT_PATH);

    const data = {
        certificateNumber,
        isCourse,
        recipientDisplayName,
        recipientEnglishName,
        titleZh: titleZh || '課程結業證書',
        titleEn: titleEn || 'Course Completion Certificate',
        customBodyText,
        displayTitle,
        course: {
            attendanceDate: new Date(),
            completionHours: 40
        },
        issuedAt: new Date(),
        expiresAt: null
    };

    drawCertificateLayout(doc, data);
    doc.end();
}

/**
 * Regenerate certificate (admin function)
 * @param {string} attemptId - ExamAttempt ID
 * @returns {Promise<Object>} New or existing certificate
 */
async function regenerateCertificate(attemptId) {
    const attempt = await ExamAttempt.findById(attemptId)
        .populate('exam')
        .populate('user', 'fullName username');
    if (!attempt) {
        throw new Error('ATTEMPT_NOT_FOUND');
    }

    if (!attempt.passed || attempt.cheatingDetected) {
        throw new Error('ATTEMPT_NOT_ELIGIBLE');
    }

    // Check if already exists (non-revoked)
    let certificate = await Certificate.findOne({ attempt: attemptId });
    if (certificate) {
        return certificate;
    }

    // Populate exam.certTypeRef for prefix/counter resolution
    await attempt.populate('exam.certTypeRef');

    const year = new Date().getFullYear();
    let certNumber;
    if (attempt.exam.certTypeRef) {
        const ct = attempt.exam.certTypeRef;
        const seq = await Counter.getNextSequence(ct.counterKey || 'certificate_number');
        certNumber = `${ct.prefix}-${year}-${String(seq).padStart(6, '0')}`;
    } else {
        const seq = await Counter.getNextSequence('certificate_number');
        certNumber = `ACTC-EXAM-${year}-${String(seq).padStart(6, '0')}`;
    }

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
        certTypeRef: attempt.exam.certTypeRef?._id || null,
        exam: attempt.exam._id,
        user: attempt.user._id || attempt.user,
        recipientName: attempt.user.fullName || attempt.user.username || null,
        recipientEnglishName: attempt.user.englishName || null,
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
async function issueCourseAttendanceCertificate(attendanceId, certValidityYears, certTypeId = null) {
    const attendance = await CourseAttendance.findById(attendanceId).populate('user');
    if (!attendance) {
        throw new Error('ATTENDANCE_NOT_FOUND');
    }

    if (attendance.certificateIssued) {
        throw new Error('CERTIFICATE_ALREADY_ISSUED');
    }

    const year = new Date().getFullYear();
    let certNumber;
    let certTypeRef = certTypeId || null;

    if (certTypeId) {
        const ct = await CertificateType.findById(certTypeId);
        if (ct) {
            const seq = await Counter.getNextSequence(ct.counterKey || 'certificate_course_number');
            certNumber = `${ct.prefix}-${year}-${String(seq).padStart(6, '0')}`;
            certTypeRef = ct._id;
        } else {
            const seq = await Counter.getNextSequence('certificate_course_number');
            certNumber = `ACTC-COURSE-${year}-${String(seq).padStart(6, '0')}`;
        }
    } else {
        const seq = await Counter.getNextSequence('certificate_course_number');
        certNumber = `ACTC-COURSE-${year}-${String(seq).padStart(6, '0')}`;
    }

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
        certTypeRef,
        course: attendance._id,
        user: attendance.user ? attendance.user._id : null,
        recipientName: attendance.recipientName,
        recipientEnglishName: attendance.recipientEnglishName || (attendance.user && attendance.user.englishName) || null,
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
    generatePreviewPDF,
    regenerateCertificate,
    issueCourseAttendanceCertificate
};
