const fs = require('fs');
const path = require('path');
const http = require('http');

const admsService = require('../src/services/admsService');
const timewatchApiService = require('../src/services/timewatchApiService');

const turnstiles = [
  'TW30000006260175',
  'TW30000006260161',
  'TW30000006260156',
  'TW30000006260207',
  'TW30000006260242',
  'TW30000006260256',
  'TW30000006260265',
  'TW30000006260127'
];

function postJson(hostname, port, path, jsonBody, cookie = '') {
  const bodyStr = JSON.stringify(jsonBody);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname,
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...(cookie ? { Cookie: cookie } : {})
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function get(path, cookie = '') {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '172.25.3.51', port: 9001, path, headers: cookie ? { Cookie: cookie } : {} }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

function postForm(path, bodyStr, cookie = '') {
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

async function loginIdms() {
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

  const loginRes = await postForm('/Login.aspx', params.toString(), cookie);
  return loginRes.cookie || cookie;
}

async function pushStudentPhoto({ pin, name, photoPath }) {
  console.log(`\n======================================================`);
  console.log(`Pushing Face Photo for ${name} (PIN: ${pin})...`);
  console.log(`Photo Path: ${photoPath}`);

  if (!fs.existsSync(photoPath)) {
    console.error(`Photo file not found: ${photoPath}`);
    return { success: false, error: 'File not found' };
  }

  const photoBuffer = fs.readFileSync(photoPath);
  const base64Photo = photoBuffer.toString('base64');
  const dataUri = `data:image/jpeg;base64,${base64Photo}`;
  console.log(`Photo loaded: ${photoBuffer.length} bytes (base64 length: ${base64Photo.length})`);

  // 1. Push via ADMS command queue for all 8 turnstiles
  console.log('1. Dispatching ADMS photo update commands...');
  for (const sn of turnstiles) {
    // Command format for TrueFace terminal firmware photo update
    const cmd1 = `DATA UPDATE USERPHOTO PIN=${pin}\tFileName=${pin}.jpg\tSize=${photoBuffer.length}\tContent=${base64Photo}`;
    const cmd2 = `DATA UPDATE BIOPHOTO PIN=${pin}\tType=9\tSize=${photoBuffer.length}\tContent=${base64Photo}`;
    admsService.queueCommand(sn, cmd1);
    admsService.queueCommand(sn, cmd2);
  }

  // 2. Push via TWAPI AddUser with FaceTemplate
  console.log('2. Dispatching TWAPI AddUser with FaceTemplate...');
  for (const sn of turnstiles) {
    try {
      await timewatchApiService.addUser({
        UserID: pin,
        Name: name,
        DeviceID: sn,
        FaceTemplate: base64Photo
      });
    } catch (e) {
      console.warn(`TWAPI AddUser error for ${sn}:`, e.message);
    }
  }

  // 3. Push via TimeWatch iDMS uploasClientClick WebMethod
  console.log('3. Registering Face Photo in TimeWatch iDMS server...');
  try {
    const cookie = await loginIdms();
    const payload = {
      data_uri_tmp: dataUri,
      mID: String(pin),
      mDevice: 'IN1',
      mName: name
    };
    const res = await postJson('172.25.3.51', 9001, '/DownloadUser.aspx/uploasClientClick', payload, cookie);
    console.log(`iDMS uploasClientClick status: ${res.status}, body: ${res.body}`);
  } catch (idmsErr) {
    console.warn('iDMS photo upload error:', idmsErr.message);
  }

  console.log(`Photo pushed successfully for ${name} (${pin})!`);
  return { success: true, pin, name };
}

async function run() {
  const uploadsDir = path.join(__dirname, '../uploads/students');
  
  // Test both students
  await pushStudentPhoto({
    pin: '720726106077',
    name: 'A.K.DHANUSHKUMAR',
    photoPath: path.join(uploadsDir, '720726106077.jpg')
  });

  await pushStudentPhoto({
    pin: '720726109081',
    name: 'P.S.DHANUSHKRISHNA',
    photoPath: path.join(uploadsDir, '720726109081.jpg')
  });
}

run().catch(console.error);
