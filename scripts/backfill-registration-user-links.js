const mongoose = require('mongoose');
const User = require('../models/User');
const { linkUnclaimedRegistrationsToUser } = require('../services/registrationLinking');

async function run() {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/actc_website';
    await mongoose.connect(mongoUri);

    const users = await User.find({ emailVerified: true, email: { $exists: true, $ne: '' } })
        .select('_id email emailVerified')
        .lean();

    let matched = 0;
    let linked = 0;
    for (const user of users) {
        // eslint-disable-next-line no-await-in-loop
        const result = await linkUnclaimedRegistrationsToUser(user);
        matched += result.matched;
        linked += result.linked;
    }

    console.log(`Backfill done. matched=${matched}, linked=${linked}`);
}

run()
    .then(() => mongoose.disconnect())
    .then(() => {
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
