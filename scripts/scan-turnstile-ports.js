const net = require('net');

const host = '172.25.26.241';
const ports = [80, 443, 8080, 8000, 37777, 4370, 5005, 8888, 9001, 8088];

async function scan() {
  for (const port of ports) {
    await new Promise(resolve => {
      const socket = new net.Socket();
      socket.setTimeout(800);
      socket.on('connect', () => {
        console.log(`Port ${port} is OPEN on ${host}!`);
        socket.destroy();
        resolve();
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', () => {
        resolve();
      });
      socket.connect(port, host);
    });
  }
  console.log('Port scan complete.');
}

scan();
