const http = require('http');

http.get('http://172.25.3.51:9001/webcam.js', res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log('webcam.js length:', d.length);
    console.log(d.slice(0, 500));
    // check snap function
    const snapIdx = d.indexOf('snap:');
    if (snapIdx !== -1) {
      console.log('snap function:', d.slice(snapIdx, snapIdx + 500));
    }
    process.exit(0);
  });
}).on('error', err => {
  console.error(err.message);
  process.exit(1);
});
