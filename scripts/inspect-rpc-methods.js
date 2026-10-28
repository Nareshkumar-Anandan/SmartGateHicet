const http = require('http');

function fetch(path) {
  return new Promise((resolve, reject) => {
    http.get('http://172.25.26.241' + path, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

async function run() {
  const html = await fetch('/');
  const scripts = [...html.matchAll(/src="([^"]+\.chunk\.js)"/g)].map(m => m[1]);
  const allMethods = new Set();
  for (const s of scripts) {
    try {
      const c = await fetch(s);
      const matches = c.match(/method:\s*['"]([a-zA-Z0-9_\.]+)['"]/gi) || [];
      matches.forEach(m => allMethods.add(m));
    } catch {}
  }
  console.log('All RPC methods found:', [...allMethods]);
}

run();
