const http = require('http');

http.get('http://172.25.26.241/static/js/acs~4d4f626c.6da81452.chunk.js', res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    console.log('Downloaded JS chunk. Length:', data.length);
    const urls = data.match(/"\/[a-zA-Z0-9_\/]+"|'\/[a-zA-Z0-9_\/]+'/g) || [];
    const unique = [...new Set(urls)].filter(u => {
      const lower = u.toLowerCase();
      return lower.includes('user') || lower.includes('face') || lower.includes('person') || lower.includes('photo') || lower.includes('card') || lower.includes('cgi') || lower.includes('api') || lower.includes('access');
    });
    console.log('Interesting endpoints:', unique.slice(0, 50));
  });
}).on('error', console.error);
