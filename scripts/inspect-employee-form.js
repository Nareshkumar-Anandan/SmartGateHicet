const puppeteer = require('puppeteer-core');

async function inspect() {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const browser = await puppeteer.launch({
    executablePath: edgePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.goto('http://172.25.3.51:9001/Login.aspx');
  await page.type('#txtUsername', 'admin');
  await page.type('#txtPassword', 'admin');
  await page.click('#btnSubmit');
  await page.waitForNavigation();

  await page.goto('http://172.25.3.51:9001/Employee.aspx');
  await page.waitForSelector('#ContentPlaceHolder1_ASPxButton3', { timeout: 10000 });

  // Click Add to see all form fields
  await page.evaluate(() => {
    const addBtn = document.querySelector('[id*="DXCBtn0"]') || document.querySelector('img[title="New"]');
    if (addBtn) addBtn.click();
  });
  await new Promise(r => setTimeout(r, 2500));

  const formText = await page.evaluate(() => {
    const popup = document.querySelector('[id*="DXPEForm"]') || document.body;
    return popup.innerText;
  });
  console.log('--- Employee Edit Form Text ---');
  console.log(formText);

  const inputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input, select, textarea, div[id*="Upload"], div[id*="Photo"], img')).map(el => ({
      id: el.id,
      name: el.name,
      type: el.type,
      title: el.title,
      src: el.src
    })).filter(x => x.id || x.name || x.title);
  });
  
  const photoInputs = inputs.filter(x => 
    (x.id && (x.id.toLowerCase().includes('photo') || x.id.toLowerCase().includes('image') || x.id.toLowerCase().includes('pic') || x.id.toLowerCase().includes('file') || x.id.toLowerCase().includes('upload'))) || 
    (x.name && x.name.toLowerCase().includes('photo'))
  );
  console.log('--- Photo-related controls ---');
  console.log(JSON.stringify(photoInputs, null, 2));

  // Check buttons on Employee.aspx
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input[type="button"], input[type="submit"], a.dxbButton, div.dxbButton')).map(b => (b.innerText || b.value || b.id || '').trim()).filter(Boolean);
  });
  console.log('--- Buttons on Employee.aspx ---');
  console.log(buttons);

  await browser.close();
}

inspect().catch(console.error);
