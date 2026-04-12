const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Event = require('../models/Event');
const { contributorAuth } = require('../middleware/memberAuth');
const { notifyAudienceByEmail, buildEventEmailDoc } = require('../services/contentNotifications');

const router = express.Router();

const storage = multer.diskStorage({
    destination(req, file, cb) {
        let uploadPath = 'uploads/';
        if (file.fieldname === 'image' || file.fieldname === 'instructorPhoto') {
            uploadPath = 'uploads/images/';
        } else if (file.fieldname === 'file') {
            uploadPath = 'uploads/files/';
        }
        if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
    },
    filename(req, file, cb) {
        const ext = path.extname(file.originalname);
        cb(null, `${file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter(req, file, cb) {
        if (file.fieldname === 'image' || file.fieldname === 'instructorPhoto') {
            return file.mimetype.startsWith('image/')
                ? cb(null, true)
                : cb(new Error('Only image files allowed'));
        }
        cb(null, true);
    }
});

const AUDIENCES = ['none', 'verified_users', 'approved_members'];

async function maybeNotifyEvent(event, prevStatus) {
    const pub = ['published', 'registration_open', 'registration_closed'].includes(event.status);
    if (!pub || !AUDIENCES.includes(event.notifyAudience) || event.notifyAudience === 'none') return;
    if (['published', 'registration_open', 'registration_closed'].includes(prevStatus)) return;
    const { subject, html, text } = buildEventEmailDoc(event);
    try {
        await notifyAudienceByEmail({ audience: event.notifyAudience, subject, html, text });
    } catch (e) {
        console.warn('notifyAudienceByEmail event:', e.message);
    }
}

router.get('/mine', contributorAuth, async (req, res) => {
    try {
        const events = await Event.find({ createdBy: req.authUser._id })
            .sort({ updatedAt: -1 })
            .limit(100)
            .select('-__v');
        res.json({ events });
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
        { name: 'file', maxCount: 1 },
        { name: 'instructorPhoto', maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            const {
                title,
                type,
                description,
                shortDescription,
                date,
                endDate,
                location,
                virtualLocation,
                link,
                instructor,
                duration,
                capacity,
                price,
                status,
                tags,
                requirements,
                materials,
                notifyAudience = 'none'
            } = req.body;

            if (!title || !type || !description || !date || !location) {
                return res.status(400).json({
                    message: 'Title, type, description, date, and location are required'
                });
            }
            if (!AUDIENCES.includes(notifyAudience)) {
                return res.status(400).json({ message: 'notifyAudience 無效' });
            }

            const eventData = {
                title,
                type,
                description,
                shortDescription,
                date: new Date(date),
                endDate: endDate ? new Date(endDate) : undefined,
                location,
                virtualLocation,
                link: link || '',
                instructor: instructor ? JSON.parse(instructor) : {},
                duration: duration ? JSON.parse(duration) : {},
                capacity: capacity || undefined,
                price: price ? JSON.parse(price) : { isFree: true },
                status: status || 'draft',
                tags: tags ? JSON.parse(tags) : [],
                requirements,
                materials: materials ? JSON.parse(materials) : [],
                createdBy: req.authUser._id,
                notifyAudience
            };

            if (req.files?.image) eventData.image = `/${req.files.image[0].path}`.replace(/\\/g, '/');
            if (req.files?.file) {
                eventData.file = {
                    path: `/${req.files.file[0].path}`.replace(/\\/g, '/'),
                    originalName: req.files.file[0].originalname,
                    size: req.files.file[0].size,
                    mimeType: req.files.file[0].mimetype
                };
            }
            if (req.files?.instructorPhoto && eventData.instructor) {
                eventData.instructor.photo = `/${req.files.instructorPhoto[0].path}`.replace(/\\/g, '/');
            }

            const prevStatus = 'draft';
            const event = new Event(eventData);
            await event.save();
            await maybeNotifyEvent(event, prevStatus);

            res.status(201).json({ message: 'Event created', event });
        } catch (error) {
            console.error(error);
            res.status(400).json({ message: error.message || 'Internal server error' });
        }
    }
);

router.put(
    '/:id',
    contributorAuth,
    upload.fields([
        { name: 'image', maxCount: 1 },
        { name: 'file', maxCount: 1 },
        { name: 'instructorPhoto', maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            const event = await Event.findById(req.params.id);
            if (!event || String(event.createdBy) !== String(req.authUser._id)) {
                return res.status(404).json({ message: 'Event not found' });
            }

            const prevStatus = event.status;
            const updateData = { ...req.body };
            if (updateData.date) updateData.date = new Date(updateData.date);
            if (updateData.endDate) updateData.endDate = new Date(updateData.endDate);
            ['instructor', 'duration', 'price', 'tags', 'materials'].forEach((k) => {
                if (updateData[k] && typeof updateData[k] === 'string') {
                    try {
                        updateData[k] = JSON.parse(updateData[k]);
                    } catch (e) {
                        /* keep string */
                    }
                }
            });

            if (updateData.notifyAudience !== undefined && !AUDIENCES.includes(updateData.notifyAudience)) {
                return res.status(400).json({ message: 'notifyAudience 無效' });
            }

            Object.assign(event, updateData);
            if (req.files?.image) event.image = `/${req.files.image[0].path}`.replace(/\\/g, '/');
            if (req.files?.file) {
                event.file = {
                    path: `/${req.files.file[0].path}`.replace(/\\/g, '/'),
                    originalName: req.files.file[0].originalname,
                    size: req.files.file[0].size,
                    mimeType: req.files.file[0].mimetype
                };
            }
            if (req.files?.instructorPhoto) {
                if (!event.instructor) event.instructor = {};
                event.instructor.photo = `/${req.files.instructorPhoto[0].path}`.replace(/\\/g, '/');
            }

            await event.save();
            await maybeNotifyEvent(event, prevStatus);
            res.json({ message: 'Event updated', event });
        } catch (error) {
            console.error(error);
            res.status(400).json({ message: error.message || 'Internal server error' });
        }
    }
);

router.delete('/:id', contributorAuth, async (req, res) => {
    try {
        const event = await Event.findById(req.params.id);
        if (!event || String(event.createdBy) !== String(req.authUser._id)) {
            return res.status(404).json({ message: 'Event not found' });
        }
        await event.deleteOne();
        res.json({ message: 'Deleted' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router;
