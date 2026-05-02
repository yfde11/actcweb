/**
 * D5 Migration: Backfill examIds from exam for manually authored questions.
 * Safe to run multiple times — uses aggregation pipeline update.
 *
 * Run: node scripts/migrate-d5-examIds.js
 * Rollback: mongorestore from pre-migration dump
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/actc_website', { family: 4 });
    console.log('Connected to MongoDB');

    const questions = mongoose.connection.db.collection('questions');

    const scopeCount = await questions.countDocuments({
        exam: { $exists: true, $ne: null },
        $or: [{ examIds: { $exists: false } }, { examIds: { $size: 0 } }]
    });
    console.log(`Documents to migrate: ${scopeCount}`);

    if (scopeCount === 0) {
        console.log('Nothing to migrate.');
        await mongoose.disconnect();
        return;
    }

    const result = await questions.updateMany(
        { exam: { $exists: true, $ne: null }, $or: [{ examIds: { $exists: false } }, { examIds: { $size: 0 } }] },
        [{ $set: { examIds: ['$exam'] } }]
    );

    console.log(`Modified: ${result.modifiedCount}`);
    if (result.modifiedCount !== scopeCount) {
        console.error('ERROR: count mismatch — inspect before continuing');
        process.exit(1);
    }
    console.log('Migration complete.');
    await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
