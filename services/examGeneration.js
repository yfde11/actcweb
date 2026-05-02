const Question = require('../models/Question');
const Exam = require('../models/Exam');

/**
 * Generate random questions from question bank based on domain ratio
 * @param {Object} params - Generation parameters
 * @param {string} params.title - Exam title
 * @param {string} params.description - Exam description
 * @param {number} params.questionsPerAttempt - Total questions to generate
 * @param {Object} params.domainRatio - Domain ratio (e.g., {1: 15, 2: 10, ...})
 * @param {number} params.timeLimit - Time limit in minutes
 * @param {number} params.passingScore - Passing score percentage
 * @param {string} params.examType - 'quiz' or 'certification'
 * @param {Object} params.certificateTemplate - Certificate template config
 * @param {string} params.createdBy - User ID
 * @returns {Object} Generated exam object
 */
async function generateExamFromBank(params) {
    const {
        title,
        description,
        questionsPerAttempt,
        domainRatio,
        timeLimit = 0,
        passingScore = 70,
        examType = 'quiz',
        certificateTemplate,
        createdBy
    } = params;

    if (!title || !questionsPerAttempt || !domainRatio) {
        throw new Error('Missing required parameters for exam generation');
    }

    // Calculate questions per domain based on ratio
    const domainQuestions = {};
    let totalRatio = 0;
    
    for (const [domain, ratio] of Object.entries(domainRatio)) {
        totalRatio += ratio;
    }

    // Normalize ratios to ensure they sum to 100
    const normalizedRatio = {};
    for (const [domain, ratio] of Object.entries(domainRatio)) {
        normalizedRatio[domain] = (ratio / totalRatio) * 100;
    }

    // Calculate number of questions per domain
    for (const [domain, percentage] of Object.entries(normalizedRatio)) {
        const count = Math.round((percentage / 100) * questionsPerAttempt);
        if (count > 0) {
            domainQuestions[domain] = count;
        }
    }

    // Adjust total to match questionsPerAttempt
    const currentTotal = Object.values(domainQuestions).reduce((a, b) => a + b, 0);
    if (currentTotal < questionsPerAttempt) {
        // Add remaining to domain with highest ratio
        const maxDomain = Object.entries(normalizedRatio)
            .sort((a, b) => b[1] - a[1])[0][0];
        domainQuestions[maxDomain] = (domainQuestions[maxDomain] || 0) + (questionsPerAttempt - currentTotal);
    } else if (currentTotal > questionsPerAttempt) {
        // Remove excess from domain with lowest ratio
        const minDomain = Object.entries(normalizedRatio)
            .sort((a, b) => a[1] - b[1])[0][0];
        domainQuestions[minDomain] = Math.max(0, domainQuestions[minDomain] - (currentTotal - questionsPerAttempt));
    }

    // Fetch random questions for each domain
    const selectedQuestionIds = [];
    
    for (const [domain, count] of Object.entries(domainQuestions)) {
        const questions = await Question.aggregate([
            {
                $match: {
                    domain: parseInt(domain),
                    $or: [
                        { examIds: { $exists: false } },
                        { examIds: { $size: 0 } }
                    ]
                }
            },
            { $sample: { size: count } }
        ]);

        if (questions.length < count) {
            console.warn(`Domain ${domain}: Only ${questions.length} questions available, requested ${count}`);
        }

        selectedQuestionIds.push(...questions.map(q => q._id));
    }

    if (selectedQuestionIds.length === 0) {
        throw new Error('No questions available in the question bank');
    }

    // Create exam
    const exam = new Exam({
        title,
        description,
        questionsPerAttempt: selectedQuestionIds.length,
        timeLimit,
        passingScore,
        examType,
        certificateEnabled: examType === 'certification',
        certificateTemplate,
        source: 'question_bank',
        domainRatio: new Map(Object.entries(domainRatio)),
        questionRefs: selectedQuestionIds,
        questionCount: selectedQuestionIds.length,
        createdBy
    });

    await exam.save();

    // Update questions with examId
    await Question.updateMany(
        { _id: { $in: selectedQuestionIds } },
        { $addToSet: { examIds: exam._id } }
    );

    return exam;
}

/**
 * Generate exam with manually selected questions
 * @param {Object} params - Generation parameters
 * @param {string} params.title - Exam title
 * @param {string} params.description - Exam description
 * @param {Array} params.questionIds - Array of question IDs
 * @param {number} params.timeLimit - Time limit in minutes
 * @param {number} params.passingScore - Passing score percentage
 * @param {string} params.examType - 'quiz' or 'certification'
 * @param {Object} params.certificateTemplate - Certificate template config
 * @param {string} params.createdBy - User ID
 * @returns {Object} Generated exam object
 */
async function generateExamManual(params) {
    const {
        title,
        description,
        questionIds,
        timeLimit = 0,
        passingScore = 70,
        examType = 'quiz',
        certificateTemplate,
        createdBy
    } = params;

    if (!title || !questionIds || questionIds.length === 0) {
        throw new Error('Missing required parameters for manual exam generation');
    }

    // Validate questions exist
    const questions = await Question.find({ _id: { $in: questionIds } });
    if (questions.length !== questionIds.length) {
        throw new Error('Some questions were not found');
    }

    // Calculate domain distribution
    const domainDistribution = {};
    questions.forEach(q => {
        if (q.domain) {
            domainDistribution[q.domain] = (domainDistribution[q.domain] || 0) + 1;
        }
    });

    // Create exam
    const exam = new Exam({
        title,
        description,
        questionsPerAttempt: questionIds.length,
        timeLimit,
        passingScore,
        examType,
        certificateEnabled: examType === 'certification',
        certificateTemplate,
        source: 'question_bank',
        domainRatio: new Map(Object.entries(domainDistribution).map(([k, v]) => 
            [k, (v / questionIds.length) * 100]
        )),
        questionRefs: questionIds,
        questionCount: questionIds.length,
        createdBy
    });

    await exam.save();

    // Update questions with examId
    await Question.updateMany(
        { _id: { $in: questionIds } },
        { $addToSet: { examIds: exam._id } }
    );

    return exam;
}

module.exports = {
    generateExamFromBank,
    generateExamManual
};
