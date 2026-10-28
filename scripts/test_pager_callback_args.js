const service = require('../src/services/timewatchIdmsService');
const http = require('http');
const querystring = require('querystring');

async function testCallback(param) {
  const initPage = await service._authenticatedGet('/UserList.aspx');
  const viewstate = (initPage.body.match(/id="__VIEWSTATE"\s+value="([^"]+)"/) || [])[1] || '';
  const viewstateGen = (initPage.body.match(/id="__VIEWSTATEGENERATOR"\s+value="([^"]+)"/) || [])[1] || '';
  const eventVal = (initPage.body.match(/id="__EVENTVALIDATION"\s+value="([^"]+)"/) || [])[1] || '';

  const postData = querystring.stringify({
    '__CALLBACKID': 'ctl00$ContentPlaceHolder1$ASPxGridView1',
    '__CALLBACKPARAM': param,
    '__VIEWSTATE': viewstate,
    '__VIEWSTATEGENERATOR': viewstateGen,
    '__EVENTVALIDATION': eventVal
  });

  return new Promise((resolve) => {
    const req = http.request({
      hostname: '172.25.3.51',
      port: 9001,
      path: '/UserList.aspx',
      method: 'POST',
      headers: {
        'Cookie': service.sessionCookie,
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        'Content-Length': Buffer.byteLength(postData),
        'X-Requested-With': 'XMLHttpRequest'
      },
      timeout: 10000
    }, resp => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => resolve({ status: resp.statusCode, length: data.length, body: data }));
    });
    req.on('error', e => resolve({ error: e.message }));
    req.write(postData);
    req.end();
  });
}

(async () => {
  const candidates = [
    'c0:PAGERONCLICK|PN1',
    'c0:PAGERONCLICK|-1',
    'c0:KV|0;[];GB|17;12|PAGERONCLICK3|PN1;',
    'c0:KV|0;[];GB|16;12|PAGERONCLICK2|-1;',
    'c0:KV|0;[];GB|17;12|PAGERONCLICK3|-1;',
    'c0:KV|0;[];GB|14;9|PAGESIZE3|-1;',
    'c0:KV|0;[];GB|14;9|PAGESIZE3|500;',
    'c0:KV|0;[];GB|17;12|PAGERONCLICK|PN1;',
    'PAGERONCLICK|PN1',
    'PAGERONCLICK|-1',
    'c0:KV|0;[];PAGERONCLICK|PN1',
    'c0:KV|0;[];PAGERONCLICK|-1'
  ];

  for (const c of candidates) {
    const res = await testCallback(c);
    const rows = (res.body || '').match(/ContentPlaceHolder1_ASPxGridView1_DXDataRow/g) || [];
    const pager = (res.body || '').match(/Page \d+ of \d+ \(\d+ items\)/i);
    const isError = (res.body || '').includes('DXCallbackError') || (res.body || '').includes('DXScript');
    console.log(`Param: ${c} -> Status: ${res.status}, Length: ${res.length}, Rows: ${rows.length}, Pager: ${pager ? pager[0] : 'none'}, Error: ${isError}`);
  }
  process.exit(0);
})();
