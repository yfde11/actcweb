const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const csv = require('csv-parser');
const stream = require('stream');
const Exam = require('../models/Exam');
const Question = require('../models/Question');
const ExamAttempt = require('../models/ExamAttempt');
const Certificate = require('../models/Certificate');
const User = require('../models/User');
const { adminAuth } = require('../middleware/adminAuth');

const router = express.Router();

const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

// Error response helper
function errorResponse(res, statusCode, code, message, details = {}) {
    return res.status(statusCode).json({
        error: { code, message, details }
    });
}

// GET /api/exams - list exams with pagination and filters
router.get('/', adminAuth, async (req, res) => {
    try {
        const { page = 1, limit = 20, status, search } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const query = {};

        if (status) query.status = status;
        if (search) {
            query.$or = [
                { title: new RegExp(search, 'i') },
                { description: new RegExp(search, 'i') }
            ];
        }

        const [exams, total] = await Promise.all([
            Exam.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .populate('createdBy', 'username fullName'),
            Exam.countDocuments(query)
        ]);

        res.json({
            data: exams,
            pagination: {
                total,
                totalPages: Math.ceil(total / parseInt(limit)),
                page: parseInt(page),
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('List exams error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// POST /api/exams - create exam
router.post('/', adminAuth, async (req, res) => {
    try {
        const examData = {
            ...req.body,
            createdBy: req.user.userId
        };

        const exam = new Exam(examData);
        await exam.save();

        res.status(201).json({ data: exam });
    } catch (error) {
        console.error('Create exam error:', error);
        if (error.name === 'ValidationError') {
            const details = {};
            for (let field in error.errors) {
                details[field] = error.errors[field].message;
            }
            return errorResponse(res, 400, 'VALIDATION_ERROR', '欄位驗證失敗', details);
        }
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// GET /api/exams/:id - exam details with questions
router.get('/:id', adminAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的考試 ID');
        }

        const exam = await Exam.findById(req.params.id).populate('createdBy', 'username fullName');
        if (!exam) {
            return errorResponse(res, 404, 'EXAM_NOT_FOUND', '考試不存在');
        }

        const questions = await Question.find({ exam: exam._id }).sort({ questionNumber: 1 });

        res.json({ data: { ...exam.toObject(), questions } });
    } catch (error) {
        console.error('Get exam error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// PUT /api/exams/:id - update exam
router.put('/:id', adminAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的考試 ID');
        }

        const exam = await Exam.findById(req.params.id);
        if (!exam) {
            return errorResponse(res, 404, 'EXAM_NOT_FOUND', '考試不存在');
        }

        if (exam.status !== 'draft') {
            return errorResponse(res, 400, 'STATUS_TRANSITION_INVALID', '只能編輯草稿狀態的考試');
        }

        Object.assign(exam, req.body);
        await exam.save();

        res.json({ data: exam });
    } catch (error) {
        console.error('Update exam error:', error);
        if (error.name === 'ValidationError') {
            const details = {};
            for (let field in error.errors) {
                details[field] = error.errors[field].message;
            }
            return errorResponse(res, 400, 'VALIDATION_ERROR', '欄位驗證失敗', details);
        }
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// DELETE /api/exams/:id - delete exam (cascade)
router.delete('/:id', adminAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的考試 ID');
        }

        const exam = await Exam.findById(req.params.id);
        if (!exam) {
            return errorResponse(res, 404, 'EXAM_NOT_FOUND', '考試不存在');
        }

        // Cascade delete: questions, attempts, certificates
        await Promise.all([
            Question.deleteMany({ exam: exam._id }),
            ExamAttempt.deleteMany({ exam: exam._id }),
            Certificate.deleteMany({ exam: exam._id })
        ]);

        await exam.deleteOne();

        res.json({ message: '考試已刪除' });
    } catch (error) {
        console.error('Delete exam error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// PATCH /api/exams/:id/status - change status with validation
router.patch('/:id/status', adminAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的考試 ID');
        }

        const { status: newStatus } = req.body;
        if (!newStatus) {
            return errorResponse(res, 400, 'VALIDATION_ERROR', '缺少 status 欄位');
        }

        const exam = await Exam.findById(req.params.id);
        if (!exam) {
            return errorResponse(res, 404, 'EXAM_NOT_FOUND', '考試不存在');
        }

        const validTransitions = {
            draft: ['published', 'deleted'],
            published: ['active', 'draft', 'deleted'],
            active: ['closed', 'deleted'],
            closed: ['archived', 'deleted'],
            archived: ['deleted'],
            deleted: []
        };

        if (!validTransitions[exam.status]?.includes(newStatus)) {
            return errorResponse(res, 400, 'STATUS_TRANSITION_INVALID', 
                `無法從 ${exam.status} 轉換到 ${newStatus}`);
        }

        // Validate transition conditions
        if (newStatus === 'published' && exam.questionCount < 1) {
            return errorResponse(res, 400, 'VALIDATION_ERROR', '發布前至少需要 1 題');
        }

        if (newStatus === 'active' && exam.startDate && new Date() < exam.startDate) {
            return errorResponse(res, 400, 'VALIDATION_ERROR', '尚未到開始時間');
        }

        exam.status = newStatus;
        await exam.save();

        res.json({ data: exam });
    } catch (error) {
        console.error('Change status error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// GET /api/exams/:id/questions - list questions with pagination
router.get('/:id/questions', adminAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的考試 ID');
        }

        const { page = 1, limit = 50 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [questions, total] = await Promise.all([
            Question.find({ exam: req.params.id })
                .sort({ questionNumber: 1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Question.countDocuments({ exam: req.params.id })
        ]);

        res.json({
            data: questions,
            pagination: {
                total,
                totalPages: Math.ceil(total / parseInt(limit)),
                page: parseInt(page),
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('List questions error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// POST /api/exams/:id/questions - add question
router.post('/:id/questions', adminAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的考試 ID');
        }

        const exam = await Exam.findById(req.params.id);
        if (!exam) {
            return errorResponse(res, 404, 'EXAM_NOT_FOUND', '考試不存在');
        }

        if (exam.status !== 'draft') {
            return errorResponse(res, 400, 'STATUS_TRANSITION_INVALID', '只能為草稿考試新增題目');
        }

        const questionData = {
            ...req.body,
            exam: exam._id
        };

        const question = new Question(questionData);
        await question.save();

        // Update exam questionCount and totalPoints
        const questions = await Question.find({ exam: exam._id });
        exam.questionCount = questions.length;
        exam.totalPoints = questions.reduce((sum, q) => sum + q.points, 0);
        await exam.save();

        res.status(201).json({ data: question });
    } catch (error) {
        console.error('Add question error:', error);
        if (error.name === 'ValidationError') {
            const details = {};
            for (let field in error.errors) {
                details[field] = error.errors[field].message;
            }
            return errorResponse(res, 400, 'VALIDATION_ERROR', '欄位驗證失敗', details);
        }
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// DELETE /api/exams/:id/questions/:qid - delete question
router.delete('/:id/questions/:qid', adminAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id) || 
            !mongoose.Types.ObjectId.isValid(req.params.qid)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的 ID');
        }

        const exam = await Exam.findById(req.params.id);
        if (!exam) {
            return errorResponse(res, 404, 'EXAM_NOT_FOUND', '考試不存在');
        }

        const question = await Question.findOne({ 
            _id: req.params.qid, 
            exam: exam._id 
        });
        if (!question) {
            return errorResponse(res, 404, 'QUESTION_NOT_FOUND', '題目不存在');
        }

        await question.deleteOne();

        // Update exam questionCount and totalPoints
        const questions = await Question.find({ exam: exam._id });
        exam.questionCount = questions.length;
        exam.totalPoints = questions.reduce((sum, q) => sum + q.points, 0);
        await exam.save();

        res.json({ message: '題目已刪除' });
    } catch (error) {
        console.error('Delete question error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// GET /api/exams/:id/attempts - list attempts with cursor-based pagination
router.get('/:id/attempts', adminAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的考試 ID');
        }

        const { limit = 20, cursor } = req.query;
        const query = { exam: req.params.id };

        if (cursor) {
            const [startedAt, id] = cursor.split('|');
            query.$or = [
                { startedAt: { $lt: new Date(startedAt) } },
                { startedAt, _id: { $lt: id } }
            ];
        }

        const attempts = await ExamAttempt.find(query)
            .sort({ startedAt: -1, _id: -1 })
            .limit(parseInt(limit) + 1)
            .populate('user', 'username fullName email');

        const hasMore = attempts.length > parseInt(limit);
        if (hasMore) attempts.pop();

        const nextCursor = hasMore ? 
            `${attempts[attempts.length - 1].startedAt.toISOString()}|${attempts[attempts.length - 1]._id}` : 
            null;

        res.json({
            data: attempts,
            pagination: { hasMore, nextCursor }
        });
    } catch (error) {
        console.error('List attempts error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// GET /api/exams/:id/statistics - exam statistics
router.get('/:id/statistics', adminAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的考試 ID');
        }

        const exam = await Exam.findById(req.params.id);
        if (!exam) {
            return errorResponse(res, 404, 'EXAM_NOT_FOUND', '考試不存在');
        }

        // Exclude cheating attempts from statistics
        const attempts = await ExamAttempt.find({
            exam: exam._id,
            status: 'graded',
            cheatingDetected: { $ne: true }
        });

        const totalAttempts = attempts.length;
        const passedAttempts = attempts.filter(a => a.passed).length;
        const averageScore = totalAttempts > 0 ?
            attempts.reduce((sum, a) => sum + a.score, 0) / totalAttempts : 0;

        // Per-question statistics
        const questions = await Question.find({ exam: exam._id });
        const questionStats = [];

        for (const question of questions) {
            const questionAttempts = attempts.filter(a => 
                a.questionSnapshot.some(q => q.questionId.toString() === question._id.toString())
            );

            const correctCount = questionAttempts.filter(a => {
                const answer = a.answers.find(ans => 
                    ans.questionId.toString() === question._id.toString()
                );
                return answer && answer.isCorrect;
            }).length;

            questionStats.push({
                questionId: question._id,
                questionNumber: question.questionNumber,
                type: question.type,
                difficulty: question.difficulty,
                totalAnswers: questionAttempts.length,
                correctCount,
                correctRate: questionAttempts.length > 0 ? 
                    (correctCount / questionAttempts.length * 100) : 0
            });
        }

        res.json({
            data: {
                totalAttempts,
                passedAttempts,
                passRate: totalAttempts > 0 ? (passedAttempts / totalAttempts * 100) : 0,
                averageScore,
                questionStats
            }
        });
    } catch (error) {
        console.error('Get statistics error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// POST /api/exams/:id/questions/bulk - bulk import questions (CSV or JSON)
router.post('/:id/questions/bulk', adminAuth, upload.single('file'), async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的考試 ID');
        }

        const exam = await Exam.findById(req.params.id).session(session);
        if (!exam) {
            return errorResponse(res, 404, 'EXAM_NOT_FOUND', '考試不存在');
        }

        if (exam.status !== 'draft') {
            return errorResponse(res, 400, 'STATUS_TRANSITION_INVALID', '只能為草稿考試匯入題目');
        }

        let questionsData = [];
        const errors = [];

        if (req.file) {
            const contentType = req.file.mimetype || '';
            const isCSV = contentType.includes('csv') || 
                         req.file.originalname?.endsWith('.csv');

            if (isCSV) {
                questionsData = await parseCSVQuestions(req.file.buffer, errors);
            } else {
                try {
                    const jsonStr = req.file.buffer.toString('utf8');
                    questionsData = JSON.parse(jsonStr);
                } catch (e) {
                    return errorResponse(res, 400, 'INVALID_FORMAT', '無效的 JSON 格式');
                }
            }
        } else if (req.body.questions) {
            try {
                questionsData = typeof req.body.questions === 'string' 
                    ? JSON.parse(req.body.questions) 
                    : req.body.questions;
            } catch (e) {
                return errorResponse(res, 400, 'INVALID_FORMAT', '無效的 JSON 格式');
            }
        } else {
            return errorResponse(res, 400, 'NO_DATA', '未提供題目資料');
        }

        if (!Array.isArray(questionsData) || questionsData.length === 0) {
            return errorResponse(res, 400, 'INVALID_DATA', '題目資料必須是非空陣列');
        }

        const results = { success: 0, failed: 0, errors: [] };
        const validQuestions = [];

        for (let i = 0; i < questionsData.length; i++) {
            const q = questionsData[i];
            const rowNum = i + 1;
            const validationErrors = validateQuestion(q, rowNum);

            if (validationErrors.length > 0) {
                results.failed++;
                results.errors.push({ row: rowNum, errors: validationErrors });
                continue;
            }

            try {
                const questionData = buildQuestionData(q, exam._id);
                validQuestions.push(questionData);
                results.success++;
            } catch (e) {
                results.failed++;
                results.errors.push({ row: rowNum, errors: [e.message] });
            }
        }

        if (validQuestions.length > 0) {
            try {
                await Question.insertMany(validQuestions, { session });
                
                const questions = await Question.find({ exam: exam._id }).session(session);
                exam.questionCount = questions.length;
                exam.totalPoints = questions.reduce((sum, q) => sum + q.points, 0);
                await exam.save({ session });
            } catch (e) {
                await session.abortTransaction();
                session.endSession();
                return errorResponse(res, 500, 'BULK_INSERT_FAILED', '批次匯入失敗', { message: e.message });
            }
        }

        await session.commitTransaction();
        session.endSession();

        res.json({ data: results });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error('Bulk import error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// GET /api/exams/:id/export-attempts - export exam attempts as CSV
router.get('/:id/export-attempts', adminAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的考試 ID');
        }

        const exam = await Exam.findById(req.params.id);
        if (!exam) {
            return errorResponse(res, 404, 'EXAM_NOT_FOUND', '考試不存在');
        }

        const { cursor, limit = 1000 } = req.query;
        const query = { 
            exam: req.params.id,
            cheatingDetected: { $ne: true }
        };

        if (cursor) {
            const [startedAt, id] = cursor.split('|');
            query.$or = [
                { startedAt: { $lt: new Date(startedAt) } },
                { startedAt, _id: { $lt: id } }
            ];
        }

        const attempts = await ExamAttempt.find(query)
            .sort({ startedAt: -1, _id: -1 })
            .limit(parseInt(limit) + 1)
            .populate('user', 'username email fullName');

        const hasMore = attempts.length > parseInt(limit);
        if (hasMore) attempts.pop();

        const csvRows = [];
        csvRows.push('User,Email,Attempt,Status,Score,Passed,Time Spent,Cheating Detected,Submitted At');

        for (const attempt of attempts) {
            const user = attempt.user || {};
            const row = [
                escapeCSVField(user.username || 'N/A'),
                escapeCSVField(user.email || 'N/A'),
                attempt.attemptNumber,
                attempt.status,
                attempt.score !== undefined ? attempt.score : '',
                attempt.passed !== undefined ? attempt.passed : '',
                attempt.timeSpent !== undefined ? attempt.timeSpent : '',
                attempt.cheatingDetected || false,
                attempt.submittedAt ? formatDate(attempt.submittedAt) : ''
            ];
            csvRows.push(row.join(','));
        }

        const csvContent = csvRows.join('\n');
        const filename = `exam-attempts-${exam._id}.csv`;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csvContent);
    } catch (error) {
        console.error('Export attempts error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// Helper: Check for CSV injection
function checkCSVInjection(value) {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    return ['=', '+', '-', '@'].some(prefix => trimmed.startsWith(prefix));
}

// Helper: Convert label to index (A->0, B->1, etc.)
function labelToIndex(label) {
    if (typeof label !== 'string') return -1;
    const upper = label.toUpperCase().trim();
    if (upper >= 'A' && upper <= 'Z') {
        return upper.charCodeAt(0) - 'A'.charCodeAt(0);
    }
    const num = parseInt(label);
    if (!isNaN(num) && num >= 0) return num;
    return -1;
}

// Helper: Parse CSV questions
function parseCSVQuestions(buffer, errors) {
    return new Promise((resolve, reject) => {
        const results = [];
        const readable = new stream.Readable();
        readable._read = () => {};
        readable.push(buffer);
        readable.push(null);

        readable
            .pipe(csv())
            .on('data', (row, index) => {
                const rowNum = index + 2;
                
                Object.keys(row).forEach(key => {
                    if (checkCSVInjection(row[key])) {
                        errors.push({ row: rowNum, message: `CSV 注入風險: 欄位 ${key} 以危險字元開頭` });
                    }
                });

                const question = {
                    type: row.type?.trim(),
                    difficulty: row.difficulty?.trim() || 'medium',
                    content: row.content?.trim(),
                    points: parseInt(row.points) || 1,
                    explanation: row.explanation?.trim()
                };

                if (question.type === 'multiple_choice') {
                    const options = [];
                    ['optionA', 'optionB', 'optionC', 'optionD'].forEach((key, idx) => {
                        if (row[key]) {
                            options.push({ text: row[key].trim(), label: String.fromCharCode(65 + idx) });
                        }
                    });
                    question.options = options;
                    
                    if (row.correctOptionIndex) {
                        const idx = labelToIndex(row.correctOptionIndex);
                        if (idx >= 0) question.correctOptionIndex = idx;
                    }
                } else if (question.type === 'true_false') {
                    if (row.correctBoolean !== undefined) {
                        const val = row.correctBoolean?.toString().toLowerCase().trim();
                        question.correctBoolean = val === 'true' || val === '1';
                    }
                } else if (question.type === 'fill_in_blank') {
                    if (row.correctAnswers) {
                        question.correctAnswers = row.correctAnswers.split(',').map(a => a.trim()).filter(Boolean);
                    }
                    if (row.acceptableAnswers) {
                        question.acceptableAnswers = row.acceptableAnswers.split(',').map(a => a.trim().toLowerCase()).filter(Boolean);
                    }
                }

                results.push(question);
            })
            .on('end', () => resolve(results))
            .on('error', reject);
    });
}

// Helper: Validate question data
function validateQuestion(q, rowNum) {
    const errors = [];
    const validTypes = ['multiple_choice', 'true_false', 'fill_in_blank'];
    const validDifficulties = ['easy', 'medium', 'hard'];

    if (!q.type || !validTypes.includes(q.type)) {
        errors.push(`無效的題目類型: ${q.type}`);
    }

    if (q.difficulty && !validDifficulties.includes(q.difficulty)) {
        errors.push(`無效的難度: ${q.difficulty}`);
    }

    if (!q.content) {
        errors.push('題目內容不能為空');
    }

    if (q.type === 'multiple_choice') {
        if (!q.options || !Array.isArray(q.options) || q.options.length < 2) {
            errors.push('選擇題至少需要 2 個選項');
        }
        if (q.correctOptionIndex === undefined && q.correctOptionIndex !== 0 && !q.correctAnswers) {
            errors.push('選擇題必須指定正確答案');
        }
    } else if (q.type === 'true_false') {
        if (q.correctBoolean === undefined && !q.correctAnswers) {
            errors.push('是非題必須指定正確答案');
        }
    } else if (q.type === 'fill_in_blank') {
        if (!q.correctAnswers || !Array.isArray(q.correctAnswers) || q.correctAnswers.length === 0) {
            errors.push('填空題必須指定正確答案');
        }
    }

    if (q.points && (q.points < 1 || q.points > 100)) {
        errors.push('分數必須在 1-100 之間');
    }

    return errors;
}

// Helper: Build question data for database
function buildQuestionData(q, examId) {
    const questionData = {
        exam: examId,
        type: q.type,
        difficulty: q.difficulty || 'medium',
        content: q.content,
        points: q.points || 1
    };

    if (q.type === 'multiple_choice') {
        if (q.options) {
            questionData.options = q.options.map((opt, idx) => ({
                text: opt.text,
                label: opt.label || String.fromCharCode(65 + idx)
            }));
        }
        if (q.correctOptionIndex !== undefined) {
            questionData.correctOptionIndex = q.correctOptionIndex;
        }
    } else if (q.type === 'true_false') {
        if (q.correctBoolean !== undefined) {
            questionData.correctBoolean = q.correctBoolean;
        }
    } else if (q.type === 'fill_in_blank') {
        if (q.correctAnswers) {
            questionData.correctAnswers = Array.isArray(q.correctAnswers) ? q.correctAnswers : [q.correctAnswers];
        }
        if (q.acceptableAnswers) {
            questionData.acceptableAnswers = Array.isArray(q.acceptableAnswers) 
                ? q.acceptableAnswers.map(a => a.toLowerCase().trim())
                : [q.acceptableAnswers.toLowerCase().trim()];
        }
    }

    if (q.explanation) questionData.explanation = q.explanation;

    return questionData;
}

// Helper: Escape CSV field
function escapeCSVField(field) {
    if (field === null || field === undefined) return '';
    const str = String(field);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

// Helper: Format date for CSV
function formatDate(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

module.exports = router;
