const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { adminAuth } = require('../middleware/adminAuth');
const { verifiedAuth } = require('../middleware/memberAuth');
const { DB_UNAVAILABLE } = require('../middleware/mongoReady');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/email');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashPasswordResetToken(plain) {
    return crypto.createHash('sha256').update(String(plain), 'utf8').digest('hex');
}

const FORGOT_PASSWORD_RESPONSE = {
    message: '若此信箱已註冊且已驗證，將寄出重設密碼信（請於 1 小時內完成）。'
};

// 註冊（需驗證信箱後才可登入）
router.post('/register', async (req, res) => {
    try {
        const { username, password, email, fullName } = req.body;
        if (!username || !password || !email) {
            return res.status(400).json({ message: '請提供使用者名稱、密碼與 email' });
        }
        if (!EMAIL_RE.test(String(email).trim())) {
            return res.status(400).json({ message: 'email 格式不正確' });
        }
        if (String(username).length < 3) {
            return res.status(400).json({ message: '使用者名稱至少 3 字元' });
        }
        if (String(password).length < 6) {
            return res.status(400).json({ message: '密碼至少 6 字元' });
        }

        const exists = await User.findOne({
            $or: [{ username: String(username).trim() }, { email: String(email).trim().toLowerCase() }]
        });
        if (exists) {
            return res.status(400).json({ message: '使用者名稱或 email 已被使用' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

        const user = new User({
            username: String(username).trim(),
            password,
            email: String(email).trim().toLowerCase(),
            fullName: fullName ? String(fullName).trim() : '',
            role: 'user',
            emailVerified: false,
            emailVerificationToken: token,
            emailVerificationExpires: expires,
            membershipStatus: 'none',
            canManageContent: false,
            isFirstLogin: false
        });
        await user.save();

        let mailResult = { ok: false, mock: true };
        try {
            mailResult = await sendVerificationEmail(
                { username: user.username, email: user.email },
                token
            );
        } catch (mailErr) {
            console.warn('Verification email failed:', mailErr.message);
            mailResult = { ok: false, error: mailErr.message };
        }

        const emailSent = !!mailResult.ok;
        res.status(201).json({
            message: emailSent
                ? '註冊成功，請至信箱點擊驗證連結後再登入。'
                : '帳號已建立，但驗證信未能寄出（伺服器未設定 SMTP 或寄件失敗）。請聯絡管理員，或於設定 SMTP 後使用「重送驗證信」。',
            emailSent,
            email: user.email
        });
    } catch (error) {
        console.error('Register error:', error);
        if (error.code === 11000) {
            return res.status(400).json({ message: '使用者名稱或 email 已被使用' });
        }
        res.status(500).json({ message: 'Internal server error' });
    }
});

router.get('/verify-email', async (req, res) => {
    try {
        const { token, redirect } = req.query;
        if (!token) {
            return res.status(400).json({ message: '缺少 token' });
        }

        const user = await User.findOne({
            emailVerificationToken: String(token),
            emailVerificationExpires: { $gt: new Date() }
        }).select('+emailVerificationToken +emailVerificationExpires');

        if (!user) {
            if (redirect === '1') {
                return res.redirect('/member?verify=invalid');
            }
            return res.status(400).json({ message: '驗證連結無效或已過期' });
        }

        user.emailVerified = true;
        user.emailVerificationToken = undefined;
        user.emailVerificationExpires = undefined;
        await user.save();

        if (redirect === '1') {
            return res.redirect('/member?verify=ok');
        }
        res.json({ message: '信箱驗證成功，請登入。' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
});

router.post('/resend-verification', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email || !EMAIL_RE.test(String(email).trim())) {
            return res.status(400).json({ message: '請提供有效 email' });
        }

        const user = await User.findOne({ email: String(email).trim().toLowerCase() }).select(
            '+emailVerificationToken +emailVerificationExpires'
        );
        if (!user) {
            return res.json({ message: '若此信箱已註冊且尚未驗證，將寄出驗證信' });
        }
        if (user.emailVerified) {
            return res.status(400).json({ message: '此帳號已完成驗證' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        user.emailVerificationToken = token;
        user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await user.save();

        let mailResult = { ok: false, mock: true };
        try {
            mailResult = await sendVerificationEmail({ username: user.username, email: user.email }, token);
        } catch (e) {
            console.warn('Resend verification email failed:', e.message);
            mailResult = { ok: false, error: e.message };
        }
        if (!mailResult.ok) {
            return res.status(503).json({
                message:
                    '驗證信無法寄出：請確認伺服器已設定 SMTP_HOST、SMTP_USERNAME、SMTP_PASSWORD（Gmail 須使用應用程式專用密碼），並查看主機日誌。',
                emailSent: false
            });
        }
        res.json({ message: '驗證信已重新寄出', emailSent: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
});

router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email || !EMAIL_RE.test(String(email).trim())) {
            return res.status(400).json({ message: '請提供有效 email' });
        }

        const user = await User.findOne({
            email: String(email).trim().toLowerCase(),
            emailVerified: true,
            role: 'user'
        });

        if (user) {
            const plain = crypto.randomBytes(32).toString('hex');
            user.passwordResetTokenHash = hashPasswordResetToken(plain);
            user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000);
            await user.save();
            try {
                await sendPasswordResetEmail(
                    { username: user.username, email: user.email },
                    plain
                );
            } catch (mailErr) {
                console.warn('Password reset email failed:', mailErr.message);
            }
        }

        res.json(FORGOT_PASSWORD_RESPONSE);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
});

router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) {
            return res.status(400).json({ message: '請提供重設 token 與新密碼' });
        }
        if (String(newPassword).length < 6) {
            return res.status(400).json({ message: '密碼至少 6 字元' });
        }

        const h = hashPasswordResetToken(token);
        const user = await User.findOne({
            passwordResetTokenHash: h,
            passwordResetExpires: { $gt: new Date() }
        }).select('+passwordResetTokenHash +passwordResetExpires');

        if (!user) {
            return res.status(400).json({ message: '重設連結無效或已過期' });
        }

        user.password = String(newPassword);
        user.passwordResetTokenHash = undefined;
        user.passwordResetExpires = undefined;
        await user.save();

        res.json({ message: '密碼已重設，請使用新密碼登入。' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: '伺服器發生錯誤，請稍後再試。' });
    }
});

// 登入（資料庫連線由 server.js 的 ensureMongo 先檢查）
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // 驗證輸入
        const ident = String(username || '').trim();
        if (!ident || !password) {
            return res.status(400).json({
                message: '請輸入使用者名稱（或 Email）與密碼。'
            });
        }

        // 支援使用者名稱或已驗證之 Email 登入（與忘記密碼流程一致）
        let user = await User.findOne({ username: ident });
        if (!user && EMAIL_RE.test(ident)) {
            user = await User.findOne({ email: ident.toLowerCase() });
        }
        if (!user) {
            return res.status(401).json({
                message: '使用者名稱、Email 或密碼錯誤'
            });
        }

        // 檢查用戶是否被停用
        if (!user.isActive) {
            return res.status(401).json({
                message: '帳號已停用，請聯絡管理員。'
            });
        }

        if (!user.emailVerified) {
            return res.status(403).json({
                code: 'EMAIL_NOT_VERIFIED',
                message: '請先完成信箱驗證後再登入。若未收到信，可使用「重寄驗證信」。'
            });
        }

        // 驗證密碼
        const isPasswordValid = await user.comparePassword(password);
        if (!isPasswordValid) {
            return res.status(401).json({
                message: '使用者名稱、Email 或密碼錯誤'
            });
        }

        const forAdmin = !!(req.body && (req.body.forAdmin === true || req.body.forAdmin === 'true'));
        if (forAdmin && user.role !== 'admin') {
            return res.status(403).json({
                code: 'NOT_ADMIN',
                message: '此帳號無管理後台權限，請使用管理員帳號登入。'
            });
        }

        // 更新最後登入時間
        user.lastLogin = new Date();
        await user.save();

        // 生成 JWT token
        const token = jwt.sign(
            { 
                userId: user._id.toString(),
                username: user.username,
                role: user.role,
                emailVerified: user.emailVerified,
                membershipStatus: user.membershipStatus,
                canManageContent: user.canManageContent
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            message: '登入成功',
            token,
            user: {
                id: user._id.toString(),
                username: user.username,
                email: user.email,
                role: user.role,
                isFirstLogin: user.isFirstLogin,
                emailVerified: user.emailVerified,
                membershipStatus: user.membershipStatus,
                canManageContent: user.canManageContent
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        if (
            error.name === 'MongoServerSelectionError' ||
            error.name === 'MongooseServerSelectionError'
        ) {
            return res.status(503).json({ message: DB_UNAVAILABLE });
        }
        res.status(500).json({
            message: '伺服器發生錯誤，請稍後再試。'
        });
    }
});

// 修改密碼 (需要認證)
router.post('/change-password', verifiedAuth, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        // 驗證輸入
        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                message: 'Current password and new password are required'
            });
        }

        if (newPassword.length < 4) {
            return res.status(400).json({
                message: 'New password must be at least 4 characters long'
            });
        }

        // 查找用戶
        const user = await User.findById(req.authUser._id);
        if (!user) {
            return res.status(404).json({
                message: 'User not found'
            });
        }

        // 驗證當前密碼
        const isCurrentPasswordValid = await user.comparePassword(currentPassword);
        if (!isCurrentPasswordValid) {
            return res.status(400).json({
                message: 'Current password is incorrect'
            });
        }

        // 檢查新密碼是否與當前密碼相同
        const isNewPasswordSame = await user.comparePassword(newPassword);
        if (isNewPasswordSame) {
            return res.status(400).json({
                message: 'New password must be different from current password'
            });
        }

        // 更新密碼
        await user.updatePassword(newPassword);

        res.json({
            message: 'Password updated successfully'
        });

    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({
            message: 'Internal server error'
        });
    }
});

