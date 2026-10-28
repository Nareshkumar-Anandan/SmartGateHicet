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
  for (const s of scripts) {
    const c = await fetch(s);
    if (c.includes('Device SN') || c.includes('Forgot password') || c.includes('Password')) {
      console.log('Found login chunk:', s);
      const postUrls = c.match(/url:\s*['"]([^'"]+)['"]/gi) ||
                       c.match(/post\(['"]([^'"]+)['"]/gi) ||
                       c.match(/\/action\/[a-zA-Z0-9_\/]+/gi) ||
                       c.match(/\/api\/[a-zA-Z0-9_\/]+/gi);
      console.log('URLs in login chunk:', [...new Set(postUrls)]);
      
      const snippet = c.match(/[\s\S]{0,100}(?:login|auth)[\s\S]{0,200}/gi) || [];
      console.log('Snippets:', snippet.slice(0, 5));
    }
  }
}

run();
