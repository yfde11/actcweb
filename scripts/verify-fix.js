const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ 
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  console.log('1. Navigate to admin page...');
  await page.goto('http://localhost:5001/admin', { waitUntil: 'networkidle2' });
  
  console.log('2. Login as admin...');
  await page.waitForSelector('input[placeholder="帳號"]');
  await page.type('input[placeholder="帳號"]', 'admin');
  await page.type('input[placeholder="密碼"]', 'admin123');
  
  // Click login button
  const buttons = await page.$$('button');
  for (let btn of buttons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text.includes('登入')) {
      await btn.click();
      break;
    }
  }
  
  await page.waitForNavigation({ waitUntil: 'networkidle2' });
  console.log('3. Login successful, current URL:', page.url());
  
  // Take screenshot
  await page.screenshot({ path: '/tmp/01-after-login.png' });
  console.log('Screenshot saved: /tmp/01-after-login.png');
  
  console.log('4. Looking for 題庫管理 tab...');
  const tabs = await page.$$('button');
  let foundQuestionBank = false;
  for (let tab of tabs) {
    const text = await page.evaluate(el => el.textContent, tab);
    if (text.includes('題庫管理')) {
      console.log('Found 題庫管理 tab, clicking...');
      await tab.click();
      foundQuestionBank = true;
      break;
    }
  }
  
  if (!foundQuestionBank) {
    console.log('ERROR: Could not find 題庫管理 tab');
    await browser.close();
    return;
  }
  
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/02-question-bank-tab.png' });
  console.log('Screenshot saved: /tmp/02-question-bank-tab.png');
  
  // Check if questions are displayed
  const questionRows = await page.$$('tbody tr');
  console.log(`Found ${questionRows.length} question rows`);
  
  // Check if statistics button exists
  const statButtons = await page.$$('button');
  let foundStatButton = false;
  for (let btn of statButtons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text.includes('統計')) {
      console.log('Found 統計 button, clicking...');
      await btn.click();
      foundStatButton = true;
      break;
    }
  }
  
  if (foundStatButton) {
    await page.waitForTimeout(1500);
    await page.screenshot({ path: '/tmp/03-statistics-modal.png' });
    console.log('Screenshot saved: /tmp/03-statistics-modal.png');
    
    // Close modal
    const closeButtons = await page.$$('button');
    for (let btn of closeButtons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.includes('關閉')) {
        await btn.click();
        break;
      }
    }
  }
  
  console.log('5. Switching to 考試管理 tab...');
  for (let tab of tabs) {
    const text = await page.evaluate(el => el.textContent, tab);
    if (text.includes('考試管理')) {
      await tab.click();
      break;
    }
  }
  
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/04-exam-management.png' });
  console.log('Screenshot saved: /tmp/04-exam-management.png');
  
  // Check if "排序题目" button exists (not the weird newQuestionNumber input)
  const hasReorderButton = await page.evaluate(() => {
    return document.body.innerHTML.includes('排序題目');
  });
  console.log(`Has "排序題目" button: ${hasReorderButton}`);
  
  console.log('\n=== VERIFICATION COMPLETE ===');
  console.log('Check screenshots in /tmp/');
  
  await browser.close();
})();
