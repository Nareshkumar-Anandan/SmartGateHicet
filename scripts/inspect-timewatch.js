const http = require('http');

function request(path, method = 'GET', postData = null, headers = {}) {
  return new Promise((resolve) => {
    const defaultHeaders = {
      ...headers
    };
    if (postData) {
      defaultHeaders['Content-Type'] = defaultHeaders['Content-Type'] || 'application/json';
      defaultHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request({
      hostname: '172.25.3.51',
      port: 9001,
      path,
      method,
      headers: defaultHeaders,
      timeout: 5000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          path,
          method,
          status: res.statusCode,
          headers: res.headers,
          bodySnippet: body.slice(0, 300)
        });
      });
    });

    req.on('error', (err) => resolve({ path, method, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ path, method, error: 'TIMEOUT' }); });
    if (postData) req.write(postData);
    req.end();
  });
}

async function main() {
  console.log('--- 1. Fetching Login.aspx Page ---');
  const root = await request('/Login.aspx');
  console.log('Status:', root.status);
  console.log('Headers:', root.headers);
  
  // Extract text and form fields
  const body = root.bodySnippet ? await new Promise(res => {
    let all = '';
    const req = http.request({ hostname: '172.25.3.51', port: 9001, path: '/Login.aspx' }, r => {
      r.on('data', c => all += c);
      r.on('end', () => res(all));
    });
    req.end();
  }) : '';

  console.log('Full body length:', body.length);
  const titleMatch = body.match(/<title>([^<]+)<\/title>/i);
  console.log('Title:', titleMatch ? titleMatch[1].trim() : 'N/A');

  const idMatches = body.match(/id="([^"]+)"/gi) || [];
  const uniqueIds = Array.from(new Set(idMatches.map(m => m.replace(/id="|"/gi, ''))));
  console.log('\nIDs on page:');
  uniqueIds.filter(id => !id.startsWith('dx')).forEach(id => console.log('  -', id));

  // Also check if any links or paths are mentioned
  const hrefs = body.match(/href="([^"]+)"/gi) || [];
  console.log('\nHrefs on page:');
  Array.from(new Set(hrefs)).slice(0, 20).forEach(h => console.log('  -', h));

  // Probe other potential iDMS/Timewatch pages and API ports/virtual applications
  console.log('\n--- 2. Checking iDMS Pages & Virtual Directories ---');
  const possiblePaths = [
    '/Login.aspx',
    '/Home.aspx',
    '/Dashboard.aspx',
    '/Main.aspx',
    '/Index.aspx',
    '/UserMaster.aspx',
    '/EmployeeMaster.aspx',
    '/DeviceStatus.aspx',
    '/RealTimeLogs.aspx',
    '/PunchLog.aspx',
    '/Attendance.aspx',
    '/AttLog.aspx',
    '/DBSetting.aspx',
    '/WebService.asmx',
    '/Api/User',
    '/Api/Device',
    '/idms',
    '/idms/Login.aspx',
    '/iDMS/TimeWatchAPI',
    '/TimeWatch',
    '/TimeWatch/Login.aspx',
    '/TimeWatchAPI/swagger'
  ];

  for (const p of possiblePaths) {
    const res = await request(p, 'GET');
    console.log(`GET ${p} -> ${res.status} [${res.headers['content-type'] || ''}]`);
  }
}

main();
