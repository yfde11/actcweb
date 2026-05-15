const mongoose = require('mongoose');
const ExamAttempt = require('../models/ExamAttempt');
const Question = require('../models/Question');
const Certificate = require('../models/Certificate');
const Counter = require('../models/Counter');
const { sendExamSubmittedEmail, sendExamPassedEmail, sendExamFailedEmail } = require('./examNotifications');

/**
 * Grade an exam attempt
 * @param {string} attemptId - ExamAttempt ID
 * @returns {Promise<Object>} Grading result
 */
async function gradeAttempt(attemptId) {
    if (!mongoose.Types.ObjectId.isValid(attemptId)) {
        throw new Error('INVALID_ATTEMPT_ID');
    }

    const attempt = await ExamAttempt.findById(attemptId);
    if (!attempt) {
        throw new Error('ATTEMPT_NOT_FOUND');
    }

    // Skip grading if cheating detected
    if (attempt.cheatingDetected || attempt.status === 'auto_submitted_cheating') {
        attempt.score = 0;
        attempt.passed = false;
        attempt.status = 'auto_submitted_cheating';
        await attempt.save();
        return {
            attemptId: attempt._id,
            status: attempt.status,
            score: attempt.score,
            passed: attempt.passed,
            cheatingDetected: true
        };
    }

    let totalPoints = 0;
    let earnedPoints = 0;
    let correctCount = 0;
    let incorrectCount = 0;
    let unansweredCount = 0;

    // Batch-fetch all fill_in_blank questions up front to avoid N+1 DB queries
    const fillInBlankIds = attempt.questionSnapshot
        .filter(q => q.type === 'fill_in_blank')
        .map(q => q.questionId);

    const fillInBlankQuestions = fillInBlankIds.length > 0
        ? await Question.find({ _id: { $in: fillInBlankIds } }).lean()
        : [];

    const fillInBlankMap = new Map(
        fillInBlankQuestions.map(q => [q._id.toString(), q])
    );

    // Process each question in snapshot
    for (const snapshot of attempt.questionSnapshot) {
        totalPoints += snapshot.points;
        const answer = attempt.answers.find(a => 
            a.questionId.toString() === snapshot.questionId.toString()
        );

        if (!answer || answer.answer === null || answer.answer === undefined) {
            unansweredCount++;
            // answer may be undefined (question was skipped entirely) — do not
            // attempt to set properties on it; just count it as wrong and move on.
            if (answer) {
                answer.isCorrect = false;
                answer.pointsEarned = 0;
            }
            continue;
        }

        let isCorrect = false;
        const userAnswer = answer.answer;

        if (snapshot.type === 'multiple_choice') {
            isCorrect = Number(userAnswer) === Number(snapshot.correctAnswer);
        } else if (snapshot.type === 'true_false') {
            isCorrect = String(userAnswer).toLowerCase() === String(snapshot.correctAnswer).toLowerCase();
        } else if (snapshot.type === 'fill_in_blank') {
            // Use pre-fetched map — avoids one DB query per question
            const question = fillInBlankMap.get(snapshot.questionId.toString());
            if (question) {
                const normalizedUserAnswer = String(userAnswer).trim().toLowerCase();
                const acceptableAnswers = [
                    ...(question.correctAnswers || []),
                    ...(question.acceptableAnswers || [])
                ].map(a => a.toLowerCase().trim());
                
                isCorrect = acceptableAnswers.includes(normalizedUserAnswer);
            }
        }

        if (isCorrect) {
            correctCount++;
            earnedPoints += snapshot.points;
            answer.isCorrect = true;
            answer.pointsEarned = snapshot.points;
        } else {
            incorrectCount++;
            answer.isCorrect = false;
            answer.pointsEarned = 0;
        }
    }

    // Calculate final score
    attempt.score = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
    
    // Populate exam to get passing score
    await attempt.populate('exam');
    attempt.passed = attempt.score >= attempt.exam.passingScore;
    
    attempt.gradingDetails = {
        totalPoints,
        earnedPoints,
        correctCount,
        incorrectCount,
        unansweredCount
    };
    attempt.status = 'graded';

    await attempt.save();

    // Send email notifications (non-blocking)
    try {
        // Populate user if not already populated
        if (!attempt.user || typeof attempt.user === 'string' || attempt.user instanceof mongoose.Types.ObjectId) {
            await attempt.populate('user');
        }
        
        if (attempt.status === 'graded' && attempt.user && attempt.exam) {
            await sendExamSubmittedEmail(attempt.user, attempt.exam, attempt);
            
            if (attempt.passed) {
                const certificate = await Certificate.findOne({ attempt: attempt._id });
                const certNumber = certificate ? certificate.certificateNumber : null;
                await sendExamPassedEmail(attempt.user, attempt.exam, attempt, certNumber);
            } else {
                await sendExamFailedEmail(attempt.user, attempt.exam, attempt);
            }
        }
    } catch (notifyError) {
        console.error('[examGrading] Notification error (non-blocking):', notifyError);
    }

    return {
        attemptId: attempt._id,
        status: attempt.status,
        score: attempt.score,
        passed: attempt.passed,
        cheatingDetected: false,
        gradingDetails: attempt.gradingDetails
    };
}

/**
 * Generate certificate for passed attempt
 * @param {string} attemptId - ExamAttempt ID
 * @returns {Promise<Object>} Certificate object
 */
async function generateCertificate(attemptId) {
    if (!mongoose.Types.ObjectId.isValid(attemptId)) {
        throw new Error('INVALID_ATTEMPT_ID');
    }

    const attempt = await ExamAttempt.findById(attemptId).populate('exam');
    if (!attempt) {
        throw new Error('ATTEMPT_NOT_FOUND');
    }

    // Check if already has certificate (idempotent)
    const existing = await Certificate.findOne({ attempt: attemptId });
    if (existing) {
        return existing;
    }

    // Check conditions
    if (!attempt.passed || attempt.cheatingDetected || !attempt.exam.certificateEnabled) {
        return null;
    }

    // Generate certificate number
    const seq = await Counter.getNextSequence('certificate_number');
    const year = new Date().getFullYear();
    const certNumber = `ACTC-EXAM-${year}-${String(seq).padStart(6, '0')}`;

    // Calculate expiry
    let expiresAt = null;
    if (attempt.exam.certificateTemplate?.validityPeriod > 0) {
        expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + attempt.exam.certificateTemplate.validityPeriod);
    }

    const certificate = new Certificate({
        certificateNumber: certNumber,
        exam: attempt.exam._id,
        user: attempt.user,
        attempt: attempt._id,
        expiresAt
    });

    await certificate.save();

    return certificate;
}

module.exports = {
    gradeAttempt,
    generateCertificate
};
