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
const { generateExamFromBank, generateExamManual } = require('../services/examGeneration');
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
        const { page = 1, status, search } = req.query;
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const skip = (parseInt(page) - 1) * limit;
        const query = {};

        if (status) query.status = status;
        if (search) {
            if (search.length > 100) {
                return res.json({
                    data: [],
                    pagination: { total: 0, totalPages: 0, page: parseInt(page), limit }
                });
            }
            const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const searchRegex = new RegExp(escapeRegex(search), 'i');
            query.$or = [
                { title: searchRegex },
                { description: searchRegex }
            ];
        }

        const [exams, total] = await Promise.all([
            Exam.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate('createdBy', 'username fullName'),
            Exam.countDocuments(query)
        ]);

        res.json({
            data: exams,
            pagination: {
                total,
                totalPages: Math.ceil(total / limit),
                page: parseInt(page),
                limit
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
        // Allowlist: only safe fields accepted from req.body
        const {
            title, description, shortDescription, examType, timeLimit, passingScore,
            maxAttempts, cooldownPeriod, questionsPerAttempt, difficultyRatio, domainRatio,
            startDate, endDate, shuffleQuestions, shuffleOptions, showCorrectAnswers,
            certificateEnabled, certificateTemplate, allowedMembers, allowedMemberIds, questionRefs,
            tags
        } = req.body;

        const examData = {
            title, description, shortDescription, examType, timeLimit, passingScore,
            maxAttempts, cooldownPeriod, questionsPerAttempt, difficultyRatio, domainRatio,
            startDate, endDate, shuffleQuestions, shuffleOptions, showCorrectAnswers,
            certificateEnabled, certificateTemplate, allowedMembers, allowedMemberIds, questionRefs,
            tags,
            createdBy: req.user.userId
        };

        // Remove undefined keys so Mongoose defaults apply properly
        Object.keys(examData).forEach(k => examData[k] === undefined && delete examData[k]);

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

        const questions = await Question.find({ examIds: exam._id }).sort({ questionNumber: 1 });

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

        // Allowlist: only safe fields accepted from req.body; createdBy/totalPoints/questionCount not allowed.
        // status is allowed here only for draft→published or draft→active transitions initiated from the edit form.
        const {
            title, description, shortDescription, examType, timeLimit, passingScore,
            maxAttempts, cooldownPeriod, questionsPerAttempt, difficultyRatio, domainRatio,
            startDate, endDate, shuffleQuestions, shuffleOptions, showCorrectAnswers,
            certificateEnabled, certificateTemplate, allowedMembers, allowedMemberIds, questionRefs,
            tags,
            status: requestedStatus
        } = req.body;

        const allowedUpdates = {
            title, description, shortDescription, examType, timeLimit, passingScore,
            maxAttempts, cooldownPeriod, questionsPerAttempt, difficultyRatio, domainRatio,
            startDate, endDate, shuffleQuestions, shuffleOptions, showCorrectAnswers,
            certificateEnabled, certificateTemplate, allowedMembers, allowedMemberIds, questionRefs,
            tags
        };

        // Remove undefined keys so existing values are not overwritten with undefined
        Object.keys(allowedUpdates).forEach(k => allowedUpdates[k] === undefined && delete allowedUpdates[k]);

        // Apply status transition if requested (draft → published, active, or deleted only)
        if (requestedStatus && requestedStatus !== exam.status) {
            const draftTransitions = ['published', 'active', 'deleted'];
            if (!draftTransitions.includes(requestedStatus)) {
                return errorResponse(res, 400, 'STATUS_TRANSITION_INVALID',
                    `草稿狀態只能轉換為 published、active 或 deleted，無法轉換為 ${requestedStatus}`);
            }
            // Applying the same attempt safeguard as the DELETE endpoint:
            // if there are graded results, do not allow deletion even via status transition.
            if (requestedStatus === 'deleted') {
                const gradedCount = await ExamAttempt.countDocuments({ exam: exam._id, status: 'graded' });
                if (gradedCount > 0) {
                    return errorResponse(res, 409, 'EXAM_HAS_RESULTS',
                        `此考試已有 ${gradedCount} 筆成績紀錄，無法刪除。請改用封存（archived）狀態。`);
                }
            }
            allowedUpdates.status = requestedStatus;
        }

        Object.assign(exam, allowedUpdates);
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

        const attemptCount = await ExamAttempt.countDocuments({ exam: exam._id, status: 'graded' });
        if (attemptCount > 0) {
            return res.status(409).json({
                error: {
                    code: 'EXAM_HAS_RESULTS',
                    message: `此考試已有 ${attemptCount} 筆成績紀錄，無法直接刪除。請改用封存（archived）狀態。`
                }
            });
        }

        // Cascade delete: questions, attempts, certificates
        await Promise.all([
            Question.deleteMany({ examIds: exam._id }),
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
            draft: ['published', 'active', 'deleted'],
            published: ['active', 'draft', 'archived', 'deleted'],
            active: ['closed', 'archived', 'deleted'],
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

        const { page = 1 } = req.query;
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const skip = (parseInt(page) - 1) * limit;

        const [questions, total] = await Promise.all([
            Question.find({ examIds: req.params.id })
                .sort({ questionNumber: 1 })
                .skip(skip)
                .limit(limit),
            Question.countDocuments({ examIds: req.params.id })
        ]);

        res.json({
            data: questions,
            pagination: {
                total,
                totalPages: Math.ceil(total / limit),
                page: parseInt(page),
                limit
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
            examIds: [exam._id]
        };

        const question = new Question(questionData);
        await question.save();

        // Update exam questionCount and totalPoints
        const questions = await Question.find({ examIds: exam._id });
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
            examIds: exam._id
        });
        if (!question) {
            return errorResponse(res, 404, 'QUESTION_NOT_FOUND', '題目不存在');
        }

        await question.deleteOne();

        // Update exam questionCount and totalPoints
        const questions = await Question.find({ examIds: exam._id });
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

        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const { cursor } = req.query;
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
            .limit(limit + 1)
            .populate('user', 'username fullName email');

        const hasMore = attempts.length > limit;
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

// GET /api/exams/:id/statistics - exam statistics (aggregation-based, no OOM risk)
router.get('/:id/statistics', adminAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的考試 ID');
        }

        const examId = new mongoose.Types.ObjectId(req.params.id);

        const exam = await Exam.findById(examId);
        if (!exam) {
            return errorResponse(res, 404, 'EXAM_NOT_FOUND', '考試不存在');
        }

        // --- Summary statistics via aggregation (no documents loaded into Node memory) ---
        const summaryPipeline = [
            {
                $match: {
                    exam: examId,
                    status: 'graded',
                    cheatingDetected: { $ne: true }
                }
            },
            {
                $facet: {
                    summary: [
                        {
                            $group: {
                                _id: null,
                                totalAttempts: { $sum: 1 },
                                passCount: {
                                    $sum: { $cond: [{ $eq: ['$passed', true] }, 1, 0] }
                                },
                                failCount: {
                                    $sum: { $cond: [{ $eq: ['$passed', false] }, 1, 0] }
                                },
                                averageScore: { $avg: '$score' },
                                highestScore: { $max: '$score' },
                                lowestScore: { $min: '$score' },
                                averageTimeSpent: { $avg: '$timeSpent' }
                            }
                        }
                    ],
                    scoreDistribution: [
                        {
                            $bucket: {
                                groupBy: '$score',
                                boundaries: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 101],
                                default: 'other',
                                output: { count: { $sum: 1 } }
                            }
                        }
                    ]
                }
            }
        ];

        // --- Per-question correctness statistics via aggregation ---
        // Unwind the answers array so each answer document becomes a separate pipeline stage row.
        // This avoids loading any attempt documents into Node.js memory.
        const questionStatsPipeline = [
            {
                $match: {
                    exam: examId,
                    status: 'graded',
                    cheatingDetected: { $ne: true }
                }
            },
            { $unwind: '$answers' },
            {
                $group: {
                    _id: '$answers.questionId',
                    totalAnswers: { $sum: 1 },
                    correctCount: {
                        $sum: { $cond: [{ $eq: ['$answers.isCorrect', true] }, 1, 0] }
                    }
                }
            },
            {
                $project: {
                    _id: 0,
                    questionId: '$_id',
                    totalAnswers: 1,
                    correctCount: 1,
                    correctRate: {
                        $cond: [
                            { $gt: ['$totalAnswers', 0] },
                            {
                                $multiply: [
                                    { $divide: ['$correctCount', '$totalAnswers'] },
                                    100
                                ]
                            },
                            0
                        ]
                    }
                }
            }
        ];

        // Run both aggregations in parallel
        const [facetResult, questionAggStats] = await Promise.all([
            ExamAttempt.aggregate(summaryPipeline),
            ExamAttempt.aggregate(questionStatsPipeline)
        ]);

        // Extract summary (facet returns an array with one element)
        const summaryArr = facetResult[0]?.summary || [];
        const summary = summaryArr[0] || {
            totalAttempts: 0,
            passCount: 0,
            failCount: 0,
            averageScore: 0,
            highestScore: null,
            lowestScore: null,
            averageTimeSpent: 0
        };

        const scoreDistribution = (facetResult[0]?.scoreDistribution || []).map(bucket => ({
            range: bucket._id === 'other'
                ? 'other'
                : `${bucket._id}-${Math.min(bucket._id + 9, 100)}`,
            count: bucket.count
        }));

        // Merge aggregated correctness stats with question metadata (question docs are small)
        const questions = await Question.find({ examIds: examId })
            .select('questionNumber type difficulty')
            .lean();

        const aggMap = {};
        questionAggStats.forEach(s => {
            aggMap[s.questionId.toString()] = s;
        });

        const questionStats = questions.map(q => {
            const agg = aggMap[q._id.toString()] || { totalAnswers: 0, correctCount: 0, correctRate: 0 };
            return {
                questionId: q._id,
                questionNumber: q.questionNumber,
                type: q.type,
                difficulty: q.difficulty,
                totalAnswers: agg.totalAnswers,
                correctCount: agg.correctCount,
                correctRate: agg.correctRate
            };
        });

        const { totalAttempts, passCount, failCount, averageScore,
                highestScore, lowestScore, averageTimeSpent } = summary;

        res.json({
            data: {
                totalAttempts,
                passedAttempts: passCount,
                failCount,
                passRate: totalAttempts > 0 ? (passCount / totalAttempts * 100) : 0,
                averageScore: averageScore || 0,
                highestScore,
                lowestScore,
                averageTimeSpent: averageTimeSpent || 0,
                scoreDistribution,
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
                
                const questions = await Question.find({ examIds: exam._id }).session(session);
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

        const exportLimit = Math.min(parseInt(req.query.limit) || 1000, 5000);
        const { cursor } = req.query;
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
            .limit(exportLimit + 1)
            .populate('user', 'username email fullName');

        const hasMore = attempts.length > exportLimit;
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

// GET /api/exams/:id/attempts/export - export all exam attempts as UTF-8 BOM CSV (Excel-compatible)
router.get('/:id/attempts/export', adminAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的考試 ID');
        }

        const exam = await Exam.findById(req.params.id);
        if (!exam) {
            return errorResponse(res, 404, 'EXAM_NOT_FOUND', '考試不存在');
        }

        const query = { exam: req.params.id };

        // Optional status filter
        const allowedStatuses = ['in_progress', 'submitted', 'grading', 'graded', 'expired', 'cancelled', 'auto_submitted_cheating'];
        if (req.query.status && req.query.status !== 'all' && allowedStatuses.includes(req.query.status)) {
            query.status = req.query.status;
        }

        // Optional date range filter on startedAt
        if (req.query.from || req.query.to) {
            query.startedAt = {};
            if (req.query.from) {
                const fromDate = new Date(req.query.from);
                if (!isNaN(fromDate.getTime())) query.startedAt.$gte = fromDate;
            }
            if (req.query.to) {
                const toDate = new Date(req.query.to);
                if (!isNaN(toDate.getTime())) query.startedAt.$lte = toDate;
            }
            if (Object.keys(query.startedAt).length === 0) delete query.startedAt;
        }

        const attempts = await ExamAttempt.find(query)
            .sort({ startedAt: -1, _id: -1 })
            .populate('user', 'username email fullName');

        // Format date in Asia/Taipei timezone (+8h)
        function formatTaipeiDate(date) {
            if (!date) return '';
            const d = new Date(date);
            const offset = 8 * 60 * 60 * 1000;
            const taipei = new Date(d.getTime() + offset);
            const year = taipei.getUTCFullYear();
            const month = String(taipei.getUTCMonth() + 1).padStart(2, '0');
            const day = String(taipei.getUTCDate()).padStart(2, '0');
            const hours = String(taipei.getUTCHours()).padStart(2, '0');
            const minutes = String(taipei.getUTCMinutes()).padStart(2, '0');
            const seconds = String(taipei.getUTCSeconds()).padStart(2, '0');
            return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
        }

        const csvRows = [];
        // zh-TW headers per spec
        csvRows.push('姓名,使用者名稱,Email,分數,是否通過,作答時間(秒),開始時間,提交時間,狀態,切換分頁次數,疑似作弊');

        for (const attempt of attempts) {
            const user = attempt.user || {};
            const row = [
                escapeCSVField(user.fullName || ''),
                escapeCSVField(user.username || ''),
                escapeCSVField(user.email || ''),
                attempt.score !== undefined && attempt.score !== null ? attempt.score : '',
                attempt.passed !== undefined && attempt.passed !== null ? (attempt.passed ? '是' : '否') : '',
                attempt.timeSpent !== undefined && attempt.timeSpent !== null ? attempt.timeSpent : '',
                formatTaipeiDate(attempt.startedAt),
                formatTaipeiDate(attempt.submittedAt),
                escapeCSVField(attempt.status || ''),
                attempt.visibilityChangeCount !== undefined ? attempt.visibilityChangeCount : 0,
                attempt.cheatingDetected ? '是' : '否'
            ];
            csvRows.push(row.join(','));
        }

        // UTF-8 BOM required for Excel to open Chinese text correctly
        const BOM = '﻿';
        const csvContent = BOM + csvRows.join('\n');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `exam-attempts-${exam._id}-${timestamp}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csvContent);
    } catch (error) {
        console.error('Export attempts CSV error:', error);
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
        examIds: [examId],
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

// POST /api/exams/:id/preview - preview exam without creating attempt
router.post('/:id/preview', adminAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的考試 ID');
        }
        const exam = await Exam.findById(req.params.id);
        if (!exam) {
            return errorResponse(res, 404, 'EXAM_NOT_FOUND', '考試不存在');
        }
        const questions = await Question.find({ examIds: exam._id }).sort({ questionNumber: 1 });
        res.json({
            data: {
                exam: {
                    title: exam.title,
                    timeLimit: exam.timeLimit,
                    passingScore: exam.passingScore,
                    questionsPerAttempt: exam.questionsPerAttempt
                },
                questions: questions.map(q => ({
                    questionNumber: q.questionNumber,
                    type: q.type,
                    content: q.content,
                    options: q.options,
                    points: q.points,
                    difficulty: q.difficulty
                })),
                totalPoints: questions.reduce((sum, q) => sum + q.points, 0)
            }
        });
    } catch (error) {
        console.error('Preview exam error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// PATCH /api/exams/:id/questions/reorder - reorder questions
router.patch('/:id/questions/reorder', adminAuth, async (req, res) => {
    try {
        const { reorder } = req.body;
        if (!Array.isArray(reorder) || reorder.length === 0) {
            return errorResponse(res, 400, 'VALIDATION_ERROR', 'reorder 陣列為空');
        }

        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                for (const item of reorder) {
                    await Question.findOneAndUpdate(
                        { _id: item.questionId, examIds: req.params.id },
                        { questionNumber: item.questionNumber },
                        { session }
                    );
                }
            });
            session.endSession();
            res.json({ message: '重排完成' });
        } catch (e) {
            session.endSession();
            throw e;
        }
    } catch (error) {
        console.error('Reorder error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// POST /api/exams/from-bank - Generate exam from question bank
router.post('/from-bank', adminAuth, async (req, res) => {
    try {
        const { mode, ...params } = req.body;
        
        if (!mode || !['manual', 'random'].includes(mode)) {
            return errorResponse(res, 400, 'INVALID_MODE', 'Mode must be manual or random');
        }

        let exam;
        if (mode === 'manual') {
            if (!params.questionIds || params.questionIds.length === 0) {
                return errorResponse(res, 400, 'NO_QUESTIONS', 'No questions selected');
            }
            exam = await generateExamManual({
                ...params,
                createdBy: req.user.userId
            });
        } else {
            if (!params.domainRatio || Object.keys(params.domainRatio).length === 0) {
                return errorResponse(res, 400, 'NO_DOMAIN_RATIO', 'Domain ratio is required for random mode');
            }
            exam = await generateExamFromBank({
                ...params,
                createdBy: req.user.userId
            });
        }

        res.status(201).json({ data: exam });
    } catch (error) {
        console.error('Generate exam from bank error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', error.message || '伺服器錯誤');
    }
});

// POST /api/exams/:id/clone - clone any exam to a new draft (admin override for published/active)
router.post('/:id/clone', adminAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的考試 ID');
        }

        const source = await Exam.findById(req.params.id).lean();
        if (!source) {
            return errorResponse(res, 404, 'EXAM_NOT_FOUND', '考試不存在');
        }

        // Build the new exam using the same field allowlist as the POST create route.
        // _id, createdAt, updatedAt, questionCount, totalPoints are intentionally excluded.
        const {
            description, shortDescription, examType, timeLimit, passingScore,
            maxAttempts, cooldownPeriod, questionsPerAttempt, difficultyRatio, domainRatio,
            shuffleQuestions, shuffleOptions, showCorrectAnswers, certificateEnabled,
            certificateTemplate, allowedMembers, allowedMemberIds, questionRefs, source: examSource,
            tags
        } = source;

        const cloneData = {
            title: `${source.title} (複本)`,
            description, shortDescription, examType, timeLimit, passingScore,
            maxAttempts, cooldownPeriod, questionsPerAttempt, difficultyRatio, domainRatio,
            shuffleQuestions, shuffleOptions, showCorrectAnswers, certificateEnabled,
            certificateTemplate, allowedMembers, allowedMemberIds, questionRefs,
            source: examSource,
            tags,
            // Reset scheduling so admin must explicitly set new dates
            startDate: undefined,
            endDate: undefined,
            // Always draft + attributed to the requesting admin
            status: 'draft',
            createdBy: req.user.userId,
            // Reset computed counters; they will be recalculated if questions are copied
            questionCount: 0,
            totalPoints: 0
        };

        // Remove undefined keys so Mongoose defaults apply properly
        Object.keys(cloneData).forEach(k => cloneData[k] === undefined && delete cloneData[k]);

        const newExam = new Exam(cloneData);
        await newExam.save();

        // Copy embedded questions when the source exam is manually authored
        // (question-bank-sourced exams carry questionRefs already copied above)
        if (source.source !== 'question_bank') {
            const sourceQuestions = await Question.find({ examIds: source._id }).lean();

            if (sourceQuestions.length > 0) {
                const questionCopies = sourceQuestions.map(q => {
                    const { _id, __v, createdAt, updatedAt, exam, ...rest } = q;
                    return { ...rest, examIds: [newExam._id] };
                });

                await Question.insertMany(questionCopies);

                // Update the cloned exam's denormalised counters
                newExam.questionCount = questionCopies.length;
                newExam.totalPoints = questionCopies.reduce((sum, q) => sum + (q.points || 0), 0);
                await newExam.save();
            }
        }

        res.status(201).json({
            data: {
                _id: newExam._id,
                title: newExam.title,
                status: newExam.status,
                questionCount: newExam.questionCount,
                totalPoints: newExam.totalPoints
            }
        });
    } catch (error) {
        console.error('Clone exam error:', error);
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

// POST /api/exams/:id/archive - convenience shortcut: move exam to archived status
// Equivalent to PATCH /:id/status { status: 'archived' } but semantically clearer for admins.
// Works for published, active, and closed exams (transition map in PATCH /status enforces this).
router.post('/:id/archive', adminAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的考試 ID');
        }

        const exam = await Exam.findById(req.params.id);
        if (!exam) {
            return errorResponse(res, 404, 'EXAM_NOT_FOUND', '考試不存在');
        }

        const archivableStatuses = ['published', 'active', 'closed'];
        if (!archivableStatuses.includes(exam.status)) {
            return errorResponse(
                res, 400, 'STATUS_TRANSITION_INVALID',
                `無法從 ${exam.status} 封存，只有 published / active / closed 狀態可以封存`
            );
        }

        exam.status = 'archived';
        await exam.save();

        res.json({ data: exam });
    } catch (error) {
        console.error('Archive exam error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// GET /api/exams/:id/certificates - list certificates for an exam
router.get('/:id/certificates', adminAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的考試 ID');
        }
        const exam = await Exam.findById(req.params.id);
        if (!exam) {
            return errorResponse(res, 404, 'EXAM_NOT_FOUND', '考試不存在');
        }
        const certs = await Certificate.find({ exam: req.params.id })
            .populate('user', 'username email fullName')
            .populate('attempt', 'score passed attemptNumber')
            .populate('revokedBy', 'username fullName')
            .sort({ issuedAt: -1 });
        res.json({ data: certs });
    } catch (error) {
        console.error('List certificates error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// POST /api/exams/certificates/:id/revoke - revoke a certificate
router.post('/certificates/:id/revoke', adminAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的證書 ID');
        }
        const cert = await Certificate.findById(req.params.id);
        if (!cert) {
            return errorResponse(res, 404, 'NOT_FOUND', '證書不存在');
        }
        if (cert.isRevoked) {
            return errorResponse(res, 400, 'ALREADY_REVOKED', '證書已撤銷');
        }
        cert.isRevoked = true;
        cert.revokedAt = new Date();
        cert.revokedBy = req.user.userId;
        cert.revokeReason = req.body.reason || '';
        await cert.save();
        res.json({ data: { message: '證書已撤銷' } });
    } catch (error) {
        console.error('Revoke certificate error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// POST /api/exams/certificates/:id/unrevoke - restore a revoked certificate
router.post('/certificates/:id/unrevoke', adminAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的證書 ID');
        }
        const cert = await Certificate.findById(req.params.id);
        if (!cert) {
            return errorResponse(res, 404, 'NOT_FOUND', '證書不存在');
        }
        if (!cert.isRevoked) {
            return errorResponse(res, 400, 'NOT_REVOKED', '證書尚未撤銷');
        }
        cert.isRevoked = false;
        cert.revokedAt = undefined;
        cert.revokedBy = undefined;
        cert.revokeReason = '';
        await cert.save();
        res.json({ data: { message: '證書已恢復' } });
    } catch (error) {
        console.error('Unrevoke certificate error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

module.exports = router;
