const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const multer = require('multer');
const csv = require('csv-parser');
const stream = require('stream');
const Question = require('../models/Question');
const Exam = require('../models/Exam');
const { adminAuth } = require('../middleware/adminAuth');

const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

// GET /api/question-bank - List questions with filters and pagination
router.get('/', adminAuth, async (req, res) => {
    try {
        const { domain, search, type, difficulty, page = 1, limit = 20 } = req.query;
        
        const query = {};
        if (domain) query.domain = parseInt(domain);
        if (type) query.type = type;
        if (difficulty) query.difficulty = difficulty;
        if (search) {
            query.$or = [
                { content: { $regex: search, $options: 'i' } },
                { 'options.text': { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [questions, total] = await Promise.all([
            Question.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            Question.countDocuments(query)
        ]);

        res.json({
            data: questions,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('List questions error:', error);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '伺服器錯誤' } });
    }
});

// POST /api/question-bank - Create single question
router.post('/', adminAuth, async (req, res) => {
    try {
        const { type, domain, content, options, correctOptionIndex, correctBoolean, 
                correctAnswers, acceptableAnswers, points, difficulty, explanation } = req.body;

        if (!content || !type || !domain) {
            return res.status(400).json({ error: { code: 'MISSING_FIELDS', message: '缺少必要欄位' } });
        }

        const questionData = {
            type,
            domain: parseInt(domain),
            content,
            points: points || 1,
            difficulty: difficulty || 'medium',
            explanation
        };

        if (type === 'multiple_choice') {
            if (!options || options.length < 2) {
                return res.status(400).json({ error: { code: 'INVALID_OPTIONS', message: '單選題至少需要 2 個選項' } });
            }
            questionData.options = options.map((opt, idx) => ({
                text: opt.text,
                label: String.fromCharCode(65 + idx)
            }));
            questionData.correctOptionIndex = correctOptionIndex || 0;
        } else if (type === 'true_false') {
            questionData.correctBoolean = correctBoolean !== undefined ? correctBoolean : true;
        } else if (type === 'fill_in_blank') {
            questionData.correctAnswers = correctAnswers || [];
            questionData.acceptableAnswers = acceptableAnswers || [];
        }

        const question = new Question(questionData);
        await question.save();

        res.status(201).json({ data: question });
    } catch (error) {
        console.error('Create question error:', error);
        if (error.name === 'ValidationError') {
            return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '欄位驗證失敗' } });
        }
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '伺服器錯誤' } });
    }
});

// PUT /api/question-bank/:id - Update question
router.put('/:id', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: { code: 'INVALID_ID', message: '無效的題目 ID' } });
        }

        const question = await Question.findById(id);
        if (!question) {
            return res.status(404).json({ error: { code: 'QUESTION_NOT_FOUND', message: '題目不存在' } });
        }

        const { domain, content, options, correctOptionIndex, correctBoolean,
                correctAnswers, acceptableAnswers, points, difficulty, explanation } = req.body;

        if (domain !== undefined) question.domain = parseInt(domain);
        if (content) question.content = content;
        if (points !== undefined) question.points = points;
        if (difficulty) question.difficulty = difficulty;
        if (explanation !== undefined) question.explanation = explanation;

        if (question.type === 'multiple_choice' && options) {
            question.options = options.map((opt, idx) => ({
                text: opt.text,
                label: String.fromCharCode(65 + idx)
            }));
            if (correctOptionIndex !== undefined) {
                question.correctOptionIndex = correctOptionIndex;
            }
        } else if (question.type === 'true_false' && correctBoolean !== undefined) {
            question.correctBoolean = correctBoolean;
        } else if (question.type === 'fill_in_blank') {
            if (correctAnswers) question.correctAnswers = correctAnswers;
            if (acceptableAnswers) question.acceptableAnswers = acceptableAnswers;
        }

        await question.save();
        res.json({ data: question });
    } catch (error) {
        console.error('Update question error:', error);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '伺服器錯誤' } });
    }
});

