const http = require('http');

http.get('http://172.25.26.241/', (res) => {
  console.log('Status code:', res.statusCode);
  console.log('Headers:', res.headers);
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Body length:', data.length);
    console.log('Body sample:', data.slice(0, 500));
  });
}).on('error', err => {
  console.error('Error connecting to turnstile HTTP:', err.message);
});
