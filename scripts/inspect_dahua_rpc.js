const http = require('http');

function fetch(path) {
  return new Promise(resolve => {
    http.get('http://172.25.26.241' + path, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', () => resolve(''));
  });
}

(async () => {
  const text = await fetch('/static/js/acs~a675ead9.f42872ab.chunk.js');
  const pos = text.indexOf('LoginAuthCtrl');
  if (pos !== -1) {
    console.log('--- Context around LoginAuthCtrl ---');
    console.log(text.slice(Math.max(0, pos - 400), pos + 600));
  }

  // Also search for JSON RPC or cgi-bin
  const cgiMatches = text.match(/\/cgi-bin\/[a-zA-Z0-9_\.]+/g) || [];
  console.log('CGI endpoints found:', [...new Set(cgiMatches)]);

  const rpcMatches = text.match(/method:\s*["'][^"']+["']/g) || [];
  console.log('RPC methods found:', [...new Set(rpcMatches)].slice(0, 30));

  process.exit(0);
})();
