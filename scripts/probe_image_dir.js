const http = require('http');

const files = [
  '/Image/',
  '/Image/1.jpg',
  '/Image/2.jpg',
  '/Image/4.jpg',
  '/Image/8.jpg',
  '/Image/124.jpg',
  '/Image/shyam.jpg',
  '/Image/720826105011.jpg'
];

async function check() {
  for (const f of files) {
    await new Promise(resolve => {
      http.get(`http://172.25.3.51:9001${f}`, res => {
        console.log(f, '->', res.statusCode, res.headers['content-type'] || '', res.headers['content-length'] || '');
        resolve();
      }).on('error', err => {
        console.log(f, '-> Error:', err.message);
        resolve();
      });
    });
  }
}

check();
