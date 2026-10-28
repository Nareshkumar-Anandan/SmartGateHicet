const http = require('http');

http.get('http://172.25.26.241/', res => {
  console.log('Status:', res.statusCode);
  console.log('Headers:', res.headers);
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log('Body preview:', d.slice(0, 500));
    process.exit(0);
  });
}).on('error', err => {
  console.error('Error:', err.message);
  process.exit(1);
});
