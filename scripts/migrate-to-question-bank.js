const mongoose = require('mongoose');
const Question = require('./models/Question');
const Exam = require('./models/Exam');
require('dotenv').config();

async function migrateToQuestionBank() {
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/actc');
        console.log('Connected to MongoDB');

        // 1. Add domain field to existing questions (default to 1 - Security and Risk Management)
        const questionsWithoutDomain = await Question.find({ domain: { $exists: false } });
        console.log(`Found ${questionsWithoutDomain.length} questions without domain`);

        for (const q of questionsWithoutDomain) {
            q.domain = 1; // Default to first CISSP domain
            await q.save();
        }
        console.log('Added domain field to existing questions');

        // 2. Initialize examIds array for questions that belong to exams
        const questionsWithExam = await Question.find({ exam: { $exists: true, $ne: null } });
        console.log(`Found ${questionsWithExam.length} questions with exam reference`);

        for (const q of questionsWithExam) {
            q.examIds = [q.exam];
            await q.save();

            // Update exam's questionRefs
            await Exam.findByIdAndUpdate(q.exam, { 
                $addToSet: { questionRefs: q._id },
                $set: { source: 'manual' }
            });
        }
        console.log('Initialized examIds and questionRefs');

        // 3. Set source to 'manual' for existing exams
        await Exam.updateMany(
            { source: { $exists: false } },
            { $set: { source: 'manual' } }
        );
        console.log('Set source for existing exams');

        // 4. Initialize domainRatio for existing exams based on their questions
        const exams = await Exam.find({ source: 'manual' });
        console.log(`Processing ${exams.length} exams for domainRatio`);

        for (const exam of exams) {
            const questions = await Question.find({ examIds: exam._id });
            if (questions.length > 0) {
                const domainCount = {};
                questions.forEach(q => {
                    if (q.domain) {
                        domainCount[q.domain] = (domainCount[q.domain] || 0) + 1;
                    }
                });

                const domainRatio = new Map();
                for (const [domain, count] of Object.entries(domainCount)) {
                    domainRatio.set(domain, (count / questions.length) * 100);
                }

                exam.domainRatio = domainRatio;
                exam.questionRefs = questions.map(q => q._id);
                exam.questionCount = questions.length;
                await exam.save();
            }
        }
        console.log('Initialized domainRatio for existing exams');

        // 5. Summary
        const totalQuestions = await Question.countDocuments();
        const questionsWithBank = await Question.countDocuments({ examIds: { $exists: true, $ne: [] } });
        const totalExams = await Exam.countDocuments();

        console.log('\n=== Migration Summary ===');
        console.log(`Total Questions: ${totalQuestions}`);
        console.log(`Questions in Bank: ${questionsWithBank}`);
        console.log(`Total Exams: ${totalExams}`);
        console.log('Migration completed successfully');

        process.exit(0);
    } catch (error) {
        console.error('Migration error:', error);
        process.exit(1);
    }
}

migrateToQuestionBank();
