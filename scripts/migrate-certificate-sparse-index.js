/**
 * Migration: 將 Certificate.attempt 索引從舊的 unique index
 * 改為 sparse unique index（支援課程型證書，attempt 欄位可為 null）
 *
 * 執行方式：
 *   MONGO_URI=mongodb://... node scripts/migrate-certificate-sparse-index.js
 */

const mongoose = require('mongoose');

async function run() {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/actc_website';
    await mongoose.connect(mongoUri);

    const db = mongoose.connection.db;
    const collection = db.collection('certificates');

    // 列出現有索引
    const indexes = await collection.indexes();
    console.log('現有索引：', indexes.map(i => ({ name: i.name, key: i.key, unique: i.unique, sparse: i.sparse })));

    // 嘗試刪除舊的 attempt 相關 unique index（非 sparse）
    const oldIndexName = indexes.find(i => {
        return i.key && i.key.attempt === 1 && i.unique === true && !i.sparse;
    });

    if (oldIndexName) {
        console.log(`刪除舊索引：${oldIndexName.name}`);
        await collection.dropIndex(oldIndexName.name);
        console.log('舊索引已刪除');
    } else {
        console.log('未找到舊的 attempt unique index，跳過刪除步驟');
    }

    // 建立新的 sparse unique index
    const existingSparse = indexes.find(i => {
        return i.key && i.key.attempt === 1 && i.unique === true && i.sparse === true;
    });

    if (!existingSparse) {
        console.log('建立新的 sparse unique index on attempt...');
        await collection.createIndex({ attempt: 1 }, { unique: true, sparse: true, name: 'attempt_1_sparse' });
        console.log('新索引已建立：attempt_1_sparse (unique, sparse)');
    } else {
        console.log('Sparse unique index 已存在，跳過建立步驟');
    }

    // 確認最終索引狀態
    const finalIndexes = await collection.indexes();
    console.log('最終索引：', finalIndexes.map(i => ({ name: i.name, key: i.key, unique: i.unique, sparse: i.sparse })));
    console.log('Migration 完成。');
}

run()
    .then(() => mongoose.disconnect())
    .then(() => {
        process.exit(0);
    })
    .catch(async (error) => {
        console.error('Migration 失敗：', error);
        try {
            await mongoose.disconnect();
        } catch (e) {
            // ignore disconnect errors
        }
        process.exit(1);
    });
