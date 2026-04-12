const express = require('express');
const mongoose = require('mongoose');
const WorkingGroup = require('../models/WorkingGroup');
const WorkingGroupMembership = require('../models/WorkingGroupMembership');
const User = require('../models/User');
const { adminAuth } = require('../middleware/adminAuth');

const router = express.Router();

router.use(adminAuth);

/** 列表（含已停用，供後台管理） */
router.get('/', async (req, res) => {
    try {
        const groups = await WorkingGroup.find({})
            .sort({ sortOrder: 1, title: 1 })
            .lean();
        res.json({ groups });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
});

router.post('/', async (req, res) => {
    try {
        const { code, title, subtitle = '', description, sortOrder = 0, isActive = true } = req.body;
        if (!code || !title || !description) {
            return res.status(400).json({ message: 'code、title、description 為必填' });
        }
        const codeNorm = String(code).trim().toLowerCase();
        const exists = await WorkingGroup.findOne({ code: codeNorm });
        if (exists) {
            return res.status(400).json({ message: 'code 已存在' });
        }
        const g = await WorkingGroup.create({
            code: codeNorm,
            title: String(title).trim(),
            subtitle: String(subtitle || '').trim(),
            description: String(description).trim(),
            sortOrder: Number(sortOrder) || 0,
            isActive: !!isActive
        });
        res.status(201).json({ message: '已建立', group: g });
    } catch (e) {
        console.error(e);
        if (e.code === 11000) {
            return res.status(400).json({ message: 'code 已存在' });
        }
        res.status(500).json({ message: 'Internal server error' });
    }
});

/** 更新（停用請設 isActive: false，不硬刪） */
router.patch('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ message: 'Invalid id' });
        }
        const g = await WorkingGroup.findById(id);
        if (!g) {
            return res.status(404).json({ message: '找不到工作小組' });
        }
        const { title, subtitle, description, sortOrder, isActive, code } = req.body;
        if (code !== undefined) {
            const codeNorm = String(code).trim().toLowerCase();
            if (codeNorm !== g.code) {
                const taken = await WorkingGroup.findOne({ code: codeNorm, _id: { $ne: g._id } });
                if (taken) {
                    return res.status(400).json({ message: 'code 已被使用' });
                }
                g.code = codeNorm;
            }
        }
        if (title !== undefined) g.title = String(title).trim();
        if (subtitle !== undefined) g.subtitle = String(subtitle || '').trim();
        if (description !== undefined) g.description = String(description).trim();
        if (sortOrder !== undefined) g.sortOrder = Number(sortOrder) || 0;
        if (isActive !== undefined) g.isActive = !!isActive;
        await g.save();
        res.json({ message: '已更新', group: g });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
});

router.get('/:id/members', async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ message: 'Invalid id' });
        }
        const wg = await WorkingGroup.findById(id).select('_id title');
        if (!wg) {
            return res.status(404).json({ message: '找不到工作小組' });
        }
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const skip = (page - 1) * limit;

        const [rows, total] = await Promise.all([
            WorkingGroupMembership.find({ workingGroup: id })
                .sort({ joinedAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate('user', 'username email fullName membershipStatus emailVerified')
                .lean(),
            WorkingGroupMembership.countDocuments({ workingGroup: id })
        ]);

        const members = rows.map((r) => ({
            membershipId: r._id.toString(),
            joinedAt: r.joinedAt,
            user: r.user
                ? {
                      id: r.user._id.toString(),
                      username: r.user.username,
                      email: r.user.email,
                      fullName: r.user.fullName,
                      membershipStatus: r.user.membershipStatus,
                      emailVerified: r.user.emailVerified
                  }
                : null
        }));

        res.json({
            workingGroup: { id: wg._id.toString(), title: wg.title },
            members,
            total,
            page,
            limit
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
});

/** 管理員代加入（對象須為已驗證信箱且會員已核准） */
router.post('/:id/members', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.body;
        if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(userId)) {
            return res.status(400).json({ message: 'Invalid id' });
        }
        const wg = await WorkingGroup.findById(id);
        if (!wg) {
            return res.status(404).json({ message: '找不到工作小組' });
        }
        if (!wg.isActive) {
            return res.status(400).json({ message: '已停用的小組無法加入成員，請先啟用。' });
        }
        const user = await User.findById(userId).select(
            'username email fullName membershipStatus emailVerified isActive'
        );
        if (!user || !user.isActive) {
            return res.status(404).json({ message: '找不到使用者' });
        }
        if (!user.emailVerified) {
            return res.status(400).json({ message: '該帳號尚未完成信箱驗證' });
        }
        if (user.membershipStatus !== 'approved') {
            return res.status(400).json({ message: '僅限會員審核狀態為「已核准」的帳號加入工作小組' });
        }
        try {
            await WorkingGroupMembership.create({
                user: user._id,
                workingGroup: wg._id
            });
        } catch (err) {
            if (err.code === 11000) {
                return res.status(400).json({ message: '該使用者已在此工作小組' });
            }
            throw err;
        }
        res.status(201).json({ message: '已加入工作小組' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
});

router.delete('/:id/members/:userId', async (req, res) => {
    try {
        const { id, userId } = req.params;
        if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(userId)) {
            return res.status(400).json({ message: 'Invalid id' });
        }
        const r = await WorkingGroupMembership.deleteOne({
            workingGroup: id,
            user: userId
        });
        if (r.deletedCount === 0) {
            return res.status(404).json({ message: '找不到此成員紀錄' });
        }
        res.json({ message: '已移除此成員' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router;
