const User = require('../models/User');
const { sendMail, siteBaseUrl } = require('./email');

/**
 * 僅包含「已註冊且已驗證 email」；可再加上 emailSubscribed。
 * approved_members：僅 membershipStatus === approved'
 */
async function loadRecipients(audience) {
    if (!audience || audience === 'none') return [];

    const base = {
        isActive: true,
        emailVerified: true,
        emailSubscribed: true,
        email: { $exists: true, $nin: [null, ''] }
    };

    if (audience === 'verified_users') {
        return User.find(base).select('email').lean();
    }
    if (audience === 'approved_members') {
        return User.find({
            ...base,
            membershipStatus: 'approved'
        })
            .select('email')
            .lean();
    }
    return [];
}

const BATCH = 40;

/**
 * 發布最新消息／活動後批次寄送（Bcc 隱藏收件人）
 */
async function notifyAudienceByEmail({ audience, subject, html, text }) {
    const recipients = await loadRecipients(audience);
    const emails = recipients.map((r) => r.email).filter(Boolean);
    if (emails.length === 0) {
        return { count: 0, batches: 0 };
    }

    let batches = 0;
    for (let i = 0; i < emails.length; i += BATCH) {
        const chunk = emails.slice(i, i + BATCH);
        batches += 1;
        // eslint-disable-next-line no-await-in-loop
        await sendMail({
            to: process.env.NOTIFY_FALLBACK_TO || process.env.SMTP_USER,
            subject,
            html,
            text,
            bcc: chunk
        });
    }
    return { count: emails.length, batches };
}

function buildNewsEmailDoc(news) {
    const url = `${siteBaseUrl()}/news/${news._id}`;
    const subject = `【ACTC 最新消息】${news.title}`;
    const html = `<p>協會發布了新消息：</p><h2>${news.title}</h2><p><a href="${url}">閱讀全文</a></p>`;
    const text = `${news.title}\n${url}`;
    return { subject, html, text };
}

function buildEventEmailDoc(event) {
    const url = siteBaseUrl();
    const subject = `【ACTC 活動／課程】${event.title}`;
    const html = `<p>協會發布了新活動：</p><h2>${event.title}</h2><p><a href="${url}">前往 ACTC 網站</a></p>`;
    const text = `${event.title}\n${url}`;
    return { subject, html, text };
}

module.exports = {
    loadRecipients,
    notifyAudienceByEmail,
    buildNewsEmailDoc,
    buildEventEmailDoc
};
