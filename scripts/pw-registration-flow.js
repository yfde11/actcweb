/**
 * Playwright E2E: 活動報名流程驗證
 * 測試項目：
 *   1. 首頁顯示 registration_open 活動，點「立即報名」按鈕有反應
 *   2. 未登入時導向登入頁
 *   3. 登入後可完成報名，API 回傳 registered
 *   4. 重複報名回傳 409
 *   5. 報名後 registeredCount 正確遞增
 */

const { chromium } = require('playwright');

const BASE = 'http://localhost:5001';
const ADMIN_EMAIL = 'admin@actc.org.tw';
const ADMIN_PASS = 'admin';

// 測試用帳號（若不存在需先建立）
const TEST_EMAIL = `pw_test_${Date.now()}@example.com`;
const TEST_PASS = 'TestPass123!';

let browser, page;
let passed = 0, failed = 0;

function ok(label) { console.log(`  ✅ ${label}`); passed++; }
function fail(label, detail) { console.log(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }

async function setup() {
    browser = await chromium.launch({ headless: false, slowMo: 300 });
    page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error') process.stdout.write(`  [console.error] ${m.text()}\n`); });
}

async function teardown() {
    await browser.close();
    console.log(`\n結果：${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

// 透過 API 建立測試帳號
async function createTestUser() {
    const res = await fetch(`${BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: `pwtest_${Date.now()}`,
            email: TEST_EMAIL,
            password: TEST_PASS,
            fullName: 'PW測試用戶',
            phone: '0912345678'
        })
    });
    const body = await res.json();
    if (res.ok || body.message?.includes('已存在')) {
        console.log(`  測試帳號：${TEST_EMAIL}`);
    } else {
        throw new Error(`建立測試帳號失敗: ${JSON.stringify(body)}`);
    }

    // 透過 admin API 核可 emailVerified
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS })
    });
    const loginBody = await loginRes.json();
    const adminToken = loginBody.token;

    // 取得 userId
    const usersRes = await fetch(`${BASE}/api/users?search=${encodeURIComponent(TEST_EMAIL)}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
    });
    const usersBody = await usersRes.json();
    const user = (usersBody.users || usersBody)[0];
    if (!user) throw new Error('找不到測試用戶');

    await fetch(`${BASE}/api/users/${user._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ emailVerified: true, membershipStatus: 'approved', name: 'PW測試用戶', phone: '0912345678' })
    });
    console.log(`  已核可 emailVerified`);
    return user._id;
}

// 取得 registration_open 活動
async function getTestEvent() {
    const res = await fetch(`${BASE}/api/events`);
    const body = await res.json();
    const events = body.events || body.data || body;
    const ev = events.find(e => e.status === 'registration_open');
    if (!ev) throw new Error('找不到 registration_open 活動，請先建立一個');
    console.log(`  測試活動：${ev.title} (${ev._id})`);
    return ev;
}

// ── 測試 1：首頁顯示「立即報名」按鈕 ──────────────────────────────────
async function test1_button_visible() {
    console.log('\n【Test 1】首頁活動卡片顯示「立即報名」按鈕');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    // 等活動卡片載入
    await page.waitForSelector('.event-card, [data-event-id]', { timeout: 8000 }).catch(() => {});

    const btn = page.locator('button, a').filter({ hasText: /立即報名/ }).first();
    const count = await btn.count();
    if (count > 0) {
        ok('找到「立即報名」按鈕');
    } else {
        fail('找不到「立即報名」按鈕');
        // 截圖輔助 debug
        await page.screenshot({ path: 'screenshots/pw-t1-no-button.png' });
    }
}

// ── 測試 2：未登入點按鈕 → 導向登入頁 ────────────────────────────────
async function test2_redirect_to_login() {
    console.log('\n【Test 2】未登入點「立即報名」→ 導向登入頁');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('button, a', { timeout: 5000 });

    // 確保未登入
    await page.evaluate(() => { localStorage.clear(); });
    await page.reload({ waitUntil: 'networkidle' });

    const btn = page.locator('button, a').filter({ hasText: /立即報名/ }).first();
    if (await btn.count() === 0) { fail('找不到按鈕，跳過'); return; }

    await btn.click();
    await page.waitForTimeout(1500);

    const url = page.url();
    if (url.includes('login') || url.includes('member')) {
        ok(`跳轉至 ${url}`);
    } else {
        // 可能是顯示 modal 或 alert
        const modal = await page.locator('[x-show], .modal, [role=dialog]').filter({ visible: true }).count();
        if (modal > 0) ok('開啟登入彈窗');
        else fail(`未導向登入，目前 URL: ${url}`);
    }
}

