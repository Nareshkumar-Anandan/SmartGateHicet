const http = require('http');

http.get('http://172.25.26.241/', res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log(d);
    process.exit(0);
  });
});
