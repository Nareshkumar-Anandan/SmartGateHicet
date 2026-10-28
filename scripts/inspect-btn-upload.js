const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'page__DownloadUser_aspx.html'), 'utf8');

const regex = /<div[^>]*id=["']ContentPlaceHolder1_btnUpload["'][^>]*>[\s\S]*?<\/div>\s*<\/div>/i;
const m = html.match(regex);
console.log('Exact btnUpload div:');
console.log(m ? m[0] : 'not found');

// Also check createControl for btnUpload
const m2 = html.match(/ASPx\.createControl\(ASPxClientButton,\s*'ContentPlaceHolder1_btnUpload'[\s\S]*?\);/i);
console.log('Exact btnUpload createControl:');
console.log(m2 ? m2[0] : 'not found');
