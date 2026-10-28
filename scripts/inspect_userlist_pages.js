const service = require('../src/services/timewatchIdmsService');
const fs = require('fs');

(async () => {
  try {
    const page = await service._authenticatedGet('/UserList.aspx');
    fs.writeFileSync('scripts/userlist_debug.html', page.body);
    console.log('Saved userlist_debug.html, length:', page.body.length);

    // Look for grid name
    const gridMatches = page.body.match(/ASPxClientGridView\s*,\s*['"]([^'"]+)['"]/g) || [];
    console.log('Grid matches:', gridMatches);

    // Look for pager info
    const pagerMatches = page.body.match(/Page \d+ of \d+ \(\d+ items\)/gi) || [];
    console.log('Pager matches:', pagerMatches);

    // Look for DevExpress Callback params
    const cbMatches = page.body.match(/dxCallback|__CALLBACKID|__CALLBACKPARAM/gi) || [];
    console.log('Callback keys:', cbMatches);

    // Look for form action, VIEWSTATE
    const viewstate = (page.body.match(/id="__VIEWSTATE"\s+value="([^"]+)"/) || [])[1];
    console.log('ViewState length:', viewstate ? viewstate.length : 0);

  } catch (err) {
    console.error('Error:', err.message);
  }
  process.exit(0);
})();
