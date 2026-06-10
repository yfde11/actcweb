# Playwright Test: profile-required-fields feature

You are a QA engineer testing a Node.js/Express web app at http://localhost:5001.
The app uses Alpine.js for its frontend. Always wait for Alpine to initialise before interacting with forms.

## Setup
- Use playwright with chromium (headless: false is fine, but headless: true is preferred for CI)
- Screenshots directory: /Users/msxiao/mxproject/actcweb/screenshots/
- All screenshots must be saved with descriptive names as listed per test below

## Pre-flight: check server
First verify the server is up:
```
curl -s http://localhost:5001/ | head -20
```
If the server is not running, start it:
```
cd /Users/msxiao/mxproject/actcweb && npm run dev &
sleep 5
```

## Tests to run

### T1 – Registration missing fullName
URL: http://localhost:5001/member#register
Steps:
1. Navigate to the page, wait for Alpine init (wait for selector `#register form`)
2. Fill in username with `testuser_t1_<timestamp>`
3. Fill in email with `t1_<timestamp>@test.com`
4. Fill in password with `Password123`
5. Leave fullName empty
6. Fill in phone with `0912345678`
7. Click the submit button
8. Wait for the error message element (role=status with aria-live=polite, inside #register) to appear
9. Assert the error message contains `姓名`
10. Take screenshot: screenshots/t1-reg-missing-fullname.png

Expected: Error message visible containing text about 姓名

### T2 – Registration missing phone
URL: http://localhost:5001/member#register
Steps:
1. Navigate to page, wait for Alpine init
2. Fill username `testuser_t2_<timestamp>`, email `t2_<timestamp>@test.com`, password `Password123`
3. Fill fullName with `測試用戶`
4. Leave phone empty
5. Click submit
6. Wait for error message in #register
7. Assert error message contains `電話`
8. Take screenshot: screenshots/t2-reg-missing-phone.png

Expected: Error message visible containing text about 電話

### T3 – Registration success with all fields
URL: http://localhost:5001/member#register
Steps:
1. Navigate to page, wait for Alpine init
2. Fill: username=`testuser_t3_<timestamp>`, email=`t3_<timestamp>@test.com`, password=`Password123`, fullName=`測試完整用戶`, phone=`0912345678`
3. Click submit
4. Wait up to 5s for success message (green text in #register)
5. Assert message contains `帳號已建立` or `註冊成功`
6. Take screenshot: screenshots/t3-reg-success.png

Expected: Green success message visible

### T4 – Event registration with incomplete profile (PROFILE_INCOMPLETE gate)
This test uses the API directly since we need a logged-in user without fullName/phone.
Steps:
1. First create a test user via API (POST /api/auth/register) with fullName and phone
2. Then manually update the user to remove fullName and phone via direct API calls if possible, OR
   alternatively: call POST /api/member/events/:eventId/register with a JWT token belonging to a user
   that has incomplete profile.

Simpler approach — use the API layer directly:
1. Register user `t4user_<timestamp>` with email, password, fullName=`T4 User`, phone=`0911111111`
2. Login via POST /api/auth/login to get JWT token
3. GET /api/events to find any event ID (take the first one if any)
4. If no events exist: skip T4 and note "no events available for test"
5. POST /api/member/events/<eventId>/register with Authorization: Bearer <token>
   But this user has fullName/phone, so we need to test the gate differently.

Alternative approach — test the API directly with a crafted scenario:
Since we cannot easily strip fields from an existing verified user via API, test this via:
1. Check the API endpoint code behavior by calling with missing profile fields
2. Use page-level test: log in as a user who lacks fullName/phone

For this test, use page automation:
1. Navigate to http://localhost:5001/member#login
2. Login as admin/admin
3. Clear the profile fields: navigate to #profile (actually the account tab)
4. In the profile form, clear the fullName and phone inputs, then save
5. Navigate to http://localhost:5001 (main page)
6. Find any visible event registration button and click it
7. Expect either: redirect to /member#profile OR an error message containing `個人資料`
8. Take screenshot: screenshots/t4-event-reg-incomplete-profile.png

Expected: Error or redirect when trying to register for event with incomplete profile

### T5 – Profile page orange banner when pendingRegistration exists and profile incomplete
URL: http://localhost:5001/member
Steps:
1. Navigate to http://localhost:5001/member#login
2. Login as admin/admin  
3. Clear profile: navigate to account tab, clear fullName and phone fields, click save/sync
4. Open browser console / use page.evaluate to set: localStorage.setItem('pendingRegistration', '1')
5. Navigate to http://localhost:5001/member#profile (this should navigate to the account tab)
   Note: the account tab in member/index.html is triggered by hash #profile via Alpine init or URL hash handling.
   Actually navigate to http://localhost:5001/member and then click the 帳號設定 tab.
6. Wait for the orange banner element to be visible:
   Selector: `[x-show="hasPendingRegistration && !profileComplete"]` or look for the text `請填寫姓名及電話後儲存`
7. Assert the orange banner is visible (has text `請填寫姓名及電話後儲存，即可返回活動頁面完成報名`)
8. Take screenshot: screenshots/t5-profile-orange-banner.png

Expected: Orange banner visible with instruction to fill name and phone

### T6 – Profile page green banner when pendingRegistration exists and profile complete
URL: http://localhost:5001/member
Steps:
1. Navigate to http://localhost:5001/member#login
2. Login as admin/admin
3. Navigate to account tab
4. Fill fullName with `Admin User Complete` and phone with `0912345678`
5. Click the 立即同步 button or wait for auto-save
6. Set localStorage.pendingRegistration = '1' via page.evaluate
7. Reload or re-navigate to the account tab
8. Wait for the green banner element to be visible:
   Selector: look for element with class `bg-green-50` containing text `個人資料已完整`
9. Assert green banner is visible with text `個人資料已完整！請前往活動頁面完成報名。`
10. Take screenshot: screenshots/t6-profile-green-banner.png

Expected: Green banner visible with link to events page

## Output format
For each test, output:
- Test ID and name
- Steps executed
- Actual result (what you observed)
- Pass / Fail
- Screenshot path

After all tests, print a summary table.

## Important notes
- The Alpine.js app uses x-cloak on elements that should be hidden initially. Use `waitForFunction` to wait for Alpine to remove x-cloak.
- Page hash navigation: After navigating to /member, wait for the Alpine app to initialize before interacting.
- The profile/account tab is labeled `帳號設定` in the tab bar.
- Timestamps should be generated as Date.now() in JavaScript.
- If MongoDB is unreachable, note this and skip API-dependent tests.

## Node.js Playwright script structure
Write a single Node.js script using @playwright/test or raw playwright. Save it to /Users/msxiao/mxproject/actcweb/scripts/test-profile-required-fields-playwright.js and run it.

Use this pattern:
```js
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:5001';
const SCREENSHOTS = '/Users/msxiao/mxproject/actcweb/screenshots';
const results = [];

async function run() {
  const browser = await chromium.launch({ headless: true });
  // ... tests
  await browser.close();
  
  // Print summary
  console.log('\n=== TEST SUMMARY ===');
  results.forEach(r => {
    console.log(`[${r.pass ? 'PASS' : 'FAIL'}] ${r.id}: ${r.name}`);
    if (!r.pass) console.log(`  Error: ${r.error}`);
  });
}

run().catch(console.error);
```
