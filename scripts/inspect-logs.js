const http = require('http');

function get(path, cookie = '') {
  return new Promise((resolve, reject) => {
    const headers = cookie ? { 'Cookie': cookie } : {};
    http.get({ hostname: '172.25.3.51', port: 9001, path, headers }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

function post(path, bodyStr, cookie = '') {
  return new Promise((resolve, reject) => {
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(bodyStr)
    };
    if (cookie) headers['Cookie'] = cookie;

    const req = http.request({ hostname: '172.25.3.51', port: 9001, path, method: 'POST', headers }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const setCookie = res.headers['set-cookie'];
        let updatedCookie = cookie;
        if (setCookie) {
          const added = setCookie.map(c => c.split(';')[0]).join('; ');
          updatedCookie = cookie ? `${cookie}; ${added}` : added;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: data, cookie: updatedCookie });
      });
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

async function inspectLogsAndUsers() {
  const initial = await get('/Login.aspx');
  const cookie = initial.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
  const viewState = extractVal(initial.body, '__VIEWSTATE');
  const viewStateGen = extractVal(initial.body, '__VIEWSTATEGENERATOR');

  const params = new URLSearchParams();
  params.append('__EVENTTARGET', 'ctl00$ContentPlaceHolder1$ASPxRoundPanel1$btnLogin');
  params.append('__EVENTARGUMENT', '');
  params.append('__VIEWSTATE', viewState);
  if (viewStateGen) params.append('__VIEWSTATEGENERATOR', viewStateGen);
  params.append('ctl00$ContentPlaceHolder1$ASPxRoundPanel1$cboDeviceType', 'AI Series');
  params.append('ContentPlaceHolder1_ASPxRoundPanel1_cboDeviceType_VI', 'H');
  params.append('ctl00$ContentPlaceHolder1$ASPxRoundPanel1$txtuser', 'admin');
  params.append('ctl00$ContentPlaceHolder1$ASPxRoundPanel1$txtPassword', 'admin');

  const loginRes = await post('/Login.aspx', params.toString(), cookie);
  const authCookie = loginRes.cookie || cookie;

  // 1. Check RealTimeLog.aspx
  console.log('--- 1. RealTimeLog.aspx ---');
  const realTime = await get('/RealTimeLog.aspx', authCookie);
  console.log('RealTimeLog length:', realTime.body.length);
  const logRows = (realTime.body.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [])
    .map(r => (r.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [])
      .map(c => c.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim())
      .filter(Boolean)
    )
    .filter(cells => cells.length > 2);

  console.log('Sample Log Rows in RealTimeLog:');
  console.log(logRows.slice(0, 10));

  // 2. Check Employee.aspx
  console.log('\n--- 2. Employee.aspx ---');
  const emp = await get('/Employee.aspx', authCookie);
  console.log('Employee.aspx length:', emp.body.length);
  const empRows = (emp.body.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [])
    .map(r => (r.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [])
      .map(c => c.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim())
      .filter(Boolean)
    )
    .filter(cells => cells.length > 2);
  console.log('Sample Employee Rows:');
  console.log(empRows.slice(0, 10));

  // 3. Check ParallelDB.aspx
  console.log('\n--- 3. ParallelDB.aspx (Database Details) ---');
  const pdb = await get('/ParallelDB.aspx', authCookie);
  const pdbInputs = [...pdb.body.matchAll(/name=["']([^"']+)["'][^>]*value=["']([^"']*)["']/gi)]
    .map(m => `${m[1]} = ${m[2]}`);
  console.log('ParallelDB settings:');
  pdbInputs.forEach(i => console.log('  ', i));

  process.exit(0);
}

inspectLogsAndUsers().catch(err => {
  console.error(err);
  process.exit(1);
});
