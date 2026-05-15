/**
 * Concurrency test script for exam system (T3.3)
 * Tests parallel exam operations: start, submit, and save-progress.
 *
 * Requirements:
 *   - Node.js 18+ (uses built-in fetch)
 *   - Server running at BASE (default: http://localhost:5001)
 *   - Admin credentials: admin / admin
 *
 * Usage:
 *   node scripts/concurrency-exam-test.js [base-url]
 */

'use strict';

const BASE = process.argv[2] || 'http://localhost:5001';

// ── helpers ────────────────────────────────────────────────────────────────

async function apiCall(method, path, body, token) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' }
    };
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${BASE}${path}`, opts);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { _raw: text }; }
    return { status: res.status, ok: res.ok, body: json };
}

async function login(username, password) {
    const res = await apiCall('POST', '/api/auth/login', { username, password });
    if (!res.ok) throw new Error(`Login failed for ${username}: ${JSON.stringify(res.body)}`);
    return res.body.token;
}

async function loginMember(username, password) {
    const res = await apiCall('POST', '/api/auth/login', { username, password });
    if (!res.ok) throw new Error(`Login failed for ${username}: ${JSON.stringify(res.body)}`);
    return res.body.token;
}

// ── test runner ────────────────────────────────────────────────────────────

const results = [];

async function runTest(name, severity, fn) {
    try {
        await fn();
        console.log(`  [PASS] ${name}`);
        results.push({ name, passed: true, severity });
    } catch (e) {
        console.error(`  [FAIL] ${name}: ${e.message}`);
        results.push({ name, passed: false, severity, error: e.message });
    }
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

// ── setup helpers ──────────────────────────────────────────────────────────

async function ensureTestUser(adminToken, username) {
    // Try to create; ignore 400 "already exists"
    await apiCall('POST', '/api/users', {
        username,
        email: `${username}@concurrency-test.invalid`,
        fullName: `Concurrency Test ${username}`,
        role: 'user'
    }, adminToken);

    // Find the user to get their ID
    const listRes = await apiCall('GET', `/api/users?search=${username}`, null, adminToken);
    if (!listRes.ok) throw new Error(`Cannot list users: ${JSON.stringify(listRes.body)}`);
    const users = listRes.body.users || listRes.body.data || listRes.body;
    const user = Array.isArray(users) ? users.find(u => u.username === username) : null;
    if (!user) throw new Error(`Test user ${username} not found after creation`);

    // Approve membership so the user can take exams
    await apiCall('PUT', `/api/users/${user._id}`, { membershipStatus: 'approved' }, adminToken);

    return user._id;
}

async function findActiveExam(adminToken) {
    const res = await apiCall('GET', '/api/exams?status=active&page=1', null, adminToken);
    if (!res.ok) throw new Error(`Cannot list exams: ${JSON.stringify(res.body)}`);
    const exams = res.body.data || res.body;
    return Array.isArray(exams) && exams.length > 0 ? exams[0] : null;
}

// ── test scenarios ─────────────────────────────────────────────────────────

/**
 * Test 1 (HIGH): Two users start the same exam simultaneously.
 * Both should get a valid attempt (200) or a well-formed error — never a 500.
 */
async function testParallelStart(examId, token1, token2) {
    const path = `/api/member/exams/${examId}/start`;
    const [r1, r2] = await Promise.all([
        apiCall('POST', path, {}, token1),
        apiCall('POST', path, {}, token2)
    ]);

    assert(r1.status !== 500, `User1 parallel start returned 500: ${JSON.stringify(r1.body)}`);
    assert(r2.status !== 500, `User2 parallel start returned 500: ${JSON.stringify(r2.body)}`);

    // Both users should succeed (each has their own attempt slot)
    assert(r1.ok, `User1 start failed (${r1.status}): ${JSON.stringify(r1.body)}`);
    assert(r2.ok, `User2 start failed (${r2.status}): ${JSON.stringify(r2.body)}`);

    const attemptId1 = r1.body.data?.attemptId || r1.body.data?._id;
    const attemptId2 = r2.body.data?.attemptId || r2.body.data?._id;
    assert(attemptId1, `User1 response missing attemptId: ${JSON.stringify(r1.body)}`);
    assert(attemptId2, `User2 response missing attemptId: ${JSON.stringify(r2.body)}`);
    assert(attemptId1 !== attemptId2, 'Both users got the same attemptId — this should not happen');

    return { attemptId1, attemptId2 };
}

/**
 * Test 2 (HIGH): Same user submits the same attempt twice simultaneously.
 * Exactly one should succeed (200/201); the second must get 409 — not 500, not a duplicate grade.
 */
async function testParallelSubmit(examId, attemptId, token, questions) {
    const path = `/api/member/exams/${examId}/submit`;
    const payload = {
        attemptId,
        answers: questions.slice(0, 3).map((q, i) => ({
            questionId: q._id || q.questionId,
            questionNumber: i + 1,
            answer: 'A'
        })),
        timeSpent: 60,
        visibilityChangeCount: 0
    };

    const [r1, r2] = await Promise.all([
        apiCall('POST', path, payload, token),
        apiCall('POST', path, payload, token)
    ]);

    const statuses = [r1.status, r2.status].sort();
    assert(
        !statuses.includes(500),
        `Parallel submit produced a 500: r1=${r1.status} r2=${r2.status}`
    );

    const successCount = [r1, r2].filter(r => r.ok).length;
    const conflictCount = [r1, r2].filter(r => r.status === 409).length;

    assert(
        successCount === 1 && conflictCount === 1,
        `Expected 1 success + 1 conflict, got statuses ${r1.status} and ${r2.status}: ` +
        `r1=${JSON.stringify(r1.body)} r2=${JSON.stringify(r2.body)}`
    );
}

/**
 * Test 3 (MEDIUM): Rapid parallel save-progress calls for the same attempt.
 * All should succeed (idempotent) — no 500s, no data corruption.
 */
async function testParallelSaveProgress(examId, attemptId, token, questions) {
    const path = `/api/member/exams/${examId}/save-progress`;
    const makePayload = (answerVal) => ({
        attemptId,
        answers: questions.slice(0, 2).map((q, i) => ({
            questionId: q._id || q.questionId,
            questionNumber: i + 1,
            answer: answerVal
        }))
    });

    // Fire 5 concurrent save-progress calls with slightly different answers
    const calls = ['A', 'B', 'C', 'A', 'B'].map(v =>
        apiCall('PATCH', path, makePayload(v), token)
    );
    const results = await Promise.all(calls);

    const failures = results.filter(r => !r.ok);
    const server_errors = results.filter(r => r.status === 500);

    assert(server_errors.length === 0,
        `${server_errors.length} save-progress calls returned 500`);
    assert(failures.length === 0,
        `${failures.length}/${results.length} save-progress calls failed: ` +
        failures.map(r => `${r.status}:${JSON.stringify(r.body)}`).join(', '));
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
    console.log(`\nConcurrency exam test suite`);
    console.log(`Target: ${BASE}\n`);

    // ── Admin setup ──────────────────────────────────────────────────────
    let adminToken;
    try {
        adminToken = await login('admin', 'admin');
        console.log('[setup] Admin login OK');
    } catch (e) {
        console.error(`[setup] Cannot login as admin: ${e.message}`);
        console.error('[setup] Aborting — server may not be running or credentials changed');
        process.exit(2);
    }

    // ── Find active exam ─────────────────────────────────────────────────
    let exam;
    try {
        exam = await findActiveExam(adminToken);
    } catch (e) {
        console.warn(`[setup] Could not query exams: ${e.message}`);
    }

    if (!exam) {
        console.warn('[setup] No active exam found. Skipping all concurrency tests.');
        console.warn('[setup] To run these tests, activate an exam via PATCH /api/exams/:id/status');
        console.log('\nResult: 0/0 tests run (skipped — no active exam)\n');
        process.exit(0);
    }

    console.log(`[setup] Using exam: "${exam.title}" (${exam._id})`);

    // ── Create / ensure test users ────────────────────────────────────────
    let userId1, userId2;
    try {
        [userId1, userId2] = await Promise.all([
            ensureTestUser(adminToken, 'concurrency_test_u1'),
            ensureTestUser(adminToken, 'concurrency_test_u2')
        ]);
        console.log(`[setup] Test users ready: ${userId1}, ${userId2}`);
    } catch (e) {
        console.error(`[setup] Failed to create test users: ${e.message}`);
        process.exit(2);
    }

    // ── Login as test users ───────────────────────────────────────────────
    let token1, token2;
    try {
        [token1, token2] = await Promise.all([
            loginMember('concurrency_test_u1', 'user'),
            loginMember('concurrency_test_u2', 'user')
        ]);
        console.log('[setup] Test user logins OK\n');
    } catch (e) {
        console.error(`[setup] Test user login failed: ${e.message}`);
        process.exit(2);
    }

    // Fetch exam questions (needed for submit/save-progress payloads)
    const qRes = await apiCall('GET', `/api/exams/${exam._id}/questions?limit=10`, null, adminToken);
    const questions = qRes.ok ? (qRes.body.data || []) : [];
    if (questions.length === 0) {
        console.warn('[setup] Exam has no questions — submit/save-progress tests will use empty payloads');
    }

    // ── Test 1: Parallel start ────────────────────────────────────────────
    console.log('Test 1: Parallel start (two different users)');
    let attemptId1, attemptId2;
    await runTest(
        'Parallel start — both users succeed, no 500, distinct attemptIds',
        'HIGH',
        async () => {
            const ids = await testParallelStart(exam._id, token1, token2);
            attemptId1 = ids.attemptId1;
            attemptId2 = ids.attemptId2;
        }
    );

    // ── Test 2: Parallel submit ───────────────────────────────────────────
    console.log('\nTest 2: Parallel submit (same user, same attempt)');
    if (attemptId1) {
        await runTest(
            'Parallel submit — exactly one 200 and one 409, no 500',
            'HIGH',
            () => testParallelSubmit(exam._id, attemptId1, token1, questions)
        );
    } else {
        console.warn('  [SKIP] No attemptId from Test 1 — cannot run parallel submit test');
    }

    // ── Test 3: Parallel save-progress ───────────────────────────────────
    // Start a fresh attempt for user2 (their attempt from Test 1 is still in_progress)
    console.log('\nTest 3: Parallel save-progress (same attempt, rapid concurrent calls)');
    if (attemptId2) {
        await runTest(
            'Parallel save-progress — all 5 calls succeed, no 500',
            'MEDIUM',
            () => testParallelSaveProgress(exam._id, attemptId2, token2, questions)
        );
    } else {
        console.warn('  [SKIP] No attemptId from Test 1 — cannot run parallel save-progress test');
    }

    // ── Summary ───────────────────────────────────────────────────────────
    const total = results.length;
    const passed = results.filter(r => r.passed).length;
    const highFails = results.filter(r => !r.passed && r.severity === 'HIGH');

    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Results: ${passed}/${total} passed`);
    if (highFails.length > 0) {
        console.error(`\nHIGH-severity failures (${highFails.length}):`);
        highFails.forEach(r => console.error(`  - ${r.name}: ${r.error}`));
        console.error('\nExiting with code 1 due to HIGH-severity failures.');
        process.exit(1);
    }

    if (total > 0 && passed === total) {
        console.log('All concurrency tests passed.\n');
    }
}

main().catch(err => {
    console.error('Unhandled error in concurrency test:', err);
    process.exit(2);
});
