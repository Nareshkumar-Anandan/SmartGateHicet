const http = require('http');

const chunks = [
  '/static/js/acs~4d4f626c.6da81452.chunk.js',
  '/static/js/acs~a675ead9.f42872ab.chunk.js',
  '/static/js/acs~be6e32c8.15c3cb78.chunk.js',
  '/static/js/acs~21833f8f.70700d5a.chunk.js',
  '/static/js/vendors~acs~883365ad.39e16dbc.chunk.js'
];

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
  for (const p of chunks) {
    const text = await fetch(p);
    console.log(`Downloaded ${p} (${text.length} bytes)`);
    
    // Search for RPC methods or door / open / relay
    const matches = text.match(/["'][a-zA-Z0-9_\.]*(?:open|door|relay|unlock|login|rpc)[a-zA-Z0-9_\.]*["']/gi) || [];
    console.log('  Matches count:', matches.length);
    console.log('  Sample matches:', [...new Set(matches)].slice(0, 20));
  }
  process.exit(0);
})();
