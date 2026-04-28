const mongoose = require('mongoose');
const EventRegistration = require('../models/EventRegistration');

async function run() {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/actc_website';
    await mongoose.connect(mongoUri);

    const collection = EventRegistration.collection;
    const indexes = await collection.indexes();
    const hasLegacy = indexes.some((idx) => idx.name === 'event_1_email_1');
    if (hasLegacy) {
        await collection.dropIndex('event_1_email_1');
        console.log('Dropped legacy unique index: event_1_email_1');
    }

    const hasOldParticipantEmailUnique = indexes.some(
        (idx) =>
            idx.name === 'event_1_participantEmail_1' &&
            idx.unique === true &&
            !idx.partialFilterExpression
    );
    if (hasOldParticipantEmailUnique) {
        await collection.dropIndex('event_1_participantEmail_1');
        console.log('Dropped outdated unique index: event_1_participantEmail_1');
    }

    const activeStatuses = Array.isArray(EventRegistration.ACTIVE_DUPLICATE_BLOCK_STATUSES)
        ? EventRegistration.ACTIVE_DUPLICATE_BLOCK_STATUSES
        : ['registered', 'waitlisted', 'pending_approval', 'confirmed', 'waitlist'];

    await collection.createIndex(
        { event: 1, participantEmail: 1 },
        {
            name: 'event_1_participantEmail_1',
            unique: true,
            partialFilterExpression: {
                participantEmail: { $type: 'string' },
                status: { $in: activeStatuses }
            }
        }
    );
    console.log('Ensured active-only unique index: event_1_participantEmail_1');
}

run()
    .then(() => mongoose.disconnect())
    .then(() => {
        console.log('Done');
        process.exit(0);
    })
    .catch(async (error) => {
        console.error(error);
        try {
            await mongoose.disconnect();
        } catch (e) {
            // ignore disconnect errors
        }
        process.exit(1);
    });
