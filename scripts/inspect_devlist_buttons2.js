const fs = require('fs');
const html = fs.readFileSync('scripts/page__DeviceListHTseries_aspx.html', 'utf8');

const btns = html.match(/<input[^>]*value="([^"]+)"[^>]*type="submit"[^>]*>/gi) || [];
console.log('--- Submit inputs ---');
btns.forEach(b => console.log(b));

const spans = html.match(/<span class="dx-vam">([^<]+)<\/span>/gi) || [];
console.log('--- Span labels ---');
spans.forEach(s => console.log(s));
