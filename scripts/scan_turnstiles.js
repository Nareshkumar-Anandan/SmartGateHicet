const net = require('net');

const ips = ['172.25.26.241', '172.25.26.242'];
const ports = [80, 8080, 4370, 5005, 8000, 8001, 8088, 9000, 9001];

(async () => {
  for (const ip of ips) {
    for (const port of ports) {
      await new Promise(resolve => {
        const socket = new net.Socket();
        socket.setTimeout(400);
        socket.once('connect', () => {
          console.log(`[OPEN] ${ip}:${port}`);
          socket.destroy();
          resolve();
        });
        socket.once('timeout', () => {
          socket.destroy();
          resolve();
        });
        socket.once('error', () => {
          socket.destroy();
          resolve();
        });
        socket.connect(port, ip);
      });
    }
  }
  console.log('Port scan complete');
  process.exit(0);
})();
