const Event = require('../models/Event');
const EventRegistration = require('../models/EventRegistration');

const ACTIVE_REGISTRATION_STATUSES = ['registered', 'pending_approval'];
const ACTIVE_PAYMENT_STATUSES = ['none', 'payment_pending', 'payment_submitted', 'paid'];

function httpError(status, message) {
    const e = new Error(message);
    e.status = status;
    return e;
}

function normalizeLegacyStatus(status) {
    if (status === 'confirmed') return 'registered';
    if (status === 'waitlist') return 'waitlisted';
    return status;
}

function normalizeLegacyPaymentStatus(status) {
    return status || 'none';
}

/**
 * 公開／列表 API 用：候補筆數與已報名人數由 EventRegistration 即時匯總，覆寫回傳的 registeredCount、
 * waitlistCount，並在 toObject 前寫入文件使 canRegister／remainingSpots 等虛擬欄位正確。
 * 人數＝已報名（registered、舊 confirmed、待審核 pending_approval），不篩付款狀態，與 recalculateRegisteredCount 一致。
 * @param {import('mongoose').Document[]} eventDocs
 */
async function enrichEventsWithWaitlistCounts(eventDocs) {
    const arr = Array.isArray(eventDocs) ? eventDocs : [eventDocs];
    if (arr.length === 0) return [];
    const ids = arr.map((e) => e._id);
    const [waitRows, formalRows] = await Promise.all([
        EventRegistration.aggregate([
            { $match: { event: { $in: ids }, status: { $in: ['waitlisted', 'waitlist'] } } },
            { $group: { _id: '$event', waitlistCount: { $sum: 1 } } }
        ]),
        EventRegistration.aggregate([
            {
                $match: {
                    event: { $in: ids },
                    status: { $in: ['registered', 'confirmed', 'pending_approval'] }
                }
            },
            { $group: { _id: '$event', formalCount: { $sum: 1 } } }
        ])
    ]);
    const waitMap = new Map(waitRows.map((c) => [String(c._id), c.waitlistCount]));
    const formalMap = new Map(formalRows.map((c) => [String(c._id), c.formalCount]));
    return arr.map((e) => {
        const eid = String(e._id);
        const formal = formalMap.get(eid) || 0;
        if (typeof e.set === 'function') {
            e.set('registeredCount', formal);
        } else {
            e.registeredCount = formal;
        }
        const plain = typeof e.toObject === 'function' ? e.toObject({ virtuals: true }) : { ...e };
        plain.registeredCount = formal;
        plain.waitlistCount = waitMap.get(eid) || 0;
        return plain;
    });
}

async function recalculateRegisteredCount(eventId) {
    const count = await EventRegistration.countDocuments({
        event: eventId,
        status: { $in: ['registered', 'confirmed', 'pending_approval'] }
    });
    await Event.updateOne({ _id: eventId }, { $set: { registeredCount: count } });
    return count;
}

function isRegistrationOpen(event) {
    const now = new Date();
    const statusOpen = ['registration_open', 'published'].includes(event.status);
    const startOk = !event.registrationStartAt || new Date(event.registrationStartAt) <= now;
    const endOk = !event.registrationEndAt || new Date(event.registrationEndAt) >= now;
    return statusOpen && startOk && endOk;
}

function determineTicketTypeAndAmount(event) {
    const isFree = event?.registrationMode !== 'paid' || event?.price?.isFree !== false;
    if (isFree) {
        return { ticketType: 'free', amountDue: 0, currency: event?.price?.currency || 'TWD' };
    }
    const amount = Number(event?.price?.amount || 0);
    return {
        ticketType: 'regular',
        amountDue: amount,
        currency: event?.price?.currency || 'TWD'
    };
}

async function createMemberRegistration({ event, user, participantName, participantEmail, participantPhone, organization, title }) {
    const emailNorm = EventRegistration.normalizeEmail(participantEmail || user?.email);
    if (!emailNorm) {
        throw httpError(400, 'Participant email is required');
    }
    if (!participantName || !String(participantName).trim()) {
        throw httpError(400, 'Participant name is required');
    }

    if (!isRegistrationOpen(event)) {
        throw httpError(400, 'Event registration is not open');
    }

    const dup = await EventRegistration.findOne({ event: event._id, participantEmail: emailNorm });
    if (dup) {
        throw httpError(409, '您已報名過此活動');
    }

    const { ticketType, amountDue, currency } = determineTicketTypeAndAmount(event);
    const isPaid = event.registrationMode === 'paid' && event.paymentMode === 'manual_bank_transfer';
    const maxWaitlist = Number(event.waitlistCapacity || 0);
    const currentWaitlistCount = await EventRegistration.countDocuments({ event: event._id, status: 'waitlisted' });

    let status = 'registered';
    if (event.registrationMode === 'approval_required') {
        status = 'pending_approval';
    } else if (event.capacity && event.registeredCount >= event.capacity) {
        if (maxWaitlist > currentWaitlistCount) {
            status = 'waitlisted';
        } else {
            throw httpError(400, '名額已滿，候補名單也已滿');
        }
    }

    const waitlistPosition =
        status === 'waitlisted'
            ? currentWaitlistCount + 1
            : undefined;

    const registration = await EventRegistration.create({
        event: event._id,
        user: user?._id || null,
        participantName: String(participantName).trim(),
        participantEmail: emailNorm,
        participantPhone: participantPhone ? String(participantPhone).trim() : '',
        organization: organization ? String(organization).trim() : '',
        title: title ? String(title).trim() : '',
        status,
        waitlistPosition,
        paymentStatus: isPaid ? 'payment_pending' : 'none',
        attendanceStatus: 'not_checked_in',
        ticketType,
        amountDue,
        currency
    });

    await recalculateRegisteredCount(event._id);
    return registration;
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

    const reg = await EventRegistration.findOne({ event: event._id, participantEmail: emailNorm });
    if (!reg) {
        throw httpError(404, '找不到此 Email 的報名紀錄');
    }

    const regStatus = normalizeLegacyStatus(reg.status);
    if (regStatus === 'waitlisted') {
        reg.status = 'cancelled';
        reg.cancelledAt = new Date();
        reg.waitlistPosition = undefined;
        await reg.save();
        await recalculateRegisteredCount(event._id);
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

    reg.status = 'cancelled';
    reg.cancelledAt = new Date();
    await reg.save();
    await recalculateRegisteredCount(event._id);

    // TODO(EventOps-MVP): 暫不自動遞補 waitlist，Phase 2 再加入自動遞補與通知。

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
    ACTIVE_REGISTRATION_STATUSES,
    ACTIVE_PAYMENT_STATUSES,
    normalizeLegacyStatus,
    normalizeLegacyPaymentStatus,
    recalculateRegisteredCount,
    isRegistrationOpen,
    determineTicketTypeAndAmount,
    createMemberRegistration,
    enrichEventsWithWaitlistCounts,
    cancelEventRegistration,
    httpError
};
