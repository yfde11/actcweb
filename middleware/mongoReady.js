const mongoose = require('mongoose');

const DB_UNAVAILABLE =
    '無法連線至資料庫。請確認 MongoDB 已啟動（本機可執行 brew services start mongodb-community 或 mongod），然後再試一次。';

/**
 * 所有 /api 請求需先連上 MongoDB，否則回 503 與明確訊息。
 */
function ensureMongo(req, res, next) {
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ message: DB_UNAVAILABLE });
    }
    next();
}

module.exports = { ensureMongo, DB_UNAVAILABLE };
