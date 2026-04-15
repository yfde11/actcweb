/**
 * 手動執行：將協力企業會員（全智網、酪梨智慧）寫入資料庫（與啟動時 bootstrap 邏輯相同）。
 *   node scripts/seed-partner-corporate-members.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { ensurePartnerCorporateMembers } = require('../lib/bootstrapDb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/actc_website';

async function main() {
    await mongoose.connect(MONGO_URI, {
        serverSelectionTimeoutMS: parseInt(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || '10000', 10)
    });
    await ensurePartnerCorporateMembers();
    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
