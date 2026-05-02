const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({ 
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  console.log('1. Navigate to admin page...');
  await page.goto('http://localhost:5001/admin', { waitUntil: 'networkidle2' });
  
  console.log('2. Login as admin...');
  // Wait for page to load
  await page.waitForSelector("body"); await page.evaluate(() => new Promise(r => setTimeout(r, (2000);
  
  // Take screenshot
  await page.screenshot({ path: '/tmp/01-login-page.png' });
  console.log('Screenshot: /tmp/01-login-page.png');
  
  // Try to find login form
  const html = await page.content();
  console.log('Page title:', await page.title());
  
  // Find input fields
  const inputs = await page.$$('input');
  console.log('Found', inputs.length, 'input fields');
  
  // Type credentials
  await page.type('input[type="text"], input[name="username"]', 'admin');
  await page.type('input[type="password"], input[name="password"]', 'admin123');
  
  // Click login button
  await page.click('button[type="submit"], button:has-text("登入")');
  await page.waitForNavigation({ waitUntil: 'networkidle2' });
  
  console.log('3. Login successful, URL:', page.url());
  await page.screenshot({ path: '/tmp/02-after-login.png' });
  
  // Click 題庫管理 tab
  console.log('4. Click 題庫管理 tab...');
  const tabs = await page.$$('button, [role="tab"]');
  for (let tab of tabs) {
    const text = await page.evaluate(el => el.textContent, tab);
    if (text.includes('題庫管理')) {
      await tab.click();
      break;
    }
  }
  
  await page.waitForSelector("body"); await page.evaluate(() => new Promise(r => setTimeout(r, (3000);
  await page.screenshot({ path: '/tmp/03-question-bank.png' });
  console.log('Screenshot: /tmp/03-question-bank.png');
  
  // Check questions
  const rows = await page.$$('tbody tr');
  console.log(`Found ${rows.length} question rows`);
  
  // Click 統計 button
  console.log('5. Click 統計 button...');
  const buttons = await page.$$('button');
  for (let btn of buttons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text.includes('統計')) {
      await btn.click();
      break;
    }
  }
  
  await page.waitForSelector("body"); await page.evaluate(() => new Promise(r => setTimeout(r, (1500);
  await page.screenshot({ path: '/tmp/04-statistics-modal.png' });
  console.log('Screenshot: /tmp/04-statistics-modal.png');
  
  // Check exam management
  console.log('6. Check exam management...');
  for (let tab of tabs) {
    const text = await page.evaluate(el => el.textContent, tab);
    if (text.includes('考試管理')) {
      await tab.click();
      break;
    }
  }
  
  await page.waitForSelector("body"); await page.evaluate(() => new Promise(r => setTimeout(r, (2000);
  await page.screenshot({ path: '/tmp/05-exam-management.png' });
  console.log('Screenshot: /tmp/05-exam-management.png');
  
  console.log('\n=== VERIFICATION COMPLETE ===');
  console.log('Check screenshots in /tmp/');
  
  await browser.close();
})();