// DELETE /api/question-bank/:id - Delete question
router.delete('/:id', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: { code: 'INVALID_ID', message: '無效的題目 ID' } });
        }

        const question = await Question.findById(id);
        if (!question) {
            return res.status(404).json({ error: { code: 'QUESTION_NOT_FOUND', message: '題目不存在' } });
        }

        // Remove from examIds
        if (question.examIds && question.examIds.length > 0) {
            await Exam.updateMany(
                { _id: { $in: question.examIds } },
                { $pull: { questionRefs: question._id } }
            );
        }

        await question.deleteOne();
        res.json({ message: '題目已刪除' });
    } catch (error) {
        console.error('Delete question error:', error);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '伺服器錯誤' } });
    }
});

// POST /api/question-bank/import - Bulk import from CSV
router.post('/import', adminAuth, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: { code: 'NO_FILE', message: '請上傳 CSV 檔案' } });
        }

        const results = { imported: 0, errors: [] };
        const questions = [];

        // Parse CSV from buffer
        const bufferStream = new stream.PassThrough();
        bufferStream.end(req.file.buffer);

        await new Promise((resolve, reject) => {
            bufferStream
                .pipe(csv())
                .on('data', (row) => questions.push(row))
                .on('end', resolve)
                .on('error', reject);
        });

        for (const [index, q] of questions.entries()) {
            try {
                const questionData = {
                    type: q.type || 'multiple_choice',
                    domain: parseInt(q.domain),
                    content: q.content,
                    points: q.points || 1,
                    difficulty: q.difficulty || 'medium',
                    explanation: q.explanation || ''
                };

                if (!questionData.domain || isNaN(questionData.domain)) {
                    throw new Error('Invalid or missing domain');
                }

                // Convert A/B/C/D labels to indices
                if (q.correctOption) {
                    questionData.correctOptionIndex = q.correctOption.charCodeAt(0) - 65;
                }

                if (q.type === 'multiple_choice' || !q.type) {
                    const options = [];
                    for (let i = 0; i < 4; i++) {
                        const label = String.fromCharCode(65 + i);
                        if (q[`option${label}`]) {
                            options.push({ text: q[`option${label}`], label });
                        }
                    }
                    if (options.length < 2) {
                        throw new Error('Multiple choice needs at least 2 options');
                    }
                    questionData.options = options;
                } else if (q.type === 'true_false') {
                    questionData.correctBoolean = q.correctBoolean === 'true' || q.correctBoolean === 'True';
                } else if (q.type === 'fill_in_blank') {
                    questionData.correctAnswers = q.correctAnswers ? q.correctAnswers.split(',').map(s => s.trim()) : [];
                }

                const question = new Question(questionData);
                await question.save();
                results.imported++;
            } catch (err) {
                results.errors.push({ row: index + 2, error: err.message }); // +2 for header and 0-index
            }
        }

        res.json({ data: results });
    } catch (error) {
        console.error('Import questions error:', error);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '伺服器錯誤' } });
    }
});

// GET /api/question-bank/statistics - Get question bank statistics
router.get('/statistics', adminAuth, async (req, res) => {
    try {
        const [typeStats, difficultyStats, domainStats, total] = await Promise.all([
            Question.aggregate([
                { $group: { _id: '$type', count: { $sum: 1 } } }
            ]),
            Question.aggregate([
                { $group: { _id: '$difficulty', count: { $sum: 1 } } }
            ]),
            Question.aggregate([
                { $group: { _id: '$domain', count: { $sum: 1 } } }
            ]),
            Question.countDocuments()
        ]);

        const result = {
            total,
            byType: typeStats.reduce((acc, item) => {
                acc[item._id] = item.count;
                return acc;
            }, {}),
            byDifficulty: difficultyStats.reduce((acc, item) => {
                acc[item._id] = item.count;
                return acc;
            }, {}),
            byDomain: domainStats.reduce((acc, item) => {
                if (item._id) acc[item._id] = item.count;
                return acc;
            }, {}),
            unused: await Question.countDocuments({ 
                $or: [{ examIds: { $exists: false } }, { examIds: { $size: 0 } }] 
            })
        };

        res.json({ data: result });
    } catch (error) {
        console.error('Get statistics error:', error);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '伺服器錯誤' } });
    }
});

module.exports = router;
