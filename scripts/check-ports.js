const net = require('net');

const host = '172.25.3.51';
const ports = [1433, 3306, 5432, 80, 8080, 8001, 9001, 7000, 4370];

async function checkPort(port) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.on('connect', () => {
      socket.destroy();
      resolve({ port, open: true });
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ port, open: false, error: 'TIMEOUT' });
    });
    socket.on('error', err => {
      socket.destroy();
      resolve({ port, open: false, error: err.message });
    });
    socket.connect(port, host);
  });
}

async function run() {
  console.log(`Checking open ports on ${host}...`);
  for (const p of ports) {
    const res = await checkPort(p);
    console.log(`  Port ${p}: ${res.open ? 'OPEN' : 'CLOSED (' + res.error + ')'}`);
  }
  process.exit(0);
}

run();
