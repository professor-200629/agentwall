// Runs one small action on the app's 2D page (the start page), for emulator checks.
// AGENTWALL_PAGE = '{"do":"file","selector":"#cal-file","path":"C:/…/x.ics"}'
//               | '{"do":"eval","code":"document.title"}'
//               | '{"do":"click","selector":"#cal-sample"}'
//               | '{"do":"fill","selector":"#cal-guest","value":"Priya"}'
export default async function run({ page, frame }) {
  const target = frame ?? page;
  const a = JSON.parse(process.env.AGENTWALL_PAGE ?? '{"do":"eval","code":"document.title"}');
  if (a.do === 'file') {
    await target.locator(a.selector).setInputFiles(a.path);
    return 'file set';
  }
  if (a.do === 'click') {
    await target.locator(a.selector).click();
    return 'clicked';
  }
  if (a.do === 'fill') {
    await target.locator(a.selector).fill(a.value);
    return 'filled';
  }
  if (a.do === 'open') {
    await target.evaluate((sel) => {
      const d = document.querySelector(sel);
      if (d) d.open = true;
    }, a.selector);
    return 'opened';
  }
  // eslint-disable-next-line no-new-func
  return await target.evaluate((code) => new Function(`return (${code})`)(), a.code);
}
