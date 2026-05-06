const express = require('express');
const mongoose = require('mongoose');
const Exam = require('../models/Exam');
const Question = require('../models/Question');
const ExamAttempt = require('../models/ExamAttempt');
const Certificate = require('../models/Certificate');
const Counter = require('../models/Counter');
const User = require('../models/User');
const { verifiedAuth } = require('../middleware/memberAuth');
const { gradeAttempt, generateCertificate } = require('../services/examGrading');
const { verifyCertificate, generateCertificatePDF } = require('../services/examCertificates');
const { sendExamSubmittedEmail, sendExamPassedEmail, sendExamFailedEmail } = require('../services/examNotifications');

const router = express.Router();

// Fisher-Yates shuffle — returns a new shuffled array, does not mutate the original
function fisherYatesShuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// Error response helper
function errorResponse(res, statusCode, code, message, details = {}) {
    return res.status(statusCode).json({
        error: { code, message, details }
    });
}

// GET /api/member/exams - available exams list with user attempt info
router.get('/', verifiedAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const now = new Date();
        const query = {
            status: 'active',
            $or: [
                { startDate: { $lte: now } },
                { startDate: null }
            ],
            $and: [
                { $or: [
                    { endDate: { $gte: now } },
                    { endDate: null }
                ]}
            ]
        };

        // Exclude 'specific' exams whose allowedMemberIds does not include this user.
        // We push this into the DB query rather than filtering in JS to avoid loading
        // ineligible exam documents into memory.
        query.$and = query.$and || [];
        query.$and.push({
            $or: [
                { allowedMembers: { $ne: 'specific' } },
                { allowedMembers: 'specific', allowedMemberIds: new mongoose.Types.ObjectId(userId) }
            ]
        });

        const [exams, total] = await Promise.all([
            Exam.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .select('title shortDescription examType timeLimit passingScore certificateEnabled tags'),
            Exam.countDocuments(query)
        ]);

        // Get user's attempts for these exams
        const examIds = exams.map(e => e._id);
        const attempts = await ExamAttempt.find({
            exam: { $in: examIds },
            user: userId
        }).select('exam status attemptNumber score passed cheatingDetected submittedAt');

        const attemptsMap = {};
        attempts.forEach(a => {
            if (!attemptsMap[a.exam.toString()]) {
                attemptsMap[a.exam.toString()] = [];
            }
            attemptsMap[a.exam.toString()].push(a);
        });

        const data = exams.map(exam => ({
            ...exam.toObject(),
            userAttempts: attemptsMap[exam._id.toString()] || [],
            canStart: (() => {
                const userAttempts = attemptsMap[exam._id.toString()] || [];
                const gradedAttempts = userAttempts.filter(a => 
                    a.status === 'graded' || a.status === 'auto_submitted_cheating'
                );
                if (exam.maxAttempts > 0 && gradedAttempts.length >= exam.maxAttempts) {
                    return { allowed: false, reason: 'MAX_ATTEMPTS_REACHED' };
                }
                // Check cooldown
                const lastAttempt = gradedAttempts.sort((a,b) =>
                    b.submittedAt - a.submittedAt)[0];
                if (lastAttempt && exam.cooldownPeriod > 0 && !lastAttempt.cooldownWaived) {
                    const cooldownEnd = new Date(lastAttempt.submittedAt);
                    cooldownEnd.setDate(cooldownEnd.getDate() + exam.cooldownPeriod);
                    if (now < cooldownEnd) {
                        return {
                            allowed: false,
                            reason: 'COOLDOWN_ACTIVE',
                            nextAttemptAt: cooldownEnd
                        };
                    }
                }
                // Check in_progress
                const inProgress = userAttempts.find(a => a.status === 'in_progress');
                if (inProgress) {
                    return { allowed: false, reason: 'IN_PROGRESS', attemptId: inProgress._id };
                }
                return { allowed: true };
            })()
        }));

        res.json({
            data,
            pagination: {
                total,
                totalPages: Math.ceil(total / parseInt(limit)),
                page: parseInt(page),
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('List available exams error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// GET /api/member/certificates - my certificates
router.get('/certificates', verifiedAuth, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [certificates, total] = await Promise.all([
            Certificate.find({
                user: req.user.userId,
                isRevoked: { $ne: true }
            })
                .sort({ issuedAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .populate('exam', 'title examType'),
            Certificate.countDocuments({
                user: req.user.userId,
                isRevoked: { $ne: true }
            })
        ]);

        res.json({
            data: certificates,
            pagination: {
                total,
                totalPages: Math.ceil(total / parseInt(limit)),
                page: parseInt(page),
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('List certificates error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// GET /api/member/exams/:id - exam info (no answers)
router.get('/:id', verifiedAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的考試 ID');
        }

        const exam = await Exam.findById(req.params.id);
        if (!exam) {
            return errorResponse(res, 404, 'EXAM_NOT_FOUND', '考試不存在');
        }

        // Get user attempts
        const attempts = await ExamAttempt.find({
            exam: exam._id,
            user: req.user.userId
        }).sort({ attemptNumber: -1 });

        // Return exam info without correct answers
        const examData = exam.toObject();
        delete examData.__v;

        res.json({
            data: {
                exam: examData,
                userAttempts: attempts
            }
        });
    } catch (error) {
        console.error('Get exam error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// POST /api/member/exams/:id/start - start exam with stratified random selection
router.post('/:id/start', verifiedAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的考試 ID');
        }

        // Membership gate: only approved members may take exams
        if (req.authUser.membershipStatus !== 'approved') {
            return errorResponse(res, 403, 'MEMBERSHIP_REQUIRED', '需要通過會員審核才能參加考試');
        }

        const userId = req.user.userId;
        const exam = await Exam.findById(req.params.id);
        
        if (!exam) {
            return errorResponse(res, 404, 'EXAM_NOT_FOUND', '考試不存在');
        }

        // Check if exam is available
        if (!exam.isAvailable) {
            return errorResponse(res, 403, 'EXAM_NOT_ACTIVE', '考試尚未開放或已結束');
        }

        // Specific-member access control
        if (exam.allowedMembers === 'specific') {
            const allowed = (exam.allowedMemberIds || []).map(id => id.toString());
            if (!allowed.includes(req.authUser._id.toString())) {
                return res.status(403).json({
                    error: { code: 'NOT_ALLOWED', message: '您未被授權參加此考試' }
                });
            }
        }

        // Check max attempts
        const gradedAttempts = await ExamAttempt.find({
            exam: exam._id,
            user: userId,
            status: { $in: ['graded', 'auto_submitted_cheating'] }
        });

        if (exam.maxAttempts > 0 && gradedAttempts.length >= exam.maxAttempts) {
            return errorResponse(res, 403, 'MAX_ATTEMPTS_REACHED', '已達最大重考次數');
        }

        // Check cooldown
        if (gradedAttempts.length > 0 && exam.cooldownPeriod > 0) {
            const lastAttempt = gradedAttempts.sort((a,b) =>
                b.submittedAt - a.submittedAt)[0];
            if (!lastAttempt.cooldownWaived) {
                const cooldownEnd = new Date(lastAttempt.submittedAt);
                cooldownEnd.setDate(cooldownEnd.getDate() + exam.cooldownPeriod);
                if (new Date() < cooldownEnd) {
                    return errorResponse(res, 403, 'COOLDOWN_ACTIVE', '冷卻中，尚未可重考', {
                        nextAttemptAt: cooldownEnd
                    });
                }
            }
        }

        // Check for existing in_progress attempt (DB-level race condition protection via partial unique index)
        let attempt;
        try {
            // Try to create new attempt (partial unique index prevents duplicate in_progress)
            // Questions are stored with 'examIds' (array) — not a singular 'exam' field.
            const allQuestions = await Question.find({ examIds: exam._id });

            if (allQuestions.length === 0) {
                return errorResponse(res, 409, 'NO_QUESTIONS', '此考試尚未包含任何題目，請聯絡管理員');
            }

            // Stratified random selection if questionsPerAttempt < total
            let selectedQuestions = allQuestions;
            if (exam.questionsPerAttempt && exam.questionsPerAttempt < allQuestions.length) {
                const { easy, medium, hard } = exam.difficultyRatio;
                const totalRatio = easy + medium + hard;
                const easyCount = Math.round(exam.questionsPerAttempt * easy / totalRatio);
                const mediumCount = Math.round(exam.questionsPerAttempt * medium / totalRatio);
                const hardCount = exam.questionsPerAttempt - easyCount - mediumCount;

                const [easyQuestions, mediumQuestions, hardQuestions] = await Promise.all([
                    Question.aggregate([
                        { $match: { examIds: exam._id, difficulty: 'easy' } },
                        { $sample: { size: Math.min(easyCount, allQuestions.filter(q => q.difficulty === 'easy').length) } }
                    ]),
                    Question.aggregate([
                        { $match: { examIds: exam._id, difficulty: 'medium' } },
                        { $sample: { size: Math.min(mediumCount, allQuestions.filter(q => q.difficulty === 'medium').length) } }
                    ]),
                    Question.aggregate([
                        { $match: { examIds: exam._id, difficulty: 'hard' } },
                        { $sample: { size: Math.min(hardCount, allQuestions.filter(q => q.difficulty === 'hard').length) } }
                    ])
                ]);

                selectedQuestions = [...easyQuestions, ...mediumQuestions, ...hardQuestions];
                
                // If not enough questions, fill from remaining
                // E7: Shuffle remaining before slicing so fallback fill is non-deterministic
                if (selectedQuestions.length < exam.questionsPerAttempt) {
                    const remaining = allQuestions.filter(q =>
                        !selectedQuestions.some(s => s._id.toString() === q._id.toString())
                    );
                    const fillCount = exam.questionsPerAttempt - selectedQuestions.length;
                    const shuffledRemaining = fisherYatesShuffle(remaining);
                    selectedQuestions.push(...shuffledRemaining.slice(0, fillCount));
                }
            }

            // Create question snapshot (without correct answers for security)
            const questionSnapshot = selectedQuestions.map(q => ({
                questionId: q._id,
                questionNumber: q.questionNumber,
                type: q.type,
                content: q.content,
                correctAnswer: q.type === 'multiple_choice' ? q.correctOptionIndex :
                              q.type === 'true_false' ? q.correctBoolean :
                              (q.correctAnswers && q.correctAnswers[0]) || '',
                points: q.points,
                difficulty: q.difficulty
            }));

            // Calculate expiresAt if timeLimit > 0
            let expiresAt = null;
            if (exam.timeLimit > 0) {
                expiresAt = new Date();
                expiresAt.setMinutes(expiresAt.getMinutes() + exam.timeLimit);
            }

            // Get next attempt number
            const lastAttempt = await ExamAttempt.findOne(
                { exam: exam._id, user: userId },
                { attemptNumber: 1 },
                { sort: { attemptNumber: -1 } }
            );
            const attemptNumber = lastAttempt ? lastAttempt.attemptNumber + 1 : 1;

            attempt = new ExamAttempt({
                exam: exam._id,
                user: userId,
                attemptNumber,
                expiresAt,
                questionSnapshot
            });

            await attempt.save();
        } catch (error) {
            if (error.code === 11000) { // Duplicate key error (partial unique index)
                // Resume existing attempt
                attempt = await ExamAttempt.findOne({
                    exam: exam._id,
                    user: userId,
                    status: 'in_progress'
                });
            } else {
                throw error;
            }
        }

        // Lazy expiry check
        if (attempt.expiresAt && new Date() > attempt.expiresAt) {
            attempt.status = 'expired';
            await attempt.save();
            return errorResponse(res, 410, 'EXAM_EXPIRED', '考試已過期');
        }

        // Return questions without correct answers
        const questions = attempt.questionSnapshot.map(q => ({
            questionId: q.questionId,
            questionNumber: q.questionNumber,
            type: q.type,
            content: q.content,
            points: q.points,
            difficulty: q.difficulty,
            // Options will be fetched below
            options: []
        }));

        // Fetch full question details for options
        const questionIds = attempt.questionSnapshot.map(q => q.questionId);
        const fullQuestions = await Question.find({ _id: { $in: questionIds } });
        const questionMap = {};
        fullQuestions.forEach(q => {
            questionMap[q._id.toString()] = q;
        });

        let returnQuestions = attempt.questionSnapshot.map(snapshot => {
            const fullQ = questionMap[snapshot.questionId.toString()];
            let options = fullQ ? [...fullQ.options] : [];

            // Shuffle options when enabled; update snapshot's correctAnswer to reflect new index
            // Store shuffled order in snapshot so resume returns the same sequence
            if (exam.shuffleOptions && snapshot.type === 'multiple_choice' && options.length > 0) {
                const originalCorrectIndex = snapshot.correctAnswer;
                const correctOption = options[originalCorrectIndex];

                // Fisher-Yates shuffle
                for (let i = options.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [options[i], options[j]] = [options[j], options[i]];
                }

                // Find where the correct option landed in the shuffled array
                const newCorrectIndex = options.findIndex(
                    opt => opt && correctOption && opt.text === correctOption.text
                );
                if (newCorrectIndex !== -1) {
                    snapshot.correctAnswer = newCorrectIndex;
                }
                // Persist shuffled order so resume returns the same sequence
                snapshot.shuffledOptions = options;
            }

            return {
                questionId: snapshot.questionId,
                questionNumber: snapshot.questionNumber,
                type: snapshot.type,
                content: snapshot.content,
                points: snapshot.points,
                difficulty: snapshot.difficulty,
                options,
                correctOptionIndex: undefined,
                correctBoolean: undefined,
                correctAnswers: undefined
            };
        });

        // Persist correctAnswer updates and shuffled option order
        if (exam.shuffleOptions) {
            await attempt.save();
        }

        // Shuffle question order when enabled
        if (exam.shuffleQuestions === true) {
            returnQuestions = fisherYatesShuffle(returnQuestions);
        }

        res.json({
            data: {
                attemptId: attempt._id,
                attemptNumber: attempt.attemptNumber,
                startedAt: attempt.startedAt,
                expiresAt: attempt.expiresAt,
                timeLimit: exam.timeLimit,
                questions: returnQuestions,
                answers: attempt.answers || []
            }
        });
    } catch (error) {
        console.error('Start exam error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// GET /api/member/exams/:id/resume - resume in-progress exam
// Accepts optional ?attemptId= to target a specific attempt (used by standalone exam window)
router.get('/:id/resume', verifiedAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的考試 ID');
        }

        const filter = {
            exam: req.params.id,
            user: req.user.userId,
            status: 'in_progress'
        };
        if (req.query.attemptId && mongoose.Types.ObjectId.isValid(req.query.attemptId)) {
            filter._id = req.query.attemptId;
        }

        const attempt = await ExamAttempt.findOne(filter);

        if (!attempt) {
            return errorResponse(res, 404, 'NO_IN_PROGRESS', '沒有進行中的考試');
        }

        // Lazy expiry check
        if (attempt.expiresAt && new Date() > attempt.expiresAt) {
            attempt.status = 'expired';
            await attempt.save();
            return errorResponse(res, 410, 'EXAM_EXPIRED', '考試已過期');
        }

        const exam = await Exam.findById(req.params.id);

        // Fetch full question details
        const questionIds = attempt.questionSnapshot.map(q => q.questionId);
        const fullQuestions = await Question.find({ _id: { $in: questionIds } });
        const questionMap = {};
        fullQuestions.forEach(q => {
            questionMap[q._id.toString()] = q;
        });

        const returnQuestions = attempt.questionSnapshot.map(snapshot => {
            const fullQ = questionMap[snapshot.questionId.toString()];
            // Use shuffledOptions stored at start time so the order matches correctAnswer in snapshot
            const options = snapshot.shuffledOptions || (fullQ ? fullQ.options : []);
            return {
                questionId: snapshot.questionId,
                questionNumber: snapshot.questionNumber,
                type: snapshot.type,
                content: snapshot.content,
                points: snapshot.points,
                difficulty: snapshot.difficulty,
                options
            };
        });

        res.json({
            data: {
                attemptId: attempt._id,
                attemptNumber: attempt.attemptNumber,
                startedAt: attempt.startedAt,
                expiresAt: attempt.expiresAt,
                timeLimit: exam.timeLimit,
                examTitle: exam.title,
                questions: returnQuestions,
                answers: attempt.answers || []
            }
        });
    } catch (error) {
        console.error('Resume exam error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// PATCH /api/member/exams/:id/save-progress - auto-save answers
router.patch('/:id/save-progress', verifiedAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的考試 ID');
        }

        const { attemptId, answers, visibilityChangeCount } = req.body;
        if (!attemptId) {
            return errorResponse(res, 400, 'VALIDATION_ERROR', '缺少 attemptId');
        }

        const baseFilter = {
            _id: attemptId,
            exam: req.params.id,
            user: req.user.userId,
            status: 'in_progress'
        };

        const exists = await ExamAttempt.countDocuments(baseFilter);
        if (!exists) {
            return errorResponse(res, 404, 'ATTEMPT_NOT_FOUND', '作答紀錄不存在');
        }

        const topLevelUpdate = { lastSavedAt: new Date() };
        // Only ratchet visibilityChangeCount upward — prevents a malicious client from
        // resetting it to 0 on every autosave to clear the cheat signal.
        if (typeof visibilityChangeCount === 'number' && visibilityChangeCount > (exists.visibilityChangeCount || 0)) {
            topLevelUpdate.visibilityChangeCount = visibilityChangeCount;
        }

        if (answers && Array.isArray(answers) && answers.length > 0) {
            // Atomic bulkWrite: update existing answer entries, push new ones.
            // Avoids the read-modify-save pattern that causes VersionError under concurrent requests.
            const updateExisting = answers.map(ans => ({
                updateOne: {
                    filter: { ...baseFilter, 'answers.questionId': ans.questionId },
                    update: { $set: { 'answers.$': ans, ...topLevelUpdate } }
                }
            }));
            const insertNew = answers.map(ans => ({
                updateOne: {
                    filter: { ...baseFilter, 'answers.questionId': { $ne: ans.questionId } },
                    update: { $push: { answers: ans }, $set: topLevelUpdate }
                }
            }));
            await ExamAttempt.bulkWrite([...updateExisting, ...insertNew]);
        } else {
            await ExamAttempt.updateOne(baseFilter, { $set: topLevelUpdate });
        }

        res.json({ message: '進度已儲存' });
    } catch (error) {
        console.error('Save progress error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// POST /api/member/exams/:id/submit - submit exam with backend cheat detection
router.post('/:id/submit', verifiedAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的考試 ID');
        }

        // Membership gate: only approved members may submit exams
        if (req.authUser.membershipStatus !== 'approved') {
            return errorResponse(res, 403, 'MEMBERSHIP_REQUIRED', '需要通過會員審核才能參加考試');
        }

        const { attemptId, answers, timeSpent, visibilityChangeCount } = req.body;

        if (!attemptId) {
            return errorResponse(res, 400, 'VALIDATION_ERROR', '缺少 attemptId');
        }

        // Atomic transition: in_progress -> grading (prevents double-submit race condition)
        const attempt = await ExamAttempt.findOneAndUpdate(
            { _id: attemptId, exam: req.params.id, user: req.user.userId, status: 'in_progress' },
            { $set: { status: 'grading' } },
            { new: false }
        );

        if (!attempt) {
            // Determine whether it was never found or already submitted
            const existing = await ExamAttempt.findOne({ _id: attemptId, user: req.user.userId });
            if (!existing) {
                return errorResponse(res, 404, 'ATTEMPT_NOT_FOUND', '作答紀錄不存在');
            }
            return errorResponse(res, 409, 'ALREADY_SUBMITTED', '考試已提交，請勿重複操作');
        }

        // Lazy expiry check
        if (attempt.expiresAt && new Date() > attempt.expiresAt) {
            attempt.status = 'expired';
            await attempt.save();
            return errorResponse(res, 410, 'EXAM_EXPIRED', '考試已過期');
        }

        // Update answers
        if (answers && Array.isArray(answers)) {
            attempt.answers = answers.map(a => ({
                questionId: a.questionId,
                questionNumber: a.questionNumber,
                answer: a.answer,
                isCorrect: false,
                pointsEarned: 0
            }));
        }

        // Backend cheat detection (independent of frontend)
        const exam = await Exam.findById(req.params.id);

        // E3: Compute elapsed time server-side using startedAt — do NOT trust client-supplied timeSpent
        const serverTimeSpent = Math.floor((new Date() - new Date(attempt.startedAt)) / 1000);

        // E4: Use server-stored visibilityChangeCount — do NOT trust client-supplied value
        const serverVisibilityCount = attempt.visibilityChangeCount || 0;

        let cheatingDetected = false;

        // Rule 1: Time spent too short (less than 30 seconds per question)
        // Only applies when the exam has a time limit — open-ended exams allow fast answers
        if (exam.timeLimit > 0 && serverTimeSpent < attempt.questionSnapshot.length * 30) {
            cheatingDetected = true;
            attempt.cheatingDetails.push({
                type: 'fast_submission',
                timestamp: new Date(),
                warningNumber: 999
            });
        }

        // Rule 2: Excessive tab switches detected server-side
        if (serverVisibilityCount > 10) {
            cheatingDetected = true;
            attempt.cheatingDetails.push({
                type: 'visibility_change',
                timestamp: new Date(),
                warningNumber: serverVisibilityCount
            });
        }

        // Store client-supplied timeSpent for analytics only (not used for cheat detection)
        attempt.timeSpent = timeSpent || serverTimeSpent;
        attempt.submittedAt = new Date();
        
        if (cheatingDetected) {
            attempt.status = 'auto_submitted_cheating';
            attempt.cheatingDetected = true;
            attempt.score = 0;
            attempt.passed = false;
        } else {
            attempt.status = 'submitted';
        }

        await attempt.save();

        // Trigger grading if no cheating detected
        if (!cheatingDetected) {
            const gradingResult = await gradeAttempt(attempt._id);

            // Generate certificate if passed and enabled
            let certificateNumber = null;
            if (gradingResult.passed && exam.certificateEnabled) {
                try {
                    await generateCertificate(attempt._id);
                    const cert = await Certificate.findOne({ attempt: attempt._id });
                    if (cert) certificateNumber = cert.certificateNumber;
                } catch (certError) {
                    console.error('Certificate generation error:', certError);
                }
            }

            // Send exam result notification email (req.authUser is the full user doc from verifiedAuth)
            try {
                const notifUser = req.authUser;
                const gradedAttempt = await ExamAttempt.findById(attempt._id);
                if (gradingResult.passed) {
                    await sendExamPassedEmail(notifUser, exam, gradedAttempt, certificateNumber);
                } else {
                    await sendExamFailedEmail(notifUser, exam, gradedAttempt);
                }
            } catch (notifError) {
                console.error('[submit] Failed to send exam result notification:', notifError);
            }
        }

        // Fetch updated attempt for response
        const updatedAttempt = await ExamAttempt.findById(attempt._id);
        
        // Return result based on showCorrectAnswers setting
        const result = {
            attemptId: updatedAttempt._id,
            status: updatedAttempt.status,
            score: updatedAttempt.score,
            passed: updatedAttempt.passed,
            passingScore: exam.passingScore,
            cheatingDetected: updatedAttempt.cheatingDetected
        };

        if (exam.showCorrectAnswers !== 'never' && updatedAttempt.status === 'graded') {
            result.gradingDetails = updatedAttempt.gradingDetails;
            if (exam.showCorrectAnswers === 'immediately') {
                result.questionSnapshot = updatedAttempt.questionSnapshot;
                result.answers = updatedAttempt.answers;
            }
        }

        // Include certificate info if passed and certificate exists
        if (updatedAttempt.passed && !updatedAttempt.cheatingDetected) {
            const certificate = await Certificate.findOne({ attempt: updatedAttempt._id });
            if (certificate) {
                result.certificateNumber = certificate.certificateNumber;
                result.certificateIssued = true;
            }
        }

        res.json({ data: result });
    } catch (error) {
        console.error('Submit exam error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// POST /api/member/exams/:id/abandon - abandon in-progress attempt (standalone window closed without submitting)
// Used when timeLimit=0 so the cron job never expires the attempt naturally.
router.post('/:id/abandon', verifiedAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的考試 ID');
        }
        const { attemptId } = req.body;
        if (!attemptId || !mongoose.Types.ObjectId.isValid(attemptId)) {
            return errorResponse(res, 400, 'VALIDATION_ERROR', '缺少 attemptId');
        }

        const result = await ExamAttempt.findOneAndUpdate(
            { _id: attemptId, exam: req.params.id, user: req.user.userId, status: 'in_progress' },
            { $set: { status: 'expired', submittedAt: new Date() } },
            { new: true }
        );

        if (!result) {
            return errorResponse(res, 404, 'ATTEMPT_NOT_FOUND', '找不到進行中的作答紀錄');
        }

        res.json({ message: '考試已放棄' });
    } catch (error) {
        console.error('Abandon exam error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// GET /api/member/exams/:id/result - view result
router.get('/:id/result', verifiedAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return errorResponse(res, 400, 'INVALID_ID', '無效的考試 ID');
        }

        // Membership gate: only approved members may view exam results
        if (req.authUser.membershipStatus !== 'approved') {
            return errorResponse(res, 403, 'MEMBERSHIP_REQUIRED', '需要通過會員審核才能參加考試');
        }

        const { attemptId } = req.query;
        const query = {
            exam: req.params.id,
            user: req.user.userId,
            status: { $in: ['graded', 'auto_submitted_cheating'] }
        };

        if (attemptId) {
            query._id = attemptId;
        }

        const attempt = await ExamAttempt.findOne(query).sort({ submittedAt: -1 });
        if (!attempt) {
            return errorResponse(res, 404, 'ATTEMPT_NOT_FOUND', '作答紀錄不存在');
        }

        const exam = await Exam.findById(req.params.id);

        const result = {
            attemptId: attempt._id,
            attemptNumber: attempt.attemptNumber,
            status: attempt.status,
            score: attempt.score,
            passed: attempt.passed,
            passingScore: exam ? exam.passingScore : undefined,
            cheatingDetected: attempt.cheatingDetected,
            submittedAt: attempt.submittedAt,
            timeSpent: attempt.timeSpent
        };

        if (exam.showCorrectAnswers !== 'never' && attempt.status === 'graded') {
            result.gradingDetails = attempt.gradingDetails;
            if (exam.showCorrectAnswers === 'immediately' || exam.showCorrectAnswers === 'after_submit') {
                result.questionSnapshot = attempt.questionSnapshot;
                result.answers = attempt.answers;
            }
        }

        res.json({ data: result });
    } catch (error) {
        console.error('Get result error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// GET /api/member/exams/verify/:certificateNumber - public verification (shared logic)
router.get('/verify/:certificateNumber', async (req, res) => {
    try {
        const result = await verifyCertificate(req.params.certificateNumber);
        if (!result.ok) {
            return errorResponse(res, result.statusCode, result.code, result.message);
        }
        res.json({ data: result.data });
    } catch (error) {
        console.error('Verify certificate error:', error);
        errorResponse(res, 500, 'INTERNAL_ERROR', '伺服器錯誤');
    }
});

// GET /api/member/exams/certificate/:certificateNumber - download certificate PDF
router.get('/certificate/:certificateNumber', verifiedAuth, async (req, res) => {
    try {
        const certificate = await Certificate.findOne({
            certificateNumber: req.params.certificateNumber,
            user: req.user.userId,
            isRevoked: { $ne: true }
        }).populate('exam');

        if (!certificate) {
            return res.status(404).json({ error: { code: 'CERTIFICATE_NOT_FOUND', message: '證書不存在' } });
        }

        if (certificate.expiresAt && new Date() > certificate.expiresAt) {
            return res.status(403).json({ error: { code: 'CERTIFICATE_EXPIRED', message: '證書已過期' } });
        }

        await generateCertificatePDF(certificate._id, res);
    } catch (error) {
        console.error('Download certificate error:', error);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '下載失敗' } });
    }
});

module.exports = router;
