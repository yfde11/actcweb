const express = require('express');
const mongoose = require('mongoose');
const Exam = require('../models/Exam');
const Question = require('../models/Question');
const ExamAttempt = require('../models/ExamAttempt');
const Certificate = require('../models/Certificate');
const { adminAuth } = require('../middleware/adminAuth');

const router = express.Router();

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

module.exports = router;