// 強制修改密碼 (首次登入)
router.post('/force-change-password', verifiedAuth, async (req, res) => {
    try {
        const { newPassword } = req.body;

        if (!newPassword) {
            return res.status(400).json({
                message: 'New password is required'
            });
        }

        if (newPassword.length < 4) {
            return res.status(400).json({
                message: 'Password must be at least 4 characters long'
            });
        }

        const user = await User.findById(req.authUser._id);
        if (!user) {
            return res.status(404).json({
                message: 'User not found'
            });
        }

        // 檢查是否為預設密碼
        const isDefaultPassword = await user.comparePassword('user');
        if (!isDefaultPassword && !user.isFirstLogin) {
            return res.status(400).json({
                message: 'Password has already been changed'
            });
        }

        // 更新密碼
        await user.updatePassword(newPassword);

        res.json({
            message: 'Password updated successfully'
        });

    } catch (error) {
        console.error('Force change password error:', error);
        res.status(500).json({
            message: 'Internal server error'
        });
    }
});

// 驗證 token
router.get('/verify', verifiedAuth, async (req, res) => {
    try {
        const user = await User.findById(req.authUser._id).select('-password');
        if (!user || !user.isActive) {
            return res.status(401).json({
                message: 'User not found or inactive'
            });
        }

        res.json({
            message: 'Token is valid',
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                isFirstLogin: user.isFirstLogin,
                emailVerified: user.emailVerified,
                membershipStatus: user.membershipStatus,
                canManageContent: user.canManageContent
            }
        });
    } catch (error) {
        res.status(500).json({
            message: 'Internal server error'
        });
    }
});

module.exports = router;
