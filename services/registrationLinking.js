const EventRegistration = require('../models/EventRegistration');

async function linkUnclaimedRegistrationsToUser(user) {
    if (!user || !user._id || !user.email || !user.emailVerified) {
        return { matched: 0, linked: 0 };
    }

    const emailNorm = EventRegistration.normalizeEmail(user.email);
    const query = {
        participantEmail: emailNorm,
        $or: [{ user: null }, { user: { $exists: false } }]
    };
    const matched = await EventRegistration.countDocuments(query);
    if (matched === 0) {
        return { matched: 0, linked: 0 };
    }

    const result = await EventRegistration.updateMany(query, { $set: { user: user._id } });
    return { matched, linked: result.modifiedCount || 0 };
}

module.exports = {
    linkUnclaimedRegistrationsToUser
};
