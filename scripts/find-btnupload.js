const fs = require('fs');
const html = fs.readFileSync('scripts/page__DownloadUser_aspx.html', 'utf8');
const allIdx = [];
let i = -1;
while ((i = html.indexOf('ContentPlaceHolder1_btnUpload', i + 1)) !== -1) {
  allIdx.push(i);
}
console.log('Matches at indices:', allIdx);
allIdx.forEach((idx, n) => {
  console.log(`\n--- Match ${n} ---`);
  console.log(html.slice(Math.max(0, idx - 100), idx + 300));
});
