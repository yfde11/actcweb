const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const News = require('../models/News');
const { contributorAuth } = require('../middleware/memberAuth');
const { notifyAudienceByEmail, buildNewsEmailDoc } = require('../services/contentNotifications');

const router = express.Router();

const uploadsDir = path.join(__dirname, '../uploads');
const imagesDir = path.join(uploadsDir, 'images');
const filesDir = path.join(uploadsDir, 'files');
[uploadsDir, imagesDir, filesDir].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
    destination(req, file, cb) {
        if (file.fieldname === 'image' || file.fieldname === 'images') cb(null, imagesDir);
        else if (file.fieldname === 'file') cb(null, filesDir);
        else cb(null, imagesDir);
    },
    filename(req, file, cb) {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024, files: 5 },
    fileFilter(req, file, cb) {
        if (file.fieldname === 'image' || file.fieldname === 'images') {
            return file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Only image files'));
        }
        if (file.fieldname === 'file') {
            const ok = [
                'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                'application/pdf',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            ].includes(file.mimetype);
            return ok ? cb(null, true) : cb(new Error('Only PPTX, PDF, DOCX'));
        }
        cb(null, true);
    }
});

const AUDIENCES = ['none', 'verified_users', 'approved_members'];

async function maybeNotify(news, prevStatus) {
    if (news.status !== 'published' || !AUDIENCES.includes(news.notifyAudience) || news.notifyAudience === 'none') {
        return;
    }
    if (prevStatus === 'published') return;
    const { subject, html, text } = buildNewsEmailDoc(news);
    try {
        await notifyAudienceByEmail({ audience: news.notifyAudience, subject, html, text });
    } catch (e) {
        console.warn('notifyAudienceByEmail news:', e.message);
    }
}

router.get('/mine', contributorAuth, async (req, res) => {
    try {
        const news = await News.find({ author: req.authUser._id })
            .sort({ updatedAt: -1 })
            .limit(100)
            .select('-__v');
        res.json({ news });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
});

router.post(
    '/',
    contributorAuth,
    upload.fields([
        { name: 'image', maxCount: 1 },
        { name: 'images', maxCount: 3 },
        { name: 'file', maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            const {
                title,
                content,
                description,
                videoUrl,
                publishDate,
                status = 'draft',
                tags,
                featured = false,
                notifyAudience = 'none'
            } = req.body;

            if (!title || !content) {
                return res.status(400).json({ message: 'Title and content are required' });
            }
            if (!AUDIENCES.includes(notifyAudience)) {
                return res.status(400).json({ message: 'notifyAudience 無效' });
            }

            let imageUrl = '';
            let images = [];
            if (req.files?.image) imageUrl = `/uploads/images/${req.files.image[0].filename}`;
            if (req.files?.images) {
                images = req.files.images.map((f) => `/uploads/images/${f.filename}`);
            }
            const file = req.files?.file?.[0] ? `/uploads/files/${req.files.file[0].filename}` : '';

            const tagsArray = tags
                ? (Array.isArray(tags) ? tags : String(tags).split(','))
                      .map((t) => t.trim().toLowerCase())
                      .filter(Boolean)
                : [];

            const news = new News({
                title,
                content,
                description: description || `${content.substring(0, 200)}...`,
                imageUrl,
                videoUrl: videoUrl || '',
                publishDate: publishDate ? new Date(publishDate) : new Date(),
                status,
                tags: tagsArray,
                featured: featured === 'true' || featured === true,
                author: req.authUser._id,
                date: publishDate ? new Date(publishDate) : new Date(),
                images,
                file,
                notifyAudience
            });

            const prevStatus = 'draft';
            await news.save();
            const populated = await News.findById(news._id).populate('author', 'username fullName');
            await maybeNotify(populated, prevStatus);

            res.status(201).json({ message: 'News created', news: populated });
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: error.message || 'Internal server error' });
        }
    }
);

router.put(
    '/:id',
    contributorAuth,
    upload.fields([
        { name: 'image', maxCount: 1 },
        { name: 'images', maxCount: 3 },
        { name: 'file', maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            const news = await News.findById(req.params.id);
            if (!news || String(news.author) !== String(req.authUser._id)) {
                return res.status(404).json({ message: 'News not found' });
            }

            const prevStatus = news.status;
            const {
                title,
                content,
                description,
                videoUrl,
                publishDate,
                status,
                tags,
                featured,
                notifyAudience
            } = req.body;

            if (notifyAudience !== undefined && !AUDIENCES.includes(notifyAudience)) {
                return res.status(400).json({ message: 'notifyAudience 無效' });
            }

            if (title) news.title = title;
            if (content) news.content = content;
            if (description !== undefined) news.description = description;
            if (videoUrl !== undefined) news.videoUrl = videoUrl;
            if (publishDate) news.publishDate = new Date(publishDate);
            if (status) news.status = status;
            if (notifyAudience !== undefined) news.notifyAudience = notifyAudience;
            if (tags !== undefined) {
                news.tags = (Array.isArray(tags) ? tags : String(tags).split(','))
                    .map((t) => t.trim().toLowerCase())
                    .filter(Boolean);
            }
            if (featured !== undefined) news.featured = featured === 'true' || featured === true;

            if (req.files?.image) {
                news.imageUrl = `/uploads/images/${req.files.image[0].filename}`;
            }
            if (req.files?.images) {
                news.images = req.files.images.map((f) => `/uploads/images/${f.filename}`);
            }
            if (req.files?.file) {
                news.file = `/uploads/files/${req.files.file[0].filename}`;
            }

            await news.save();
            const populated = await News.findById(news._id).populate('author', 'username fullName');
            await maybeNotify(populated, prevStatus);

            res.json({ message: 'News updated', news: populated });
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: error.message || 'Internal server error' });
        }
    }
);

router.delete('/:id', contributorAuth, async (req, res) => {
    try {
        const news = await News.findById(req.params.id);
        if (!news || String(news.author) !== String(req.authUser._id)) {
            return res.status(404).json({ message: 'News not found' });
        }
        await news.deleteOne();
        res.json({ message: 'Deleted' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router;
