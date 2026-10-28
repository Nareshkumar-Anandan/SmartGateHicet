const http = require('http');
const fs = require('fs');
const path = require('path');

function get(path, cookie = '') {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '172.25.3.51', port: 9001, path, headers: cookie ? { Cookie: cookie } : {} }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

function post(path, bodyStr, cookie = '') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '172.25.3.51',
      port: 9001,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...(cookie ? { Cookie: cookie } : {})
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: data,
        cookie: (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ')
      }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function extractVal(html, name) {
  const m = html.match(new RegExp(`name=["']${name}["'][^>]*value=["']([^"']*)["']`, 'i')) ||
            html.match(new RegExp(`value=["']([^"']*)["'][^>]*name=["']${name}["']`, 'i'));
  return m ? m[1] : '';
}

async function login() {
  const initial = await get('/Login.aspx');
  const cookie = initial.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
  const viewState = extractVal(initial.body, '__VIEWSTATE');
  const viewStateGen = extractVal(initial.body, '__VIEWSTATEGENERATOR');

  const params = new URLSearchParams();
  params.append('__EVENTTARGET', 'ctl00$ContentPlaceHolder1$ASPxRoundPanel1$btnLogin');
  params.append('__VIEWSTATE', viewState);
  if (viewStateGen) params.append('__VIEWSTATEGENERATOR', viewStateGen);
  params.append('ctl00$ContentPlaceHolder1$ASPxRoundPanel1$cboDeviceType', 'AI Series');
  params.append('ContentPlaceHolder1_ASPxRoundPanel1_cboDeviceType_VI', 'H');
  params.append('ctl00$ContentPlaceHolder1$ASPxRoundPanel1$txtuser', 'admin');
  params.append('ctl00$ContentPlaceHolder1$ASPxRoundPanel1$txtPassword', 'admin');

  const loginRes = await post('/Login.aspx', params.toString(), cookie);
  return loginRes.cookie || cookie;
}

async function run() {
  const authCookie = await login();

  const pagesToTest = ['/UserPhoto.aspx', '/UploadExcel.aspx', '/frmTemplateHTSeries.aspx', '/TemplateManagement.aspx', '/UserManage.aspx'];
  for (const pageName of pagesToTest) {
    console.log(`\n=================== ${pageName} ===================`);
    const page = await get(pageName, authCookie);
    console.log('Status:', page.status, 'Body length:', page.body.length);
    
    // Find text content and elements
    fs.writeFileSync(path.join(__dirname, `page_${pageName.replace(/[\/\.]/g, '_')}.html`), page.body);

    const matches = page.body.match(/<(input|button|select)[^>]+>/gi) || [];
    console.log(`Controls (${matches.length}):`);
    matches.forEach(m => {
      const type = (m.match(/type=["']([^"']+)["']/i) || [])[1] || '';
      const name = (m.match(/name=["']([^"']+)["']/i) || [])[1] || '';
      const id = (m.match(/id=["']([^"']+)["']/i) || [])[1] || '';
      const val = (m.match(/value=["']([^"']*)["']/i) || [])[1] || '';
      if (type !== 'hidden') {
        console.log(`  [${type}] name="${name}" id="${id}" val="${val}"`);
      }
    });

    // Check for DevExpress buttons or text
    const textSnippets = page.body.match(/dxbButton[^>]*>[\s\S]*?<\/div>/gi) || [];
    textSnippets.slice(0, 10).forEach(s => {
      console.log('  Button:', s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    });
  }
}

run().catch(console.error);
