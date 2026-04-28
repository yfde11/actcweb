const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const WorkingGroup = require('../models/WorkingGroup');
const WorkingGroupMembership = require('../models/WorkingGroupMembership');
const EventRegistration = require('../models/EventRegistration');
const { cancelEventRegistration } = require('../services/eventRegistrations');
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

router.get('/me/event-registrations', verifiedAuth, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        const email = EventRegistration.normalizeEmail(req.authUser.email);
        const regs = await EventRegistration.find({ email })
            .populate({ path: 'event', select: 'title date location status capacity registeredCount' })
            .sort({ createdAt: -1 })
            .lean();

        const items = regs
            .filter((r) => r.event)
            .map((r) => ({
                registrationId: r._id.toString(),
                status: r.status,
                waitlistPosition: r.waitlistPosition,
                createdAt: r.createdAt,
                event: {
                    id: r.event._id.toString(),
                    title: r.event.title,
                    date: r.event.date,
                    location: r.event.location,
                    status: r.event.status,
                    capacity: r.event.capacity,
                    registeredCount: r.event.registeredCount
                }
            }));

        res.json({ registrations: items });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
});

router.delete('/me/event-registrations/:eventId', verifiedAuth, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        const { eventId } = req.params;
        if (!mongoose.isValidObjectId(eventId)) {
            return res.status(400).json({ message: 'Invalid event id' });
        }
        const email = EventRegistration.normalizeEmail(req.authUser.email);
        const result = await cancelEventRegistration(eventId, email);
        return res.json({
            message: result.message,
            registrationStatus: result.registrationStatus,
            event: result.event
        });
    } catch (e) {
        if (e.status) {
            return res.status(e.status).json({ message: e.message });
        }
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
