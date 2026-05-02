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
  await page.waitForSelector('input');
  const inputs = await page.$$('input');
  console.log('Found', inputs.length, 'input fields');
  
  // Type credentials
  await page.type('input[type="text"], input[placeholder*="帳"]', 'admin');
  await page.type('input[type="password"], input[placeholder*="密"]', 'admin123');
  
  // Click login
  await page.click('button');
  await page.waitForNavigation({ waitUntil: 'networkidle2' });
  
  console.log('3. Login successful, URL:', page.url());
  await page.screenshot({ path: '/tmp/01-after-login.png' });
  
  // Click 題庫管理 tab
  console.log('4. Click 題庫管理 tab...');
  await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (let btn of buttons) {
      if (btn.textContent.includes('題庫管理')) {
        btn.click();
        break;
      }
    }
  });
  
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: '/tmp/02-question-bank.png' });
  console.log('Screenshot: /tmp/02-question-bank.png');
  
  // Check questions
  const rowCount = await page.evaluate(() => {
    return document.querySelectorAll('tbody tr').length;
  });
  console.log(`Found ${rowCount} question rows`);
  
  // Click 統計 button
  console.log('5. Click 統計 button...');
  await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (let btn of buttons) {
      if (btn.textContent.includes('統計')) {
        btn.click();
        break;
      }
    }
  });
  
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: '/tmp/03-statistics-modal.png' });
  console.log('Screenshot: /tmp/03-statistics-modal.png');
  
  // Close modal
  await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (let btn of buttons) {
      if (btn.textContent.includes('關閉')) {
        btn.click();
        break;
      }
    }
  });
  
  // Click 考試管理 tab
  console.log('6. Check exam management...');
  await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (let btn of buttons) {
      if (btn.textContent.includes('考試管理')) {
        btn.click();
        break;
      }
    }
  });
  
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: '/tmp/04-exam-management.png' });
  console.log('Screenshot: /tmp/04-exam-management.png');
  
  // Check if "排序題目" button exists
  const hasReorderBtn = await page.evaluate(() => {
    return document.body.innerHTML.includes('排序題目');
  });
  console.log(`Has "排序題目" button: ${hasReorderBtn}`);
  
  console.log('\n=== VERIFICATION COMPLETE ===');
  console.log('Check screenshots in /tmp/');
  
  await browser.close();
})();
