const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { DB_UNAVAILABLE } = require('./mongoReady');

// 基本認證中間件
const auth = async (req, res, next) => {
    try {
        const token = req.cookies?.adminToken
            || req.header('Authorization')?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({
                message: 'Access denied. No token provided.'
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // DB lookup to reject deactivated users even if their token hasn't expired
        const user = await User.findById(decoded.userId).select('isActive');
        if (!user || !user.isActive) {
            return res.status(401).json({ message: 'User not found or inactive.' });
        }

        req.user = { ...decoded, userId: user._id.toString() };
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                message: 'Token expired. Please login again.'
            });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                message: 'Invalid token.'
            });
        }
        if (
            error.name === 'MongoServerSelectionError' ||
            error.name === 'MongooseServerSelectionError'
        ) {
            return res.status(503).json({ message: DB_UNAVAILABLE });
        }
        res.status(400).json({
            message: 'Invalid token.'
        });
    }
};

// 管理員權限中間件
const adminAuth = async (req, res, next) => {
    try {
        // 先進行基本認證
        const token = req.cookies?.adminToken
            || req.header('Authorization')?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({ 
                message: 'Access denied. No token provided.' 
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // 查找用戶並檢查角色
        const user = await User.findById(decoded.userId);
        if (!user || !user.isActive) {
            return res.status(401).json({ 
                message: 'User not found or inactive.' 
            });
        }

        if (!user.emailVerified) {
            return res.status(403).json({
                code: 'EMAIL_NOT_VERIFIED',
                message: '管理員帳號需先完成信箱驗證。'
            });
        }
        
        if (user.role !== 'admin') {
            return res.status(403).json({ 
                message: 'Access denied. Admin role required.' 
            });
        }
        
        req.user = { 
            ...decoded, 
            role: user.role, 
            userId: user._id.toString() 
        };
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                message: 'Token expired. Please login again.' 
            });
        }
        if (
            error.name === 'MongoServerSelectionError' ||
            error.name === 'MongooseServerSelectionError'
        ) {
            return res.status(503).json({ message: DB_UNAVAILABLE });
        }
        res.status(401).json({ 
            message: 'Invalid token.' 
        });
    }
};

module.exports = { auth, adminAuth };
