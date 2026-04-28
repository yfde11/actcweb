const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { DB_UNAVAILABLE } = require('./mongoReady');

async function attachUserFromJwt(req, res) {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
        res.status(401).json({ message: 'Access denied. No token provided.' });
        return null;
    }
    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            res.status(401).json({ message: 'Token expired. Please login again.' });
            return null;
        }
        res.status(401).json({ message: 'Invalid token.' });
        return null;
    }

    let user;
    try {
        user = await User.findById(decoded.userId);
    } catch (e) {
        if (e.name === 'MongoServerSelectionError' || e.name === 'MongooseServerSelectionError') {
            res.status(503).json({ message: DB_UNAVAILABLE });
            return null;
        }
        throw e;
    }

    if (!user || !user.isActive) {
        res.status(401).json({ message: 'User not found or inactive.' });
        return null;
    }

    return { decoded, user };
}

/** 已登入且信箱已驗證（可存取 /api/me、申請會員等） */
const verifiedAuth = async (req, res, next) => {
    try {
        const pair = await attachUserFromJwt(req, res);
        if (!pair) return;

        const { user } = pair;
        if (!user.emailVerified) {
            return res.status(403).json({
                code: 'EMAIL_NOT_VERIFIED',
                message: '請先完成信箱驗證後再使用此功能。'
            });
        }

        req.authUser = user;
        req.user = {
            userId: user._id.toString(),
            username: user.username,
            role: user.role
        };
        next();
    } catch (error) {
        console.error('verifiedAuth error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

/** 僅管理員可存取內容管理 API（會員專區 News/Event） */
const contributorAuth = async (req, res, next) => {
    try {
        const pair = await attachUserFromJwt(req, res);
        if (!pair) return;

        const { user } = pair;
        if (!user.emailVerified) {
            return res.status(403).json({
                code: 'EMAIL_NOT_VERIFIED',
                message: '請先完成信箱驗證。'
            });
        }
        if (user.role !== 'admin') {
            return res.status(403).json({
                code: 'NOT_CONTRIBUTOR',
                message: '僅管理員可使用此功能。'
            });
        }

        req.authUser = user;
        req.user = {
            userId: user._id.toString(),
            username: user.username,
            role: user.role
        };
        next();
    } catch (error) {
        console.error('contributorAuth error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

module.exports = { verifiedAuth, contributorAuth };
