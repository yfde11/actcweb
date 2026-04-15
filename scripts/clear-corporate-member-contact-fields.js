/**
 * 一次性遷移：自 CorporateMember 集合移除聯絡相關欄位（舊資料一併清除）。
 * 欄位：contactPerson, contactTitle, email, phone
 * 另移除可能殘留於文件中的 membershipLevel（已自 schema 刪除）。
 *
 * 使用方式（專案根目錄，需可連線 MongoDB）：
 *   node scripts/clear-corporate-member-contact-fields.js
 *
 * 連線：讀取 .env 的 MONGO_URI（同 server.js）。
 */

require('dotenv').config();
const mongoose = require('mongoose');
const CorporateMember = require('../models/CorporateMember');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/actc_website';

async function main() {
    await mongoose.connect(MONGO_URI, {
        serverSelectionTimeoutMS: parseInt(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || '10000', 10)
    });

    const unsetDoc = {
        contactPerson: '',
        contactTitle: '',
        email: '',
        phone: '',
        membershipLevel: ''
    };

    const result = await CorporateMember.updateMany({}, { $unset: unsetDoc });

    console.log('CorporateMember 遷移完成');
    console.log('  matched:', result.matchedCount);
    console.log('  modified:', result.modifiedCount);

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
