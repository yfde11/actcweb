const express = require('express');
const User = require('../models/User');
const { adminAuth } = require('../middleware/adminAuth');

const router = express.Router();

// 獲取所有使用者 (僅管理員)
router.get('/', adminAuth, async (req, res) => {
    try {
        const users = await User.find({})
            .select('-password')
            .sort({ createdAt: -1 });
        
        res.json({
            message: 'Users retrieved successfully',
            users
        });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({
            message: 'Internal server error'
        });
    }
});

// 創建新使用者 (僅管理員)
router.post('/', adminAuth, async (req, res) => {
    try {
        const { username, email, fullName, role = 'user' } = req.body;

        // 驗證輸入
        if (!username) {
            return res.status(400).json({
                message: 'Username is required'
            });
        }

        // 檢查使用者是否已存在
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({
                message: 'Username already exists'
            });
        }

        const roleNorm = ['admin', 'user'].includes(role) ? role : 'user';

        // 創建新使用者，預設密碼為 'user'
        const newUser = new User({
            username,
            password: 'user', // 預設密碼，會透過 pre-save middleware 加密
            email,
            fullName,
            role: roleNorm,
            isFirstLogin: true,
            emailVerified: true,
            membershipStatus: roleNorm === 'admin' ? 'approved' : 'none'
        });

        await newUser.save();

        // 返回不包含密碼的使用者資訊
        const userResponse = await User.findById(newUser._id).select('-password');

        res.status(201).json({
            message: 'User created successfully',
            user: userResponse
        });

    } catch (error) {
        console.error('Create user error:', error);
        if (error.code === 11000) {
            const field = error.keyPattern && error.keyPattern.email ? 'Email' : 'Username';
            return res.status(400).json({ message: `${field} already exists` });
        }
        if (error.name === 'ValidationError') {
            const msg = Object.values(error.errors).map(e => e.message).join('; ');
            return res.status(400).json({ message: msg });
        }
        res.status(500).json({
            message: 'Internal server error'
        });
    }
});

// 獲取單一使用者 (僅管理員)
router.get('/:id', adminAuth, async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password');
        
        if (!user) {
            return res.status(404).json({
                message: 'User not found'
            });
        }

        res.json({
            message: 'User retrieved successfully',
            user
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({
            message: 'Internal server error'
        });
    }
});

// 更新使用者 (僅管理員)
router.put('/:id', adminAuth, async (req, res) => {
    try {
        const { username, email, fullName, role, membershipStatus } = req.body;
        const userId = req.params.id;

        // 不允許修改自己的角色
        if (userId === req.user.userId && role && role !== 'admin') {
            return res.status(400).json({
                message: 'Cannot change your own admin role'
            });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                message: 'User not found'
            });
        }

        if (username) user.username = String(username).trim();
        if (email !== undefined) user.email = email ? String(email).trim().toLowerCase() : email;
        if (fullName !== undefined) user.fullName = fullName ? String(fullName).trim() : '';
        if (role && ['admin', 'user'].includes(role)) {
            user.role = role;
        }

        // 僅一般使用者可調整會員審核（避免誤改 admin 帳號）
        if (user.role === 'user') {
            const MS = ['none', 'pending', 'approved', 'rejected'];
            if (membershipStatus !== undefined && MS.includes(String(membershipStatus))) {
                user.membershipStatus = String(membershipStatus);
            }
        }

        await user.save();

        const out = await User.findById(userId).select('-password');

        res.json({
            message: 'User updated successfully',
            user: out
        });

    } catch (error) {
        console.error('Update user error:', error);
        if (error.code === 11000) {
            return res.status(400).json({
                message: 'Username already exists'
            });
        }
        res.status(500).json({
            message: 'Internal server error'
        });
    }
});

// 停用/啟用使用者 (僅管理員)
router.patch('/:id/toggle-status', adminAuth, async (req, res) => {
    try {
        const userId = req.params.id;

        // 不允許停用自己
        if (userId === req.user.userId) {
            return res.status(400).json({
                message: 'Cannot change your own status'
            });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                message: 'User not found'
            });
        }

        user.isActive = !user.isActive;
        await user.save();

        const updatedUser = await User.findById(userId).select('-password');

        res.json({
            message: `User ${user.isActive ? 'activated' : 'suspended'} successfully`,
            user: updatedUser
        });

    } catch (error) {
        console.error('Toggle user status error:', error);
        res.status(500).json({
            message: 'Internal server error'
        });
    }
});

// 重設使用者密碼 (僅管理員)
router.patch('/:id/reset-password', adminAuth, async (req, res) => {
    try {
        const userId = req.params.id;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                message: 'User not found'
            });
        }

        // 重設為預設密碼
        user.password = 'user';
        user.isFirstLogin = true;
        await user.save();

        res.json({
            message: 'Password reset successfully. New password is "user"'
        });

    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({
            message: 'Internal server error'
        });
    }
});

// 刪除使用者 (僅管理員)
router.delete('/:id', adminAuth, async (req, res) => {
    try {
        const userId = req.params.id;

        // 不允許刪除自己
        if (userId === req.user.userId) {
            return res.status(400).json({
                message: 'Cannot delete your own account'
            });
        }

        const user = await User.findByIdAndDelete(userId);
        if (!user) {
            return res.status(404).json({
                message: 'User not found'
            });
        }

        res.json({
            message: 'User deleted successfully'
        });

    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({
            message: 'Internal server error'
        });
    }
});

module.exports = router;
