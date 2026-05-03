const express = require('express');
const mongoose = require('mongoose');
const ExamAttempt = require('../models/ExamAttempt');
const Exam = require('../models/Exam');
const ExamGrading = require('../services/examGrading');

const router = express.Router();

// Cron secret and IP whitelist from env
const CRON_SECRET = process.env.CRON_SECRET || 'your-cron-secret-here';
const ALLOWED_IPS = (process.env.CRON_ALLOWED_IPS || '127.0.0.1').split(',').map(ip => ip.trim());

// Middleware to validate cron request
function validateCronRequest(req, res, next) {
    // Check X-Cron-Secret header
    const secret = req.header('X-Cron-Secret');
    if (!secret || secret !== CRON_SECRET) {
        return res.status(403).json({ error: { code: 'INVALID_CRON_SECRET', message: 'Invalid cron secret' } });
    }

    // Check IP whitelist
    const clientIP = req.ip || req.connection.remoteAddress;
    const normalizedIP = clientIP?.replace(/^::ffff:/, '') || clientIP;
    
    if (!ALLOWED_IPS.includes(normalizedIP)) {
        return res.status(403).json({ error: { code: 'IP_NOT_ALLOWED', message: 'IP not allowed' } });
    }

    next();
}

// POST /api/cron/expired-attempts - auto-submit expired attempts
router.post('/expired-attempts', validateCronRequest, async (req, res) => {
    try {
        const now = new Date();
        
        // Find expired in_progress attempts
        const expiredAttempts = await ExamAttempt.find({
            status: 'in_progress',
            expiresAt: { $lt: now }
        }).populate('exam');

        let processed = 0;
        let errors = 0;

        for (const attempt of expiredAttempts) {
            try {
                // Guard: skip grading if referenced exam was deleted
                if (!attempt.exam) {
                    console.warn(`[cron] expired-attempts: attempt ${attempt._id} has null exam reference, marking expired without grading`);
                    attempt.status = 'expired';
                    attempt.submittedAt = attempt.expiresAt;
                    attempt.timeSpent = Math.floor((attempt.expiresAt - attempt.startedAt) / 1000);
                    await attempt.save();
                    processed++;
                    continue;
                }

                // Mark as expired
                attempt.status = 'expired';
                attempt.submittedAt = attempt.expiresAt;
                attempt.timeSpent = Math.floor((attempt.expiresAt - attempt.startedAt) / 1000);

                // Auto-grade if exam allows (expired attempts can still be graded)
                if (attempt.answers && attempt.answers.length > 0) {
                    attempt.status = 'submitted';
                    await attempt.save();

                    // Trigger grading
                    try {
                        await ExamGrading.gradeAttempt(attempt._id);
                    } catch (gradeError) {
                        console.error(`Grade error for attempt ${attempt._id}:`, gradeError.message);
                    }
                } else {
                    await attempt.save();
                }

                processed++;
            } catch (error) {
                console.error(`Process attempt ${attempt._id} error:`, error);
                errors++;
            }
        }

        res.json({
            message: 'Expired attempts processed',
            processed,
            errors,
            total: expiredAttempts.length
        });
    } catch (error) {
        console.error('Cron expired-attempts error:', error);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '伺服器錯誤' } });
    }
});

// POST /api/cron/close-expired-exams - auto-close expired exams
router.post('/close-expired-exams', validateCronRequest, async (req, res) => {
    try {
        const now = new Date();
        
        // Find active exams past endDate
        const expiredExams = await Exam.find({
            status: 'active',
            endDate: { $lt: now }
        });

        let processed = 0;
        for (const exam of expiredExams) {
            try {
                exam.status = 'closed';
                await exam.save();
                processed++;
            } catch (error) {
                console.error(`Close exam ${exam._id} error:`, error);
            }
        }

        res.json({
            message: 'Expired exams closed',
            processed,
            total: expiredExams.length
        });
    } catch (error) {
        console.error('Cron close-expired-exams error:', error);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '伺服器錯誤' } });
    }
});

// POST /api/cron/cleanup-orphaned-files - cleanup orphaned uploads (placeholder)
router.post('/cleanup-orphaned-files', validateCronRequest, async (req, res) => {
    try {
        // Placeholder: Implement file cleanup logic
        // Scan uploads directory, compare with DB records, delete orphans
        
        res.json({
            message: 'Orphaned files cleanup completed',
            cleaned: 0
        });
    } catch (error) {
        console.error('Cron cleanup-orphaned-files error:', error);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '伺服器錯誤' } });
    }
});

module.exports = router;