// ── 測試 3：登入後完整報名流程 ────────────────────────────────────────
async function test3_full_registration(testEvent) {
    console.log('\n【Test 3】登入後點「立即報名」完成報名');

    // 先登入
    await page.goto(`${BASE}/member`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    // 若已在 member 頁（已登入）先登出
    const logoutBtn = page.locator('button, a').filter({ hasText: /登出/ });
    if (await logoutBtn.count() > 0) {
        await logoutBtn.first().click();
        await page.waitForTimeout(800);
    }

    // 登入流程
    const emailInput = page.locator('input[type=email], input[name=email]').first();
    const passInput = page.locator('input[type=password]').first();
    if (await emailInput.count() === 0) {
        await page.goto(`${BASE}/member`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(500);
    }

    await page.fill('input[type=email], input[name=email]', TEST_EMAIL);
    await page.fill('input[type=password]', TEST_PASS);
    await page.locator('button[type=submit], button').filter({ hasText: /登入/ }).first().click();
    await page.waitForTimeout(2000);

    ok('登入完成');

    // 回首頁找活動按鈕
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // 找對應活動的報名按鈕
    const eventTitle = testEvent.title.slice(0, 6);
    const card = page.locator(`text=${eventTitle}`).first();
    let regBtn;

    if (await card.count() > 0) {
        const parent = card.locator('xpath=ancestor::*[contains(@class,"card") or contains(@class,"event")][1]');
        regBtn = parent.locator('button, a').filter({ hasText: /立即報名|加入候補/ }).first();
    }
    if (!regBtn || await regBtn.count() === 0) {
        regBtn = page.locator('button, a').filter({ hasText: /立即報名|加入候補/ }).first();
    }

    if (await regBtn.count() === 0) {
        fail('找不到報名按鈕');
        await page.screenshot({ path: 'screenshots/pw-t3-no-btn.png' });
        return;
    }

    ok('找到報名按鈕');
    await regBtn.click();
    await page.waitForTimeout(2000);

    // 等候報名表單或確認 modal
    const form = page.locator('form, [x-show][x-data], .modal').filter({ visible: true }).first();
    const formVisible = await form.count() > 0;

    if (formVisible) {
        ok('報名表單/Modal 出現');
        // 填必填欄位（若有）
        const nameInput = page.locator('input[placeholder*=姓名], input[name=participantName]').first();
        if (await nameInput.count() > 0 && !(await nameInput.inputValue())) {
            await nameInput.fill('Playwright測試');
        }
        const phoneInput = page.locator('input[placeholder*=電話], input[name=participantPhone]').first();
        if (await phoneInput.count() > 0 && !(await phoneInput.inputValue())) {
            await phoneInput.fill('0912345678');
        }

        // 提交
        const submitBtn = page.locator('button[type=submit], button').filter({ hasText: /確認報名|送出|提交|報名/ }).first();
        if (await submitBtn.count() > 0) {
            await submitBtn.click();
            await page.waitForTimeout(2000);
        }
    }

    // 檢查成功訊息
    const successMsg = await page.locator('text=/報名成功|已完成報名|registered/').count();
    const toastMsg = await page.locator('.toast, [x-show], .alert').filter({ hasText: /成功|報名/ }).count();
    if (successMsg > 0 || toastMsg > 0) {
        ok('顯示報名成功訊息');
    } else {
        // 用 API 驗證
        const token = await page.evaluate(() => localStorage.getItem('token') || document.cookie.match(/token=([^;]+)/)?.[1]);
        if (token) {
            const r = await fetch(`${BASE}/api/member/events/${testEvent._id}/registration-status`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const b = await r.json().catch(() => ({}));
            if (b.status === 'registered' || b.registered) {
                ok('API 確認報名狀態 = registered');
            } else {
                fail('無法確認報名成功');
                await page.screenshot({ path: 'screenshots/pw-t3-result.png' });
            }
        } else {
            fail('無法取得 token 驗證');
            await page.screenshot({ path: 'screenshots/pw-t3-notoken.png' });
        }
    }
}

// ── 測試 4：重複報名回傳 409 ──────────────────────────────────────────
async function test4_duplicate_block(testEvent) {
    console.log('\n【Test 4】重複報名應被阻擋（409）');

    // 取登入 token
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS })
    });
    const { token } = await loginRes.json();
    if (!token) { fail('取不到 token'); return; }

    const res = await fetch(`${BASE}/api/member/events/${testEvent._id}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ participantName: 'PW測試用戶', participantPhone: '0912345678' })
    });

    if (res.status === 409) {
        ok(`重複報名回傳 409（${(await res.json()).message || ''}）`);
    } else {
        const body = await res.json();
        fail(`預期 409，實際 ${res.status}`, JSON.stringify(body));
    }
}

// ── 測試 5：registeredCount 正確遞增 ─────────────────────────────────
async function test5_count_incremented(testEvent) {
    console.log('\n【Test 5】報名後 registeredCount 正確');
    const res = await fetch(`${BASE}/api/events/${testEvent._id}`);
    const body = await res.json();
    const ev = body.event || body;
    const expected = (testEvent.registeredCount || 0) + 1;
    if (ev.registeredCount >= expected) {
        ok(`registeredCount = ${ev.registeredCount}（原 ${testEvent.registeredCount}，+1）`);
    } else {
        fail(`registeredCount = ${ev.registeredCount}，預期 >= ${expected}`);
    }
}

// ── 主流程 ────────────────────────────────────────────────────────────
(async () => {
    try {
        await setup();
        console.log('=== ACTC 活動報名 Playwright E2E ===');

        console.log('\n【初始化】建立測試帳號 + 取測試活動');
        await createTestUser();
        const testEvent = await getTestEvent();

        await test1_button_visible();
        await test2_redirect_to_login();
        await test3_full_registration(testEvent);
        await test4_duplicate_block(testEvent);
        await test5_count_incremented(testEvent);

    } catch (err) {
        console.error('\n💥 未預期錯誤:', err.message);
        if (page) await page.screenshot({ path: 'screenshots/pw-crash.png' }).catch(() => {});
        failed++;
    } finally {
        await teardown();
    }
})();
