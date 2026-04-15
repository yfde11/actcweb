const Event = require('../models/Event');
const EventRegistration = require('../models/EventRegistration');

function httpError(status, message) {
    const e = new Error(message);
    e.status = status;
    return e;
}

/**
 * @param {import('mongoose').Document[]} eventDocs
 */
async function enrichEventsWithWaitlistCounts(eventDocs) {
    const arr = Array.isArray(eventDocs) ? eventDocs : [eventDocs];
    if (arr.length === 0) return [];
    const ids = arr.map((e) => e._id);
    const counts = await EventRegistration.aggregate([
        { $match: { event: { $in: ids }, status: 'waitlist' } },
        { $group: { _id: '$event', waitlistCount: { $sum: 1 } } }
    ]);
    const countMap = new Map(counts.map((c) => [String(c._id), c.waitlistCount]));
    return arr.map((e) => {
        const plain =
            typeof e.toObject === 'function' ? e.toObject({ virtuals: true }) : { ...e };
        plain.waitlistCount = countMap.get(String(e._id)) || 0;
        return plain;
    });
}

/**
 * 取消單筆報名或候補；邏輯與公開 POST /api/events/:id/unregister 一致。
 * @param {string} eventId
 * @param {string} emailNorm 已 normalize 之 email
 * @returns {Promise<{ message: string, registrationStatus: string, event: object }>}
 */
async function cancelEventRegistration(eventId, emailNorm) {
    if (!emailNorm) {
        throw httpError(400, 'Participant email is required');
    }

    const event = await Event.findById(eventId);
    if (!event) {
        throw httpError(404, 'Event not found');
    }

    if (event.status !== 'registration_open') {
        throw httpError(400, 'Event registration is not open');
    }

    const reg = await EventRegistration.findOne({ event: event._id, email: emailNorm });
    if (!reg) {
        throw httpError(404, '找不到此 Email 的報名紀錄');
    }

    if (reg.status === 'waitlist') {
        await reg.deleteOne();
        const fresh = await Event.findById(event._id);
        const [enriched] = await enrichEventsWithWaitlistCounts([fresh]);
        return {
            message: '已取消候補',
            registrationStatus: 'cancelled',
            event: {
                id: enriched._id,
                title: enriched.title,
                registeredCount: enriched.registeredCount,
                remainingSpots: enriched.remainingSpots,
                waitlistCount: enriched.waitlistCount
            }
        };
    }

    await EventRegistration.deleteOne({ _id: reg._id });
    await Event.updateOne({ _id: event._id }, { $inc: { registeredCount: -1 } });

    if (event.capacity) {
        const next = await EventRegistration.findOne({
            event: event._id,
            status: 'waitlist'
        })
            .sort({ waitlistPosition: 1, createdAt: 1 });

        if (next) {
            next.status = 'confirmed';
            next.waitlistPosition = undefined;
            await next.save();
            await Event.updateOne({ _id: event._id }, { $inc: { registeredCount: 1 } });
        }
    }

    const fresh = await Event.findById(event._id);
    const [enriched] = await enrichEventsWithWaitlistCounts([fresh]);
    return {
        message: 'Unregistration successful',
        registrationStatus: 'cancelled',
        event: {
            id: enriched._id,
            title: enriched.title,
            registeredCount: enriched.registeredCount,
            remainingSpots: enriched.remainingSpots,
            waitlistCount: enriched.waitlistCount
        }
    };
}

module.exports = {
    enrichEventsWithWaitlistCounts,
    cancelEventRegistration,
    httpError
};
