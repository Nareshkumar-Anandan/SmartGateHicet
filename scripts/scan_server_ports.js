const net = require('net');

const ports = [1433, 1434, 3306, 5432, 1521, 80, 8080, 9000, 9001, 8000, 8001];

(async () => {
  for (const port of ports) {
    await new Promise(resolve => {
      const socket = new net.Socket();
      socket.setTimeout(400);
      socket.once('connect', () => {
        console.log(`[OPEN] 172.25.3.51:${port}`);
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
      socket.connect(port, '172.25.3.51');
    });
  }
  console.log('Port scan on 172.25.3.51 complete');
  process.exit(0);
})();
