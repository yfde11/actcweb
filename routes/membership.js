const express = require('express');
const User = require('../models/User');
const { adminAuth } = require('../middleware/adminAuth');
const { verifiedAuth } = require('../middleware/memberAuth');
const { sendMembershipDecisionEmail } = require('../services/email');

const router = express.Router();

/** 一般使用者：已驗證信箱後申請成為會員 */
router.post('/apply', verifiedAuth, async (req, res) => {
    try {
        const { note } = req.body;
        const u = await User.findById(req.authUser._id);
        if (u.role === 'admin') {
            return res.status(400).json({ message: '管理員無需申請會員' });
        }
        if (u.membershipStatus === 'pending') {
            return res.status(400).json({ message: '您已有待審核的申請' });
        }
        if (u.membershipStatus === 'approved') {
            return res.status(400).json({ message: '您已是核准會員' });
        }
        u.membershipStatus = 'pending';
        u.membershipAppliedAt = new Date();
        u.membershipApplicationNote = note ? String(note).slice(0, 500) : '';
        await u.save();
        res.json({ message: '已送出會員審核申請', membershipStatus: u.membershipStatus });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
});

/** 管理員：待審核列表 */
router.get('/admin/pending', adminAuth, async (req, res) => {
    try {
        const users = await User.find({ membershipStatus: 'pending', role: 'user' })
            .select('-password -emailVerificationToken -emailVerificationExpires')
            .sort({ membershipAppliedAt: -1 });
        res.json({ users });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
});

/** 管理員：審核 */
router.patch('/admin/:userId', adminAuth, async (req, res) => {
    try {
        const { action, canManageContent, note } = req.body;
        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({ message: 'action 須為 approve 或 reject' });
        }

        const u = await User.findById(req.params.userId);
        if (!u || u.role === 'admin') {
            return res.status(404).json({ message: 'User not found' });
        }

        if (action === 'approve') {
            u.membershipStatus = 'approved';
            u.canManageContent = !!canManageContent;
            u.membershipReviewedAt = new Date();
            u.membershipReviewNote = note ? String(note).slice(0, 500) : '';
        } else {
            u.membershipStatus = 'rejected';
            u.canManageContent = false;
            u.membershipReviewedAt = new Date();
            u.membershipReviewNote = note ? String(note).slice(0, 500) : '';
        }

        await u.save();
        try {
            await sendMembershipDecisionEmail(u, action === 'approve', u.membershipReviewNote);
        } catch (mailErr) {
            console.warn('Membership decision email failed:', mailErr.message);
        }

        const out = await User.findById(u._id).select(
            '-password -emailVerificationToken -emailVerificationExpires'
        );
        res.json({ message: '已更新', user: out });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router;
