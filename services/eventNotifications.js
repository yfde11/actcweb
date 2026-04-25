const { sendMail, siteBaseUrl, isConfigured } = require('./email');
const NotificationLog = require('../models/NotificationLog');

function formatEventDateRange(event) {
    try {
        const start = event?.date ? new Date(event.date) : null;
        const end = event?.endDate ? new Date(event.endDate) : null;
        if (!start) return '時間待定';
        const startText = start.toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short' });
        if (!end) return startText;
        const endText = end.toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short' });
        return `${startText} ～ ${endText}`;
    } catch {
        return '時間待定';
    }
}

function memberCenterUrl() {
    return `${siteBaseUrl()}/member#my-registrations`;
}

function formatCurrency(amount, currency = 'TWD') {
    const numeric = Number(amount || 0);
    return `${currency} ${numeric.toLocaleString('zh-TW')}`;
}

function renderNotificationDoc(type, { event, registration, customSubject, customMessage }) {
    const eventTitle = event?.title || '活動';
    const eventDateText = formatEventDateRange(event);
    const eventLocation = event?.location || '地點待定';
    const memberUrl = memberCenterUrl();
    const amountText = formatCurrency(registration?.amountDue, registration?.currency || 'TWD');
    const pay = event?.paymentInstructions || {};

    const docs = {
        registration_success: {
            subject: `[ACTC] 活動報名成功：${eventTitle}`,
            html: `<p>您好，您已成功報名活動。</p><p><strong>活動：</strong>${eventTitle}<br><strong>時間：</strong>${eventDateText}<br><strong>地點：</strong>${eventLocation}<br><strong>狀態：</strong>已報名</p><p><a href="${memberUrl}">前往會員專區查看報名紀錄</a></p>`,
            text: `您已成功報名活動。\n活動：${eventTitle}\n時間：${eventDateText}\n地點：${eventLocation}\n狀態：已報名\n會員專區：${memberUrl}`
        },
        payment_pending: {
            subject: `[ACTC] 付款資訊：${eventTitle}`,
            html: `<p>您好，您已完成報名，請依下列資訊完成付款並於會員專區上傳後五碼或憑證。</p><p><strong>活動：</strong>${eventTitle}<br><strong>應付金額：</strong>${amountText}<br><strong>銀行：</strong>${pay.bankName || '請見活動說明'}<br><strong>銀行代碼：</strong>${pay.bankCode || '—'}<br><strong>戶名：</strong>${pay.accountName || '—'}<br><strong>帳號：</strong>${pay.accountNumber || '—'}</p><p>${pay.note || ''}</p><p><a href="${memberUrl}">前往會員專區上傳付款資訊</a></p>`,
            text: `請完成付款資訊提交。\n活動：${eventTitle}\n應付金額：${amountText}\n銀行：${pay.bankName || '請見活動說明'}\n銀行代碼：${pay.bankCode || '—'}\n戶名：${pay.accountName || '—'}\n帳號：${pay.accountNumber || '—'}\n備註：${pay.note || ''}\n會員專區：${memberUrl}`
        },
        payment_confirmed: {
            subject: `[ACTC] 付款確認完成：${eventTitle}`,
            html: `<p>您好，您的付款已確認完成。</p><p><strong>活動：</strong>${eventTitle}</p><p><a href="${memberUrl}">前往會員專區查看狀態</a></p>`,
            text: `您的付款已確認完成。\n活動：${eventTitle}\n會員專區：${memberUrl}`
        },
        payment_rejected: {
            subject: `[ACTC] 付款資訊需補件：${eventTitle}`,
            html: `<p>您好，您提交的付款資訊需要補件或修正。</p><p><strong>活動：</strong>${eventTitle}</p><p><a href="${memberUrl}">前往會員專區重新提交付款資訊</a></p>`,
            text: `付款資訊需補件或修正。\n活動：${eventTitle}\n會員專區：${memberUrl}`
        },
        event_reminder: {
            subject: `[ACTC] 活動提醒：${eventTitle}`,
            html: `<p>您好，提醒您活動即將開始。</p><p><strong>活動：</strong>${eventTitle}<br><strong>時間：</strong>${eventDateText}<br><strong>地點：</strong>${eventLocation}</p><p><a href="${memberUrl}">前往會員專區查看資訊</a></p>`,
            text: `活動提醒\n活動：${eventTitle}\n時間：${eventDateText}\n地點：${eventLocation}\n會員專區：${memberUrl}`
        },
        post_event_survey: {
            subject: `[ACTC] 感謝參與，請填寫活動回饋：${eventTitle}`,
            html: `<p>感謝您參與活動，歡迎填寫問卷回饋。</p><p><strong>活動：</strong>${eventTitle}</p><p><a href="${memberUrl}">前往會員專區填寫問卷</a></p>`,
            text: `感謝參與，請填寫活動回饋。\n活動：${eventTitle}\n會員專區：${memberUrl}`
        },
        custom: {
            subject: customSubject || `[ACTC] 活動通知：${eventTitle}`,
            html: `<p>${customMessage || ''}</p>`,
            text: customMessage || ''
        }
    };

    return docs[type] || docs.custom;
}

async function sendEventNotification({
    type,
    recipientEmail,
    event = null,
    registration = null,
    user = null,
    customSubject,
    customMessage
}) {
    const doc = renderNotificationDoc(type, { event, registration, customSubject, customMessage });
    let status = 'skipped';
    let errorMessage = '';

    try {
        if (!isConfigured()) {
            errorMessage = 'SMTP is not configured';
            console.warn('[eventNotifications] SMTP is not configured, skip sending:', type, recipientEmail);
        } else {
            const result = await sendMail({
                to: recipientEmail,
                subject: doc.subject,
                html: doc.html,
                text: doc.text
            });
            status = result.ok ? 'sent' : 'skipped';
            if (!result.ok) {
                errorMessage = result.mock ? 'SMTP skipped' : 'Unknown email send failure';
            }
        }
    } catch (error) {
        status = 'failed';
        errorMessage = error.message || 'Unknown error';
    }

    try {
        await NotificationLog.create({
            event: event?._id || null,
            user: user?._id || null,
            registration: registration?._id || null,
            type,
            channel: 'email',
            recipientEmail,
            subject: doc.subject,
            status,
            errorMessage,
            sentAt: new Date()
        });
    } catch (logErr) {
        console.warn('[eventNotifications] failed to write NotificationLog:', logErr.message);
    }

    return { status, errorMessage };
}

module.exports = {
    sendEventNotification,
    renderNotificationDoc
};
