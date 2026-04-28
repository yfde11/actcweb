const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Event = require('../models/Event');
const EventRegistration = require('../models/EventRegistration');
const EventMaterial = require('../models/EventMaterial');
const EventSurveyResponse = require('../models/EventSurveyResponse');
const { contributorAuth, verifiedAuth } = require('../middleware/memberAuth');
const { notifyAudienceByEmail, buildEventEmailDoc } = require('../services/contentNotifications');
const {
    createMemberRegistration,
    cancelEventRegistration,
    enrichEventsWithWaitlistCounts
} = require('../services/eventRegistrations');
const { sendEventNotification } = require('../services/eventNotifications');
const { linkUnclaimedRegistrationsToUser } = require('../services/registrationLinking');

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

const paymentProofStorage = multer.diskStorage({
    destination(req, file, cb) {
        const uploadPath = 'uploads/payment-proofs/';
        if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
    },
    filename(req, file, cb) {
        const ext = path.extname(file.originalname);
        cb(null, `payment-proof-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    }
});

const paymentProofUpload = multer({
    storage: paymentProofStorage,
    limits: { fileSize: 20 * 1024 * 1024 }
});

function normalizeUploadedFilename(name) {
    if (!name) return '';
    const raw = String(name);
    try {
        return Buffer.from(raw, 'latin1').toString('utf8');
    } catch {
        return raw;
    }
}

function normalizePathForComparison(p) {
    return path.resolve(p || '').replace(/\\/g, '/');
}

function isMaterialAvailable(material) {
    const now = new Date();
    if (!material.isActive) return false;
    if (material.availableFrom && new Date(material.availableFrom) > now) return false;
    if (material.availableUntil && new Date(material.availableUntil) < now) return false;
    return true;
}

function hasMaterialAccess(material, registration) {
    const status = registration?.status;
    const paymentStatus = registration?.paymentStatus;
    const attendanceStatus = registration?.attendanceStatus;

    if (material.accessLevel === 'public') return true;
    if (material.accessLevel === 'login_required') return true;
    if (material.accessLevel === 'registered_only') {
        return ['registered', 'waitlisted', 'pending_approval'].includes(status);
    }
    if (material.accessLevel === 'paid_only') {
        return paymentStatus === 'paid' || paymentStatus === 'none';
    }
    if (material.accessLevel === 'attended_only') {
        return attendanceStatus === 'attended';
    }
    return false;
}

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

router.post('/:eventId/register', verifiedAuth, async (req, res) => {
    try {
        const { eventId } = req.params;
        if (!mongoose.isValidObjectId(eventId)) {
            return res.status(400).json({ message: 'Invalid event id' });
        }

        const event = await Event.findById(eventId);
        if (!event) {
            return res.status(404).json({ message: 'Event not found' });
        }

        const registration = await createMemberRegistration({
            event,
            user: req.authUser,
            participantName: req.authUser.fullName || req.authUser.username,
            participantEmail: req.authUser.email,
            participantPhone: req.authUser.phone,
            organization: req.body.organization,
            title: req.body.title
        });

        const notifyType = registration.paymentStatus === 'payment_pending'
            ? 'payment_pending'
            : 'registration_success';
        await sendEventNotification({
            type: notifyType,
            recipientEmail: registration.participantEmail,
            event,
            registration,
            user: req.authUser
        });
        return res.status(201).json({
            message: 'Registration created',
            registration,
            payment: {
                paymentStatus: registration.paymentStatus,
                amountDue: registration.amountDue || 0,
                currency: registration.currency || 'TWD',
                requiresPaymentProof: registration.paymentStatus === 'payment_pending',
                instructions:
                    registration.paymentStatus === 'payment_pending'
                        ? '請先完成付款，並到會員中心上傳後五碼與繳費憑證。'
                        : ''
            }
        });
    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({ message: error.message });
        }
        if (error && error.code === 11000) {
            return res.status(409).json({ message: '您已報名過此活動' });
        }
        console.error('Member register event error:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
});

router.get('/my-registrations', verifiedAuth, async (req, res) => {
    try {
        await linkUnclaimedRegistrationsToUser(req.authUser);
        const email = EventRegistration.normalizeEmail(req.authUser.email);
        const regs = await EventRegistration.find({ participantEmail: email })
            .populate('event', 'title date endDate location type status surveyEnabled certificateEnabled')
            .sort({ createdAt: -1 })
            .lean();

        const data = regs
            .filter((r) => !!r.event)
            .map((r) => {
                const status = r.status;
                const paymentStatus = r.paymentStatus || 'none';
                const attendanceStatus = r.attendanceStatus || 'not_checked_in';
                const canCancel = ['registered', 'waitlisted', 'pending_approval'].includes(status);
                const canSubmitPayment = ['registered', 'waitlisted', 'pending_approval'].includes(status);
                const canDownloadMaterials = ['registered', 'waitlisted', 'pending_approval'].includes(status);
                const canFillSurvey = !!r.event.surveyEnabled && status !== 'cancelled' && status !== 'rejected';
                const canDownloadCertificate = !!r.event.certificateEnabled && attendanceStatus === 'attended';
                return {
                    registrationId: r._id,
                    event: {
                        id: r.event._id,
                        title: r.event.title,
                        date: r.event.date,
                        endDate: r.event.endDate,
                        location: r.event.location,
                        type: r.event.type,
                        status: r.event.status
                    },
                    status,
                    paymentStatus,
                    attendanceStatus,
                    amountDue: r.amountDue || 0,
                    currency: r.currency || 'TWD',
                    actions: {
                        canCancel,
                        canSubmitPayment,
                        canDownloadMaterials,
                        canFillSurvey,
                        canDownloadCertificate
                    }
                };
            });

        return res.json({ registrations: data });
    } catch (error) {
        console.error('Get my registrations error:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
});

/** 活動完整內容（已報名會員專用）：不變更 views、不套用公開單筆的狀態白名單。 */
router.get('/:eventId/detail', verifiedAuth, async (req, res) => {
    try {
        const { eventId } = req.params;
        if (!mongoose.isValidObjectId(eventId)) {
            return res.status(400).json({ message: 'Invalid event id' });
        }
        const email = EventRegistration.normalizeEmail(req.authUser.email);
        const hasRegistration = await EventRegistration.findOne({ event: eventId, participantEmail: email });
        if (!hasRegistration) {
            return res.status(403).json({ message: '您沒有此活動的報名紀錄' });
        }
        const event = await Event.findById(eventId).select('-__v');
        if (!event) {
            return res.status(404).json({ message: 'Event not found' });
        }
        const [enriched] = await enrichEventsWithWaitlistCounts([event]);
        return res.json(enriched);
    } catch (error) {
        console.error('Member event detail error:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
});

router.post('/:eventId/cancel', verifiedAuth, async (req, res) => {
    try {
        const { eventId } = req.params;
        if (!mongoose.isValidObjectId(eventId)) {
            return res.status(400).json({ message: 'Invalid event id' });
        }
        const email = EventRegistration.normalizeEmail(req.authUser.email);
        const result = await cancelEventRegistration(eventId, email);
        // TODO(EventOps-MVP): waitlist auto-promotion is intentionally deferred for MVP.
        return res.json(result);
    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({ message: error.message });
        }
        console.error('Member cancel registration error:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
});

router.post('/:eventId/payment-proof', verifiedAuth, paymentProofUpload.single('file'), async (req, res) => {
    try {
        const { eventId } = req.params;
        const { lastFiveDigits, note, amount } = req.body;
        if (!mongoose.isValidObjectId(eventId)) {
            return res.status(400).json({ message: 'Invalid event id' });
        }
        const amountRaw = String(amount || '').trim();
        if (!amountRaw) {
            return res.status(400).json({ message: '請填寫付款金額' });
        }
        const amountNum = Number(amountRaw);
        if (!Number.isFinite(amountNum) || amountNum < 0) {
            return res.status(400).json({ message: '付款金額格式不正確' });
        }
        const lastFive = String(lastFiveDigits || '').trim();
        if (!lastFive && !req.file) {
            return res.status(400).json({ message: '請上傳收據圖片或填寫轉出帳戶後五碼' });
        }

        const email = EventRegistration.normalizeEmail(req.authUser.email);
        const reg = await EventRegistration.findOne({ event: eventId, participantEmail: email });
        if (!reg) {
            return res.status(404).json({ message: 'Registration not found' });
        }
        if (!['registered', 'pending_approval', 'waitlisted'].includes(reg.status)) {
            return res.status(400).json({ message: 'Current registration status cannot submit payment proof' });
        }

        reg.paymentProof = reg.paymentProof || {};
        reg.paymentProof.lastFiveDigits = lastFive;
        reg.paymentProof.note = String(note || '').trim();
        reg.paymentProof.amount = amountNum;
        if (req.file) {
            reg.paymentProof.file = {
                path: `/${req.file.path}`.replace(/\\/g, '/'),
                originalName: req.file.originalname,
                size: req.file.size,
                mimeType: req.file.mimetype
            };
        }
        reg.paymentProof.submittedAt = new Date();
        reg.paymentStatus = 'payment_submitted';
        await reg.save();

        console.warn('[EventOps][MVP] payment proof submitted, please review manually:', {
            eventId,
            registrationId: reg._id
        });

        return res.json({ message: 'Payment proof submitted', registration: reg });
    } catch (error) {
        console.error('Submit payment proof error:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
});

router.get('/:eventId/materials', verifiedAuth, async (req, res) => {
    try {
        const { eventId } = req.params;
        if (!mongoose.isValidObjectId(eventId)) {
            return res.status(400).json({ message: 'Invalid event id' });
        }
        const event = await Event.findById(eventId).select('_id price');
        if (!event) {
            return res.status(404).json({ message: 'Event not found' });
        }
        const email = EventRegistration.normalizeEmail(req.authUser.email);
        const reg = await EventRegistration.findOne({ event: eventId, participantEmail: email }).lean();
        const materials = await EventMaterial.find({ event: eventId, isActive: true }).sort({ createdAt: -1 }).lean();
        const visibleMaterials = materials
            .filter((m) => isMaterialAvailable(m))
            .filter((m) => hasMaterialAccess(m, reg))
            .map((m) => ({
                _id: m._id,
                title: m.title,
                description: m.description,
                category: m.category,
                accessLevel: m.accessLevel,
                externalUrl: m.externalUrl,
                availableFrom: m.availableFrom,
                availableUntil: m.availableUntil,
                hasFile: !!m.file?.path,
                fileName: normalizeUploadedFilename(m.file?.originalName || ''),
                fileSize: m.file?.size || 0
            }));
        return res.json({ materials: visibleMaterials });
    } catch (error) {
        console.error('Get member materials error:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
});

router.get('/materials/:materialId/download', verifiedAuth, async (req, res) => {
    try {
        const { materialId } = req.params;
        if (!mongoose.isValidObjectId(materialId)) {
            return res.status(400).json({ message: 'Invalid material id' });
        }
        const material = await EventMaterial.findById(materialId);
        if (!material || !material.isActive) {
            return res.status(404).json({ message: 'Material not found' });
        }
        const email = EventRegistration.normalizeEmail(req.authUser.email);
        const reg = await EventRegistration.findOne({
            event: material.event,
            participantEmail: email
        }).lean();
        if (!hasMaterialAccess(material, reg)) {
            return res.status(403).json({ message: 'No permission to download this material' });
        }
        if (!material.file || !material.file.path) {
            return res.status(404).json({ message: 'No downloadable file' });
        }

        const resolvedPath = normalizePathForComparison(material.file.path.startsWith('/') ? material.file.path.slice(1) : material.file.path);
        const uploadRoot = normalizePathForComparison(path.join(process.cwd(), 'uploads/event-materials'));
        if (!resolvedPath.startsWith(uploadRoot)) {
            return res.status(403).json({ message: 'Invalid material path' });
        }
        if (!fs.existsSync(resolvedPath)) {
            return res.status(404).json({ message: 'File not found on server' });
        }
        await EventMaterial.updateOne({ _id: material._id }, { $inc: { downloadCount: 1 } });
        const normalizedFilename = normalizeUploadedFilename(
            material.file.originalName || path.basename(resolvedPath)
        );
        return res.download(resolvedPath, normalizedFilename);
    } catch (error) {
        console.error('Download material error:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
});

router.post('/:eventId/survey', verifiedAuth, async (req, res) => {
    try {
        const { eventId } = req.params;
        if (!mongoose.isValidObjectId(eventId)) {
            return res.status(400).json({ message: 'Invalid event id' });
        }
        const event = await Event.findById(eventId).select('_id surveyEnabled');
        if (!event) {
            return res.status(404).json({ message: 'Event not found' });
        }
        if (!event.surveyEnabled) {
            return res.status(400).json({ message: 'Survey is not enabled for this event' });
        }
        const email = EventRegistration.normalizeEmail(req.authUser.email);
        const reg = await EventRegistration.findOne({ event: eventId, participantEmail: email });
        if (!reg) {
            return res.status(404).json({ message: 'Registration not found' });
        }

        const exists = await EventSurveyResponse.findOne({
            event: event._id,
            user: req.authUser._id
        });
        if (exists) {
            return res.status(409).json({ message: 'Survey already submitted' });
        }

        const survey = await EventSurveyResponse.create({
            event: event._id,
            user: req.authUser._id,
            registration: reg._id,
            overallRating: req.body.overallRating,
            instructorRating: req.body.instructorRating,
            materialRating: req.body.materialRating,
            difficulty: req.body.difficulty,
            nps: req.body.nps,
            mostValuable: req.body.mostValuable,
            improvementSuggestion: req.body.improvementSuggestion,
            interestedAdvancedCourse: !!req.body.interestedAdvancedCourse,
            interestedCorporateTraining: !!req.body.interestedCorporateTraining,
            interestedWorkgroup: !!req.body.interestedWorkgroup,
            submittedAt: new Date()
        });
        return res.status(201).json({ message: 'Survey submitted', survey });
    } catch (error) {
        console.error('Submit survey error:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
});

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
                    originalName: normalizeUploadedFilename(req.files.file[0].originalname),
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
                    originalName: normalizeUploadedFilename(req.files.file[0].originalname),
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
