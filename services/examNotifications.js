const validator = require('validator');
const { sendMail, siteBaseUrl } = require('./email');

async function sendExamSubmittedEmail(user, exam, attempt) {
    if (!user || !user.email || !user.emailVerified) {
        console.log('[examNotification] Skip submitted email - user email not verified or missing');
        return { ok: false, reason: 'email_not_verified' };
    }

    try {
        const userName = validator.escape(user.fullName || user.username);
        const examTitle = validator.escape(exam.title);
        const attemptNumber = attempt.attemptNumber;
        const viewResultUrl = `${siteBaseUrl()}/member/exams/${exam._id}/result?attemptId=${attempt._id}`;

        const subject = `考試提交確認 - ${examTitle}`;
        const html = `
            <p>親愛的 ${userName}，</p>
            <p>您已成功提交考試「${examTitle}」第 ${attemptNumber} 次嘗試。</p>
            <p>查看成績：<a href="${viewResultUrl}">${viewResultUrl}</a></p>
        `;
        const text = `親愛的 ${userName}，您已成功提交考試「${examTitle}」第 ${attemptNumber} 次嘗試。查看成績：${viewResultUrl}`;

        return await sendMail({ to: user.email, subject, html, text });
    } catch (error) {
        console.error('[examNotification] Failed to send submitted email:', error);
        return { ok: false, error: error.message };
    }
}

async function sendExamPassedEmail(user, exam, attempt, certificateNumber) {
    if (!user || !user.email || !user.emailVerified) {
        console.log('[examNotification] Skip passed email - user email not verified or missing');
        return { ok: false, reason: 'email_not_verified' };
    }

    try {
        const userName = validator.escape(user.fullName || user.username);
        const examTitle = validator.escape(exam.title);
        const score = attempt.score;
        const downloadUrl = certificateNumber 
            ? `${siteBaseUrl()}/api/member/exams/certificate/${certificateNumber}`
            : '';

        const subject = `考試通過通知 - ${examTitle}`;
        const html = `
            <p>親愛的 ${userName}，</p>
            <p>恭喜您通過考試「${examTitle}」！</p>
            <p>您的成績：${score} 分</p>
            ${certificateNumber ? `<p>證書編號：${certificateNumber}</p><p>下載證書：<a href="${downloadUrl}">${downloadUrl}</a></p>` : ''}
        `;
        const text = `親愛的 ${userName}，恭喜您通過考試「${examTitle}」！您的成績：${score} 分${certificateNumber ? `，證書編號：${certificateNumber}，下載：${downloadUrl}` : ''}`;

        return await sendMail({ to: user.email, subject, html, text });
    } catch (error) {
        console.error('[examNotification] Failed to send passed email:', error);
        return { ok: false, error: error.message };
    }
}

async function sendExamFailedEmail(user, exam, attempt) {
    if (!user || !user.email || !user.emailVerified) {
        console.log('[examNotification] Skip failed email - user email not verified or missing');
        return { ok: false, reason: 'email_not_verified' };
    }

    try {
        const userName = validator.escape(user.fullName || user.username);
        const examTitle = validator.escape(exam.title);
        const score = attempt.score;

        let nextAttemptInfo = '';
        if (exam.maxAttempts === 0 || attempt.attemptNumber < exam.maxAttempts) {
            const nextAttemptDate = new Date();
            nextAttemptDate.setDate(nextAttemptDate.getDate() + exam.cooldownPeriod);
            nextAttemptInfo = `<p>下次可考日期：${nextAttemptDate.toLocaleDateString('zh-TW')}</p>`;
        }

        const subject = `考試未通過通知 - ${examTitle}`;
        const html = `
            <p>親愛的 ${userName}，</p>
            <p>很遺憾，您未能通過考試「${examTitle}」。</p>
            <p>您的成績：${score} 分（及格分數：${exam.passingScore} 分）</p>
            ${nextAttemptInfo}
            <p>請繼續努力，祝您下次考試順利！</p>
        `;
        const text = `親愛的 ${userName}，很遺憾，您未能通過考試「${examTitle}」。您的成績：${score} 分（及格分數：${exam.passingScore} 分）${nextAttemptInfo ? `下次可考日期：${new Date(new Date().setDate(new Date().getDate() + exam.cooldownPeriod)).toLocaleDateString('zh-TW')}` : ''}`;

        return await sendMail({ to: user.email, subject, html, text });
    } catch (error) {
        console.error('[examNotification] Failed to send failed email:', error);
        return { ok: false, error: error.message };
    }
}

module.exports = {
    sendExamSubmittedEmail,
    sendExamPassedEmail,
    sendExamFailedEmail
};
