const net = require('net');

const s = new net.Socket();
s.setTimeout(3000);

s.on('connect', () => {
  console.log('Connected to 172.25.26.242:37777');
  s.write(Buffer.from([0xa0, 0x00, 0x00, 0x60, 0x00, 0x00, 0x00, 0x00])); // Dahua DHAV handshake
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

s.connect(37777, '172.25.26.242');
