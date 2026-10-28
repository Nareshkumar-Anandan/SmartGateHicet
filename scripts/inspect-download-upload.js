const fs = require('fs');
const b = fs.readFileSync('backend/scripts/page__DownloadUser_aspx.html', 'utf8');
console.log('File length:', b.length);
const matches = b.match(/<[^>]*upload[^>]*>/gi) || [];
console.log('Upload matches count:', matches.length);
matches.forEach(m => console.log('  ', m));
