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
        .populate('user', 'username fullName')
        .populate('certTypeRef', 'name titleZh');

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
            certTypeName: certificate.certTypeRef?.titleZh || null,
            issuedAt: certificate.issuedAt,
            expiresAt: certificate.expiresAt,
            exam: certificate.exam,
            course: certificate.course,
            recipientName: certificate.recipientName || null,
            recipientEmail: certificate.recipientEmail || null,
            user: certificate.user
                ? { username: certificate.user.username, fullName: certificate.user.fullName }
                : { username: null, fullName: certificate.recipientName || null }
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
        .populate('user')
        .populate('certTypeRef');

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

    // Recipient name: prefer certificate.recipientName, fallback to user fields
    const recipientDisplayName = certificate.recipientName
        || (user && (user.fullName || user.username))
        || '—';

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

    const W = doc.page.width;   // 841.89
    const H = doc.page.height;  // 595.28
    const NAVY  = '#003366';
    const GOLD  = '#D4AF37';
    const GRAY  = '#888888';
    const cx    = W / 2;
    const marginX  = 55;
    const contentW = W - marginX * 2;   // 731.89

    // ── Borders ──────────────────────────────────────────────────────────────
    // Outer gold border
    doc.rect(12, 12, W - 24, H - 24)
       .strokeColor(GOLD).lineWidth(3).stroke();

    // Inner navy border
    doc.rect(22, 22, W - 44, H - 44)
       .strokeColor(NAVY).lineWidth(1.5).stroke();

    // ── Logo ─────────────────────────────────────────────────────────────────
    const logoPath = path.join(__dirname, '../public/assets/images/actc-logo.png');
    const logoFallback = path.join(__dirname, '../public/assets/images/actc-logo.jpg');
    const logoSrc = fs.existsSync(logoPath) ? logoPath : (fs.existsSync(logoFallback) ? logoFallback : null);

    const LOGO_H   = 52;
    const LOGO_TOP = 40;
    if (logoSrc) {
        doc.image(logoSrc, cx - 32, LOGO_TOP, { height: LOGO_H, fit: [64, LOGO_H] });
    }

    // ── Title ─────────────────────────────────────────────────────────────────
    const titleTop = LOGO_TOP + LOGO_H + 10;   // ~102
    const titleZh = certificate.certTypeRef?.titleZh
        || (isCourse ? '課程結業證書' : '資安能力認證證書');
    const titleEn = certificate.certTypeRef?.titleEn
        || (isCourse ? 'Course Completion Certificate' : 'Cybersecurity Competency Certificate');

    doc.font('Bold').fontSize(28).fillColor(NAVY)
       .text(titleZh, marginX, titleTop, { width: contentW, align: 'center' });

    const subtitleTop = titleTop + 36;          // ~138
    doc.font('Regular').fontSize(11).fillColor(NAVY)
       .text(titleEn, marginX, subtitleTop, { width: contentW, align: 'center' });

    // ── Gold divider ──────────────────────────────────────────────────────────
    const dividerY = subtitleTop + 22;          // ~160
    doc.moveTo(W * 0.25, dividerY).lineTo(W * 0.75, dividerY)
       .strokeColor(GOLD).lineWidth(1).stroke();

    // ── Award phrase ──────────────────────────────────────────────────────────
    const awardZhY = dividerY + 14;             // ~174
    doc.font('Bold').fontSize(14).fillColor(NAVY)
       .text('特此頒發予', marginX, awardZhY, { width: contentW, align: 'center' });

    const awardEnY = awardZhY + 20;             // ~194
    doc.font('Regular').fontSize(11).fillColor(NAVY)
       .text('This certificate is hereby awarded to', marginX, awardEnY, { width: contentW, align: 'center' });

    // ── Recipient name ────────────────────────────────────────────────────────
    const nameY = awardEnY + 14;                // ~208
    doc.font('Bold').fontSize(30).fillColor(NAVY)
       .text(recipientDisplayName, marginX, nameY, { width: contentW, align: 'center' });

    // ── Congrats phrase ───────────────────────────────────────────────────────
    const congratsZhY = nameY + 44;             // ~252
    doc.font('Bold').fontSize(14).fillColor(NAVY)
       .text('恭喜順利完成', marginX, congratsZhY, { width: contentW, align: 'center' });

    const congratsEnY = congratsZhY + 20;       // ~272
    doc.font('Regular').fontSize(11).fillColor(NAVY)
       .text('has successfully completed', marginX, congratsEnY, { width: contentW, align: 'center' });

    // ── Standalone course/exam name ───────────────────────────────────────────
    const displayTitle = isCourse
        ? (certificate.course ? `【${certificate.course.courseName}】` : '【本課程】')
        : (certificate.exam   ? `【${certificate.exam.title}】`        : '【本考試】');

    // Resolve bodyText template (for certTypeRef override)
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

    const titleNameY = congratsEnY + 14;        // ~286
    if (customBodyText) {
        // certTypeRef bodyText overrides the standalone title line
        doc.font('Bold').fontSize(15).fillColor(NAVY)
           .text(customBodyText, marginX + 40, titleNameY, { width: contentW - 80, align: 'center' });
    } else {
        doc.font('Bold').fontSize(16).fillColor(NAVY)
           .text(displayTitle, marginX + 40, titleNameY, { width: contentW - 80, align: 'center' });
    }

    // ── Course / Exam info — two-column layout ────────────────────────────────
    const infoLabelY = titleNameY + 30;         // ~316
    const infoValueY = infoLabelY + 22;         // ~338

    const colLeftX  = W * 0.22;
    const colRightX = W * 0.57;
    const colW      = 185;

    if (isCourse && certificate.course) {
        // Left column — Course Date
        doc.font('Bold').fontSize(12).fillColor(NAVY)
           .text('課程日期', colLeftX, infoLabelY, { width: colW });
        doc.font('Regular').fontSize(9).fillColor(GRAY)
           .text('Course Date', colLeftX, infoLabelY + 16, { width: colW });

        if (certificate.course.attendanceDate) {
            const d = new Date(certificate.course.attendanceDate);
            const dateVal = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
            doc.font('Regular').fontSize(15).fillColor(NAVY)
               .text(dateVal, colLeftX, infoValueY, { width: colW });
        }

        // Right column — Course Duration
        doc.font('Bold').fontSize(12).fillColor(NAVY)
           .text('課程時數', colRightX, infoLabelY, { width: colW });
        doc.font('Regular').fontSize(9).fillColor(GRAY)
           .text('Course Duration', colRightX, infoLabelY + 16, { width: colW });

        if (certificate.course.completionHours) {
            doc.font('Regular').fontSize(15).fillColor(NAVY)
               .text(`${certificate.course.completionHours}小時`, colRightX, infoValueY, { width: colW });
            doc.font('Regular').fontSize(10).fillColor(GRAY)
               .text(`${certificate.course.completionHours} Hours`, colRightX, infoValueY + 20, { width: colW });
        }
    } else if (!isCourse) {
        // Exam type — show exam validity info in info row
        const issuedDateStr = certificate.issuedAt.toLocaleDateString('zh-TW', {
            year: 'numeric', month: 'long', day: 'numeric'
        });

        // Left column — Issue Date
        doc.font('Bold').fontSize(11).fillColor(NAVY)
           .text('發證日期', colLeftX, infoLabelY, { width: colW });
        doc.font('Regular').fontSize(8).fillColor(GRAY)
           .text('Issue Date', colLeftX, infoLabelY + 14, { width: colW });
        doc.font('Regular').fontSize(12).fillColor(NAVY)
           .text(issuedDateStr, colLeftX, infoValueY, { width: colW });

        // Right column — Validity
        doc.font('Bold').fontSize(11).fillColor(NAVY)
           .text('有效期限', colRightX, infoLabelY, { width: colW });
        doc.font('Regular').fontSize(8).fillColor(GRAY)
           .text('Valid Until', colRightX, infoLabelY + 14, { width: colW });

        if (certificate.expiresAt) {
            const expiryDateStr = certificate.expiresAt.toLocaleDateString('zh-TW', {
                year: 'numeric', month: 'long', day: 'numeric'
            });
            doc.font('Regular').fontSize(12).fillColor(NAVY)
               .text(expiryDateStr, colRightX, infoValueY, { width: colW });
        } else {
            doc.font('Regular').fontSize(12).fillColor(NAVY)
               .text('永久', colRightX, infoValueY, { width: colW });
        }
    }

    // ── Thin separator before bottom section ──────────────────────────────────
    const separatorY = H - 148;                 // ~447
    doc.moveTo(marginX, separatorY).lineTo(W - marginX, separatorY)
       .strokeColor(GOLD).lineWidth(0.5).stroke();

    // ── Bottom section: cert number (left) + signature (right) ───────────────
    const bottomY = separatorY + 10;            // ~457

    // Left — Certificate number
    const certNumLeftX = marginX + 20;
    doc.font('Bold').fontSize(12).fillColor(NAVY)
       .text(`證書編號：${certificate.certificateNumber}`, certNumLeftX, bottomY, { width: 300 });
    doc.font('Regular').fontSize(9).fillColor(GRAY)
       .text('Certificate No.', certNumLeftX, bottomY + 17, { width: 300 });

    // Right — Signature block (置中於右半區)
    const sigBlockX = W * 0.55;
    const sigBlockW = W * 0.40;                 // 固定寬度讓簽名有空間置中
    const sigLineY  = bottomY + 68;             // ~525

    const signPath = path.join(__dirname, '../public/assets/images/EricMaoSign.png');
    if (fs.existsSync(signPath)) {
        const sigImgH = 48;
        const sigImgW = 140;                    // 控制圖片寬度，讓它在 sigBlockW 內真正置中
        const sigImgX = sigBlockX + (sigBlockW - sigImgW) / 2;
        doc.image(signPath, sigImgX, sigLineY - sigImgH - 4,
                  { height: sigImgH, fit: [sigImgW, sigImgH] });
    }

    doc.moveTo(sigBlockX, sigLineY).lineTo(sigBlockX + sigBlockW, sigLineY)
       .strokeColor(NAVY).lineWidth(0.75).stroke();

    // 理事長 / Chairman
    doc.font('Bold').fontSize(11).fillColor(NAVY)
       .text('理事長', sigBlockX, sigLineY + 5, { width: sigBlockW, align: 'center' });
    doc.font('Regular').fontSize(9).fillColor(GRAY)
       .text('Chairman', sigBlockX, sigLineY + 19, { width: sigBlockW, align: 'center' });

    // Organisation name
    doc.font('Bold').fontSize(10).fillColor(NAVY)
       .text('國際資訊安全人才培育與推廣協會', sigBlockX, sigLineY + 33, { width: sigBlockW, align: 'center' });
    doc.font('Regular').fontSize(8).fillColor(GRAY)
       .text('Association of Cybersecurity Talent Cultivation', sigBlockX, sigLineY + 46, { width: sigBlockW, align: 'center' });

    // ── Footer（內框底線在 H-22=573，footer 留在 H-50 以上確保不重疊）────────
    const footerY = H - 52;
    doc.font('Regular').fontSize(7).fillColor(GRAY)
       .text(`© ${new Date().getFullYear()} 國際資訊安全人才培育與推廣協會保留所有權利`,
             marginX + 10, footerY, { width: contentW - 20, align: 'center' });

    const siteUrl = (process.env.SITE_URL || 'https://actc.org.tw').replace(/\/$/, '');
    doc.fontSize(7).fillColor(GRAY)
       .text(`驗證：${siteUrl}/verify-certificate/${certificate.certificateNumber}`,
             marginX + 10, footerY + 11, { width: contentW - 20, align: 'center' });

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
