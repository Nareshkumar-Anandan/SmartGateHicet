const service = require('../src/services/timewatchIdmsService');
const http = require('http');
const querystring = require('querystring');
const xlsx = require('xlsx');

async function getEnrolledUsersAll() {
  await service.login();

  try {
    console.log('[IDMS] Requesting full UserList Excel export from iDMS...');
    const initPage = await service._authenticatedGet('/UserList.aspx');
    const viewstate = (initPage.body.match(/id="__VIEWSTATE"\s+value="([^"]+)"/) || [])[1] || '';
    const viewstateGen = (initPage.body.match(/id="__VIEWSTATEGENERATOR"\s+value="([^"]+)"/) || [])[1] || '';
    const eventVal = (initPage.body.match(/id="__EVENTVALIDATION"\s+value="([^"]+)"/) || [])[1] || '';

    const postData = querystring.stringify({
      '__VIEWSTATE': viewstate,
      '__VIEWSTATEGENERATOR': viewstateGen,
      '__EVENTVALIDATION': eventVal,
      'ctl00$ContentPlaceHolder1$ASPxButton2': 'Export'
    });

    const buf = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: service.hostname,
        port: service.port,
        path: '/UserList.aspx',
        method: 'POST',
        headers: {
          'Cookie': service.sessionCookie,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 20000
      }, res => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Export failed with HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    // Check if buffer is valid XLSX (starts with PK)
    if (buf.length > 500 && buf[0] === 0x50 && buf[1] === 0x4B) {
      const workbook = xlsx.read(buf, { type: 'buffer' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = xlsx.utils.sheet_to_json(firstSheet);
      console.log(`[IDMS] Export parsed successfully: ${rawRows.length} rows.`);

      const usersMap = new Map();
      for (const row of rawRows) {
        const uid = String(row['User ID'] || '').trim();
        if (!uid || uid === 'ALL') continue;

        const sn = String(row['Device ID'] || '').trim();
        const model = String(row['Device Type'] || '').trim();
        let rawName = String(row['User Name'] || '').trim();
        const card = row['Card'] ? String(row['Card']).trim() : null;
        const hasFace = String(row['Face'] || '').toLowerCase().includes('yes');

        if (rawName === uid || /^\d+$/.test(rawName)) {
          rawName = '';
        }

        if (!usersMap.has(uid)) {
          usersMap.set(uid, {
            serialNumber: sn,
            model,
            userId: uid,
            name: rawName,
            card: card || null,
            hasFace,
            devices: sn ? [sn] : []
          });
        } else {
          const u = usersMap.get(uid);
          if (!u.name && rawName) u.name = rawName;
          if (!u.card && card) u.card = card;
          if (hasFace) u.hasFace = true;
          if (sn && !u.devices.includes(sn)) u.devices.push(sn);
        }
      }

      const userList = Array.from(usersMap.values());
      console.log(`[IDMS] Total unique enrolled users: ${userList.length}`);
      return userList;
    }
  } catch (err) {
    console.warn('[IDMS WARN] Excel export failed, falling back to HTML parsing:', err.message);
  }

  // Fallback to HTML
  return await service.getEnrolledUsers();
}

(async () => {
  const users = await getEnrolledUsersAll();
  console.log('Result user count:', users.length);
  console.log('First 5:', users.slice(0, 5));
  console.log('Last 5:', users.slice(-5));
  process.exit(0);
})();
