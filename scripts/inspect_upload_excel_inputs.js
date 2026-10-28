const fs = require('fs');
const html = fs.readFileSync('./scripts/page__UploadExcel_aspx.html', 'utf8');
const allInputs = html.match(/<input[^>]+>/gi) || [];
allInputs.forEach(i => {
  if (!i.includes('__VIEWSTATE')) console.log(i);
});
