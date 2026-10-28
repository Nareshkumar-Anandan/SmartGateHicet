const net = require('net');

const devices = [
  { lane: 'Lane 1', ip: '172.25.26.241' },
  { lane: 'Lane 2', ip: '172.25.26.242' },
  { lane: 'Lane 3', ip: '172.25.26.243' },
  { lane: 'Lane 4', ip: '172.25.26.244' },
  { lane: 'Lane 5', ip: '172.25.26.245' },
  { lane: 'Lane 6', ip: '172.25.26.246' },
  { lane: 'Lane 7', ip: '172.25.26.247' },
  { lane: 'Lane 8', ip: '172.25.26.248' }
];

const ports = [80, 4370, 8080, 5005, 7000];

async function check(ip, port) {
  return new Promise(resolve => {
    const s = new net.Socket();
    s.setTimeout(1500);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.on('error', () => { s.destroy(); resolve(false); });
    s.connect(port, ip);
  });
}

async function run() {
  console.log('Testing connectivity to 8 physical turnstiles...');
  for (const d of devices) {
    const results = [];
    for (const p of ports) {
      const open = await check(d.ip, p);
      if (open) results.push(p);
    }
    console.log(`  ${d.lane} (${d.ip}): ${results.length > 0 ? 'OPEN ports: ' + results.join(', ') : 'NO open ports found'}`);
  }
  process.exit(0);
}

run();
