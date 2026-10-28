const puppeteer = require('puppeteer-core');
const svc = require('../src/services/timewatchIdmsService');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: svc._getEdgeExecutable(),
    headless: 'new',
    args: ['--no-sandbox']
  });

  const page = await browser.newPage();
  await page.goto('http://172.25.26.241', { waitUntil: 'networkidle0' });

  // Type password
  const testPass = 'T!meW@tch#123@';
  console.log('Testing password:', testPass);

  const pwdSelector = 'input[type="password"]';
  await page.waitForSelector(pwdSelector);
  await page.type(pwdSelector, testPass);

  // Click login
  await page.click('button[type="submit"]');
  await new Promise(r => setTimeout(r, 2000));

  const url = page.url();
  console.log('Current URL after login:', url);

  const errTip = await page.evaluate(() => {
    const el = document.querySelector('.ant-form-explain, .ant-message, .error, [role="alert"]');
    return el ? el.innerText : null;
  });
  console.log('Error tip:', errTip);

  await page.screenshot({ path: 'scripts/after_login_attempt.png' });
  await browser.close();
  process.exit(0);
})();
