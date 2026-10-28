const fs = require('fs');
const html = fs.readFileSync('scripts/page__DeviceCommand_aspx.html', 'utf8');

const ths = html.match(/<td[^>]*class="dxgvHeader[^"]*"[^>]*>([\s\S]*?)<\/td>/gi) || [];
console.log('Headers:', ths.map(t => t.replace(/<[^>]+>/g, '').trim()).filter(Boolean));

const btns = html.match(/<input[^>]*value="([^"]+)"[^>]*>/gi) || [];
console.log('Buttons/Inputs:', btns);

const selects = html.match(/<select[\s\S]*?<\/select>/gi) || [];
console.log('Select elements:', selects.length);

// Check if there are any command dropdowns or action buttons
const aspxCombos = html.match(/ASPxClientComboBox[\s\S]*?\);/gi) || [];
console.log('Combos:', aspxCombos.length);
aspxCombos.forEach(c => {
  const m = c.match(/'(ContentPlaceHolder1_[^']+)'/);
  console.log('  Combo:', m ? m[1] : 'unknown');
});
