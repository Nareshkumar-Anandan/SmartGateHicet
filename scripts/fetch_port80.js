const http = require('http');

http.get('http://172.25.3.51/', res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log(d);
    process.exit(0);
  });
});
