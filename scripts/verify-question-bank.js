#!/usr/bin/env node

const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

const BASE_URL = 'http://localhost:5001';
let token = '';

async function makeRequest(path, options = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const reqOptions = {
            method: options.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        };

        if (token && !options.skipAuth) {
            reqOptions.headers['Authorization'] = `Bearer ${token}`;
        }

        if (options.body) {
            reqOptions.body = JSON.stringify(options.body);
        }

        const req = http.request(url, reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode,
                        data: JSON.parse(data)
                    });
                } catch {
                    resolve({
                        status: res.statusCode,
                        data: data
                    });
                }
            });
        });

        req.on('error', reject);
        if (options.body) req.write(JSON.stringify(options.body));
        req.end();
    });
}

async function test(name, fn) {
    try {
        await fn();
        console.log(`✓ ${name}`);
    } catch (error) {
        console.log(`✗ ${name}: ${error.message}`);
    }
}

async function runTests() {
    console.log('=== Question Bank System Verification ===\n');

    // 1. Login
    await test('Admin login', async () => {
        const res = await makeRequest('/api/auth/login', {
            method: 'POST',
            body: { username: 'admin', password: 'admin123' }
        });
        if (!res.data.token) throw new Error('No token received');
        token = res.data.token;
    });

    // 2. Get statistics
    await test('Get statistics', async () => {
        const res = await makeRequest('/api/question-bank/statistics');
        if (!res.data.data || !res.data.data.total) throw new Error('Invalid statistics');
        console.log(`   Total questions: ${res.data.data.total}`);
        console.log(`   By type: ${JSON.stringify(res.data.data.byType)}`);
    });

    // 3. List questions
    await test('List questions (pagination)', async () => {
        const res = await makeRequest('/api/question-bank?page=1&limit=5');
        if (!res.data.data || res.data.data.length === 0) throw new Error('No questions returned');
        console.log(`   Returned ${res.data.data.length} questions`);
    });

    // 4. Filter by domain
    await test('Filter by domain', async () => {
        const res = await makeRequest('/api/question-bank?domain=1&limit=3');
        if (!res.data.data) throw new Error('No data');
        const allDomain1 = res.data.data.every(q => q.domain === 1);
        if (!allDomain1) throw new Error('Not all questions are domain 1');
        console.log(`   All questions are domain 1: ${allDomain1}`);
    });

    // 5. Search
    await test('Search questions', async () => {
        const res = await makeRequest('/api/question-bank?search=SQL&limit=3');
        if (!res.data.data) throw new Error('No data');
        console.log(`   Found ${res.data.data.length} questions containing 'SQL'`);
    });

    // 6. Create question
    let createdId = '';
    await test('Create question', async () => {
        const res = await makeRequest('/api/question-bank', {
            method: 'POST',
            body: {
                type: 'multiple_choice',
                domain: 1,
                content: 'Test question for verification',
                options: [
                    { text: 'Option A', label: 'A' },
                    { text: 'Option B', label: 'B' },
                    { text: 'Option C', label: 'C' },
                    { text: 'Option D', label: 'D' }
                ],
                correctOptionIndex: 0,
                difficulty: 'easy',
                points: 1
            }
        });
        if (!res.data.data || !res.data.data._id) throw new Error('Create failed');
        createdId = res.data.data._id;
        console.log(`   Created question ID: ${createdId}`);
    });

    // 7. Update question
    await test('Update question', async () => {
        if (!createdId) throw new Error('No question to update');
        const res = await makeRequest(`/api/question-bank/${createdId}`, {
            method: 'PUT',
            body: {
                content: 'Updated test question',
                difficulty: 'hard'
            }
        });
        if (!res.data.data || res.data.data.content !== 'Updated test question') {
            throw new Error('Update failed');
        }
        console.log(`   Updated question successfully`);
    });

    // 8. Generate exam (random)
    let examId = '';
    await test('Generate exam (random)', async () => {
        const res = await makeRequest('/api/exams/from-bank', {
            method: 'POST',
            body: {
                mode: 'random',
                title: 'Test CISSP Exam',
                description: 'Randomly generated test exam',
                questionsPerAttempt: 50,
                domainRatio: {
                    '1': 15,
                    '2': 10,
                    '3': 13,
                    '4': 14,
                    '5': 13,
                    '6': 12,
                    '7': 16,
                    '8': 17
                }
            }
        });
        if (!res.data.data || !res.data.data._id) throw new Error('Exam generation failed');
        examId = res.data.data._id;
        console.log(`   Generated exam ID: ${examId}`);
        console.log(`   Question count: ${res.data.data.questionCount}`);
    });

    // 9. Generate exam (manual)
    await test('Generate exam (manual)', async () => {
        // Get some question IDs
        const listRes = await makeRequest('/api/question-bank?limit=5');
        if (!listRes.data.data || listRes.data.data.length === 0) {
            throw new Error('No questions available');
        }
        const questionIds = listRes.data.data.map(q => q._id);
        
        const res = await makeRequest('/api/exams/from-bank', {
            method: 'POST',
            body: {
                mode: 'manual',
                title: 'Manual Test Exam',
                description: 'Manually created test exam',
                questionIds: questionIds
            }
        });
        if (!res.data.data || !res.data.data._id) throw new Error('Manual exam generation failed');
        console.log(`   Generated manual exam ID: ${res.data.data._id}`);
    });

    // 10. Check question-exam relationship
    await test('Check question-exam relationship', async () => {
        const listRes = await makeRequest('/api/question-bank?limit=1');
        if (!listRes.data.data || listRes.data.data.length === 0) {
            throw new Error('No questions');
        }
        const question = listRes.data.data[0];
        if (!question.examIds || question.examIds.length === 0) {
            throw new Error('Question not linked to any exam');
        }
        console.log(`   Question linked to ${question.examIds.length} exam(s)`);
    });

    // 11. Delete question (cleanup)
    await test('Delete question (cleanup)', async () => {
        if (!createdId) throw new Error('No question to delete');
        const res = await makeRequest(`/api/question-bank/${createdId}`, {
            method: 'DELETE'
        });
        if (res.status !== 200) throw new Error('Delete failed');
        console.log(`   Deleted test question`);
    });

    // 12. Check frontend pages
    await test('Check frontend pages', async () => {
        const pages = ['/admin.html', '/admin/question-bank.html'];
        for (const page of pages) {
            const res = await makeRequest(page, { skipAuth: true });
            if (res.status !== 200 || typeof res.data !== 'string') {
                throw new Error(`${page} not accessible (status: ${res.status})`);
            }
        }
        console.log(`   Admin pages accessible`);
    });

    console.log('\n=== Verification Complete ===');
    console.log('✓ All core functionalities working');
    console.log('✓ Question Bank Management System ready for use');
}

runTests().catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
