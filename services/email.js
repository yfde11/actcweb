const nodemailer = require('nodemailer');

/** 寄件人顯示名稱（與實際寄件信箱分開） */
const MAIL_FROM_DISPLAY_NAME = 'ACTC(國際資安人培協會)';

/** 支援 SMTP_USERNAME / SMTP_PASSWORD 或舊名 SMTP_USER / SMTP_PASS */
function smtpUser() {
    return (process.env.SMTP_USERNAME || process.env.SMTP_USER || '').trim();
}

function smtpPass() {
    return process.env.SMTP_PASSWORD || process.env.SMTP_PASS || '';
}

function useTls() {
    const v = process.env.SMTP_USE_TLS;
    if (v === undefined || v === '') return true;
    return v === 'true' || v === '1' || v === 'yes';
}

function isConfigured() {
    return !!(process.env.SMTP_HOST && smtpUser() && smtpPass());
}

function createTransport() {
    if (!isConfigured()) return null;
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const secure = process.env.SMTP_SECURE === 'true';
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure,
        requireTLS: !secure && useTls(),
        auth: {
            user: smtpUser(),
            pass: smtpPass()
        }
    });
}

const fromAddress = () => {
    const digest = process.env.DIGEST_FROM_EMAIL?.trim();
    if (digest) {
        return digest.includes('<') ? digest : `"${MAIL_FROM_DISPLAY_NAME}" <${digest}>`;
    }
    const legacy = process.env.EMAIL_FROM?.trim();
    if (legacy) return legacy;
    const u = smtpUser();
    return u ? `"${MAIL_FROM_DISPLAY_NAME}" <${u}>` : `"${MAIL_FROM_DISPLAY_NAME}" <noreply@localhost>`;
};

function fallbackRecipientTo() {
    return (
        process.env.NOTIFY_FALLBACK_TO?.trim() ||
        process.env.DIGEST_FROM_EMAIL?.trim() ||
        smtpUser() ||
        undefined
    );
}

/**
 * @returns {{ ok: boolean, messageId?: string, mock?: boolean }}
 */
async function sendMail({ to, subject, html, text, bcc }) {
    const recipient = to || fallbackRecipientTo();

    // Resend HTTP API 優先（適用 Render 等封鎖 SMTP port 的環境）
    if (process.env.RESEND_API_KEY) {
        const body = {
            from: fromAddress(),
            to: recipient ? [recipient] : [],
            subject,
            ...(html && { html }),
            ...(text && { text }),
            ...(bcc && bcc.length && { bcc })
        };
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.name || 'Resend API error');
        return { ok: true, messageId: data.id };
    }

    const transport = createTransport();
    const mail = {
        from: fromAddress(),
        to: recipient,
        subject,
        html,
        text
    };
    if (bcc && bcc.length) mail.bcc = bcc;

    if (!transport) {
        const preview = text || (html && html.replace(/<[^>]+>/g, '').slice(0, 200));
        console.warn('[email] SMTP 未設定，略過寄信。主旨:', subject, '收件:', to || bcc?.length, '預覽:', preview);
        return { ok: false, mock: true };
    }

    const info = await transport.sendMail(mail);
    return { ok: true, messageId: info.messageId };
}

const PROD_PUBLIC_SITE = 'https://www.actc-tw.org';

/** 是否為本機網址（誤設 SITE_URL=http://localhost 時，生產環境寄信仍應用正式網域） */
function looksLikeLocalhostBase(url) {
    const s = String(url || '').trim();
    if (!s) return false;
    try {
        const withProto = /^https?:\/\//i.test(s) ? s : `http://${s}`;
        const u = new URL(withProto);
        const h = u.hostname.toLowerCase();
        return h === 'localhost' || h === '127.0.0.1' || h === '::1';
    } catch {
        return /\blocalhost\b|127\.0\.0\.1/i.test(s);
    }
}

/**
 * 對外站台基底網址（驗證信、重設密碼、通知內連結）。
 * 請在 .env 設定 SITE_URL（或 FRONTEND_URL）；生產環境若誤設 localhost 會自動改為正式網域。
 */
function siteBaseUrl() {
    const fromEnv = (process.env.SITE_URL || process.env.FRONTEND_URL || '').trim().replace(/\/$/, '');
    const isProd = process.env.NODE_ENV === 'production';

    if (isProd && fromEnv && looksLikeLocalhostBase(fromEnv)) {
        console.warn(
            '[email] SITE_URL/FRONTEND_URL 為本機位址，已改用正式網域供郵件連結：',
            PROD_PUBLIC_SITE
        );
        return PROD_PUBLIC_SITE;
    }
    if (fromEnv) return fromEnv;
    if (isProd) {
        return PROD_PUBLIC_SITE;
    }
    return 'http://localhost:5001';
}

async function sendVerificationEmail(user, token) {
    const url = `${siteBaseUrl()}/api/auth/verify-email?token=${encodeURIComponent(token)}&redirect=1`;
    const subject = 'ACTC 帳號信箱驗證';
    const html = `
      <p>您好 ${user.username}，</p>
      <p>請點擊以下連結完成信箱驗證（24 小時內有效）：</p>
      <p><a href="${url}">${url}</a></p>
      <p>若您未註冊 ACTC 帳號，請忽略此信。</p>
    `;
    const text = `請開啟連結完成驗證：${url}`;
    return sendMail({ to: user.email, subject, html, text });
}

async function sendPasswordResetEmail(user, plainToken) {
    const url = `${siteBaseUrl()}/member?resetToken=${encodeURIComponent(plainToken)}`;
    const subject = 'ACTC 重設密碼';
    const html = `
      <p>您好 ${user.username}，</p>
      <p>我們收到您重設密碼的申請。請於 <strong>1 小時內</strong>點擊以下連結，於網頁上設定新密碼：</p>
      <p><a href="${url}">${url}</a></p>
      <p>若您未申請重設密碼，請忽略此信，您的密碼不會變更。</p>
    `;
    const text = `請於 1 小時內開啟連結重設密碼：${url}`;
    return sendMail({ to: user.email, subject, html, text });
}

async function sendMembershipDecisionEmail(user, approved, note) {
    if (!user.email) return { ok: false, mock: true };
    const subject = approved ? 'ACTC 會員申請已核准' : 'ACTC 會員申請未核准';
    const html = approved
        ? `<p>您好 ${user.username}，</p><p>您的會員申請已<strong>核准</strong>。登入後可至「會員專區」管理內容（若已開通權限）。</p>${note ? `<p>管理員備註：${note}</p>` : ''}`
        : `<p>您好 ${user.username}，</p><p>很抱歉，您的會員申請未獲核准。</p>${note ? `<p>說明：${note}</p>` : ''}`;
    return sendMail({ to: user.email, subject, html });
}

module.exports = {
    isConfigured,
    sendMail,
    sendVerificationEmail,
    sendPasswordResetEmail,
    sendMembershipDecisionEmail,
    siteBaseUrl
};
