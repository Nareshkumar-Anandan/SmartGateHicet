const fs = require('fs');

const html = fs.readFileSync('scripts/downloaduser_postback_result.html', 'utf8');

// Look for any text in spans with class dxeBase or error
const spans = html.match(/<span[^>]*>[\s\S]*?<\/span>/gi) || [];
spans.forEach(s => {
  const text = s.replace(/<[^>]+>/g, '').trim();
  if (text && (text.includes('Error') || text.includes('Invalid') || text.includes('Please') || text.includes('Required') || text.includes('*') || text.includes('Success') || text.includes('Upload'))) {
    console.log('Span:', text);
  }
});

// Check if any alert script was emitted
const alertScripts = html.match(/alert\([^)]+\)/gi) || [];
console.log('Alert scripts:', alertScripts);
