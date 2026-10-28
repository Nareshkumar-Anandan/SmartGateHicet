const net = require('net');

const s = new net.Socket();
s.setTimeout(3000);

s.on('connect', () => {
  console.log('Connected to 172.25.26.242:5000');
  // Send newline or probe
  s.write('\r\n');
});

s.on('data', data => {
  console.log('Received raw:', data);
  console.log('Received hex:', data.toString('hex'));
  console.log('Received ascii:', data.toString('ascii'));
});

s.on('timeout', () => {
  console.log('Timeout');
  s.destroy();
  process.exit(0);
});

s.on('error', err => {
  console.log('Error:', err.message);
  process.exit(1);
});

s.on('close', () => {
  console.log('Closed');
  process.exit(0);
});

s.connect(5000, '172.25.26.242');
