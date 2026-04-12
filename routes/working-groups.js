const express = require('express');
const WorkingGroup = require('../models/WorkingGroup');

const router = express.Router();

/** 公開：僅啟用中的工作小組（前台 workgroups.html） */
router.get('/', async (req, res) => {
    try {
        const groups = await WorkingGroup.find({ isActive: true })
            .sort({ sortOrder: 1, title: 1 })
            .select('code title subtitle description sortOrder')
            .lean();
        res.json({ groups });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router;
