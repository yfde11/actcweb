const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const WorkingGroup = require('../models/WorkingGroup');
const WorkingGroupMembership = require('../models/WorkingGroupMembership');
const { verifiedAuth } = require('../middleware/memberAuth');

const router = express.Router();

async function userResponsePayload(u) {
    const workingGroupIds =
        u.membershipStatus === 'approved'
            ? (await WorkingGroupMembership.find({ user: u._id }).distinct('workingGroup')).map((id) =>
                  id.toString()
              )
            : [];
    return {
        id: u._id.toString(),
        username: u.username,
        email: u.email,
        fullName: u.fullName,
        phone: u.phone,
        role: u.role,
        emailVerified: u.emailVerified,
        membershipStatus: u.membershipStatus,
        canManageContent: u.canManageContent,
        emailSubscribed: u.emailSubscribed,
        isFirstLogin: u.isFirstLogin,
        workingGroupIds
    };
}

router.get('/me', verifiedAuth, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        const u = await User.findById(req.authUser._id).select(
            '-password -emailVerificationToken -emailVerificationExpires'
        );
        res.json({
            user: await userResponsePayload(u)
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
});

router.patch('/me', verifiedAuth, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        const { fullName, phone, emailSubscribed } = req.body;
        const u = await User.findById(req.authUser._id);
        if (fullName !== undefined) u.fullName = fullName;
        if (phone !== undefined) u.phone = phone;
        if (emailSubscribed !== undefined) u.emailSubscribed = !!emailSubscribed;
        await u.save();
        const out = await User.findById(u._id).select(
            '-password -emailVerificationToken -emailVerificationExpires'
        );
        res.json({
            message: '個人資料已更新',
            user: await userResponsePayload(out)
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * 已核准會員：以 groupIds 完全取代目前加入的工作小組（可為空陣列）
 */
router.put('/me/working-groups', verifiedAuth, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        const u = await User.findById(req.authUser._id);
        if (!u) {
            return res.status(401).json({ message: 'User not found.' });
        }
        if (u.membershipStatus !== 'approved') {
            return res.status(403).json({
                code: 'MEMBERSHIP_NOT_APPROVED',
                message: '僅已核准會員可加入或調整工作小組。'
            });
        }
        const { groupIds } = req.body;
        if (!Array.isArray(groupIds)) {
            return res.status(400).json({ message: 'groupIds 須為陣列' });
        }
        const uniqueIds = [...new Set(groupIds.map((x) => String(x).trim()).filter(Boolean))];
        for (const gid of uniqueIds) {
            if (!mongoose.isValidObjectId(gid)) {
                return res.status(400).json({ message: 'groupIds 含有無效的 id' });
            }
        }
        const activeGroups = await WorkingGroup.find({
            _id: { $in: uniqueIds.map((id) => new mongoose.Types.ObjectId(id)) },
            isActive: true
        }).select('_id');
        if (activeGroups.length !== uniqueIds.length) {
            return res.status(400).json({ message: '僅可選擇存在且啟用中的工作小組' });
        }

        await WorkingGroupMembership.deleteMany({ user: u._id });
        if (uniqueIds.length > 0) {
            await WorkingGroupMembership.insertMany(
                uniqueIds.map((workingGroup) => ({
                    user: u._id,
                    workingGroup: new mongoose.Types.ObjectId(workingGroup)
                }))
            );
        }

        const out = await User.findById(u._id).select(
            '-password -emailVerificationToken -emailVerificationExpires'
        );
        res.json({
            message: '工作小組選擇已更新',
            user: await userResponsePayload(out)
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router;
