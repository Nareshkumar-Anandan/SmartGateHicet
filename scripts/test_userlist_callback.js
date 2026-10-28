const service = require('../src/services/timewatchIdmsService');
const http = require('http');
const querystring = require('querystring');

function parseGridHtml(html) {
  // Extract cells from table rows
  const rows = (html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [])
    .map(r => (r.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [])
      .map(c => c.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").trim())
    )
    .filter(cells => cells.length >= 4 && cells.some(c => /^TW\d{10,20}$/i.test(c)));

  return rows.map(c => ({
    device: c[0],
    model: c[1],
    userId: c[2],
    name: c[3],
    card: c[6] || ''
  }));
}

async function fetchPage(pageIndex, initPage) {
  if (pageIndex === 0) {
    return parseGridHtml(initPage.body);
  }

  const viewstate = (initPage.body.match(/id="__VIEWSTATE"\s+value="([^"]+)"/) || [])[1] || '';
  const viewstateGen = (initPage.body.match(/id="__VIEWSTATEGENERATOR"\s+value="([^"]+)"/) || [])[1] || '';
  const eventVal = (initPage.body.match(/id="__EVENTVALIDATION"\s+value="([^"]+)"/) || [])[1] || '';

  const callbackParam = `c0:KV|0;[];GB|20;12|PAGERONCLICK3|PN${pageIndex};`;

  const postData = querystring.stringify({
    '__CALLBACKID': 'ctl00$ContentPlaceHolder1$ASPxGridView1',
    '__CALLBACKPARAM': callbackParam,
    '__VIEWSTATE': viewstate,
    '__VIEWSTATEGENERATOR': viewstateGen,
    '__EVENTVALIDATION': eventVal
  });

  const res = await new Promise((resolve, reject) => {
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
      resp.on('end', () => resolve({ status: resp.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });

  return parseGridHtml(res.body);
}

(async () => {
  try {
    const initPage = await service._authenticatedGet('/UserList.aspx');
    const p1 = await fetchPage(0, initPage);
    console.log('Page 1 items count:', p1.length, 'Sample:', p1.slice(0, 3).map(u => `${u.userId} - ${u.name}`));

    const p2 = await fetchPage(1, initPage);
    console.log('Page 2 items count:', p2.length, 'Sample:', p2.slice(0, 3).map(u => `${u.userId} - ${u.name}`));

    const p3 = await fetchPage(2, initPage);
    console.log('Page 3 items count:', p3.length, 'Sample:', p3.slice(0, 3).map(u => `${u.userId} - ${u.name}`));

  } catch (e) {
    console.error('Error:', e.message);
  }
  process.exit(0);
})();
