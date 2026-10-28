const fs = require('fs');

const html = fs.readFileSync('scripts/page__frmTemplateHTSeries_aspx.html', 'utf8');

// Find all buttons, links, controls
const matches = [];
const regex = /<(\w+)[^>]*id=["']([^"']*)["'][^>]*>/gi;
let m;
while ((m = regex.exec(html)) !== null) {
  const tag = m[1];
  const id = m[2];
  if (id.includes('ContentPlaceHolder') || id.includes('btn') || id.includes('Grid')) {
    matches.push({ tag, id, full: m[0] });
  }
}

console.log('Interesting elements:');
matches.forEach(x => {
  if (!x.id.includes('DXDataRow') && !x.id.includes('DXEditor')) {
    console.log(`  <${x.tag} id="${x.id}">`);
  }
});

// Look for JavaScript functions in the page
const scriptBlocks = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
console.log('\nTotal scripts:', scriptBlocks.length);
scriptBlocks.forEach((s, idx) => {
  if (s.includes('Upload') || s.includes('Enroll') || s.includes('Click') || s.includes('function') && !s.includes('aspxAddHoverItems')) {
    // print snippet
    const lines = s.split('\n').filter(l => l.trim().startsWith('function') || l.includes('function') || l.includes('PerformCallback'));
    if (lines.length) {
      console.log(`\nScript ${idx} functions:`);
      lines.slice(0, 10).forEach(l => console.log('   ', l.trim()));
    }
  }
});
