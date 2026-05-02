const PDFDocument = require('pdfkit');
const Certificate = require('../models/Certificate');
const ExamAttempt = require('../models/ExamAttempt');
const Exam = require('../models/Exam');
const User = require('../models/User');
const fs = require('fs');
const path = require('path');

// Default font for Chinese support (ensure this exists in your project)
const FONT_PATH = path.join(__dirname, '../fonts/NotoSansCJKtc-Regular.otf');
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
        .populate('user');
    
    if (!certificate) {
        throw new Error('CERTIFICATE_NOT_FOUND');
    }

    if (certificate.isRevoked) {
        throw new Error('CERTIFICATE_REVOKED');
    }

    const exam = certificate.exam;
    const user = certificate.user;

    // Get attempt for additional details
    const attempt = await ExamAttempt.findById(certificate.attempt);

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

    // Certificate template
    const template = exam.certificateTemplate || {};

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
       .text(template.title || '證書', { align: 'center' });

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

    // Recipient
    doc.font('Bold')
       .fontSize(24)
       .fillColor('#2d3748')
       .text(user.fullName || user.username, { align: 'center' });

    doc.moveDown(0.5);

    doc.font('Regular')
       .fontSize(16)
       .text(`已完成「${exam.title}」考試並通過認證`, { align: 'center' });

    // Score (if available)
    if (attempt && attempt.score !== null) {
        doc.moveDown(0.5);
        doc.fontSize(14)
           .text(`成績：${attempt.score} 分`, { align: 'center' });
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
    doc.moveDown(0.5);
    doc.fontSize(10)
       .text(`驗證網址：https://${process.env.DOMAIN || 'actc.org.tw'}/verify-certificate/${certificate.certificateNumber}`, 
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
    const attempt = await ExamAttempt.findById(attemptId).populate('exam');
    if (!attempt) {
        throw new Error('ATTEMPT_NOT_FOUND');
    }

    if (!attempt.passed || attempt.cheatingDetected) {
        throw new Error('ATTEMPT_NOT_ELIGIBLE');
    }

    // Check if already exists
    let certificate = await Certificate.findOne({ attempt: attemptId });
    if (certificate) {
        return certificate;
    }

    // Generate new certificate
    const Counter = require('../models/Counter');
    const seq = await Counter.getNextSequence('certificate_number');
    const year = new Date().getFullYear();
    const certNumber = `ACTC-EXAM-${year}-${String(seq).padStart(6, '0')}`;

    let expiresAt = null;
    if (attempt.exam.certificateTemplate?.validityPeriod > 0) {
        expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + attempt.exam.certificateTemplate.validityPeriod);
    }

    certificate = new Certificate({
        certificateNumber: certNumber,
        exam: attempt.exam._id,
        user: attempt.user,
        attempt: attempt._id,
        expiresAt
    });

    await certificate.save();

    return certificate;
}

module.exports = {
    generateCertificatePDF,
    regenerateCertificate
};
