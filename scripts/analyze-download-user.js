const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'page__DownloadUser_aspx.html'), 'utf8');

// Find all controls with ID
const ids = html.match(/id=["']ContentPlaceHolder1_[^"']+["']/g) || [];
console.log('DownloadUser Controls:\n', [...new Set(ids.map(i => i.replace(/id=["']|["']/g, '')))]);

// Find all inputs, buttons, img, scripts
const inputs = html.match(/<(input|button|select|img)[^>]+>/gi) || [];
console.log('\nInputs / Buttons / Images count:', inputs.length);
inputs.forEach(i => {
  const type = (i.match(/type=["']([^"']+)["']/i) || [])[1] || '';
  const id = (i.match(/id=["']([^"']+)["']/i) || [])[1] || '';
  const val = (i.match(/value=["']([^"']*)["']/i) || [])[1] || '';
  const src = (i.match(/src=["']([^"']*)["']/i) || [])[1] || '';
  if (type !== 'hidden' || id.includes('Image') || id.includes('Photo') || id.includes('Upload')) {
    console.log(`  [${type}] id="${id}" val="${val}" src="${src}"`);
  }
});
