// Emulator checks for "your own calendar" and the "Approved by you" list.
// Needs the dev server:  npx iwsdk dev up --headless --allow-browser-automation
// Usage: node scripts/emu/real-calendar.mjs
// It imports a made-up .ics through the start page's real file box (no network),
// plans on it, approves with a real emulated pinch-and-hold, and reads the page.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = 'node_modules/@iwsdk/cli/dist/cli.js';
function cli(args, input) {
  const full = [CLI, ...args];
  if (input !== undefined) full.push('--input-json', JSON.stringify(input));
  const out = execFileSync(process.execPath, full, { encoding: 'utf8', timeout: 90_000 });
  const json = JSON.parse(out);
  if (json.ok === false) throw new Error(`${args.join(' ')} failed: ${JSON.stringify(json.error?.message ?? json)}`);
  return json.data;
}
const xr = (action, input = {}) => cli(['xr', action], input);
function hook(fn, ...args) {
  process.env.AGENTWALL_CALL = JSON.stringify({ fn, args });
  return cli(['browser', 'run', 'scripts/emu/call.mjs']).result;
}
function page(action) {
  process.env.AGENTWALL_PAGE = JSON.stringify(action);
  return cli(['browser', 'run', 'scripts/emu/page.mjs']).result;
}
const evalPage = (code) => page({ do: 'eval', code });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const shot = (name) => {
  try {
    console.log(`      shot ${name}: ${cli(['browser', 'screenshot'], {}).screenshotPath}`);
  } catch (e) {
    console.log(`      shot ${name} failed: ${e.message.slice(0, 100)}`);
  }
};

// ---------- a made-up calendar for the next working days ----------
const pad = (n) => String(n).padStart(2, '0');
const days = [];
for (const d = new Date(); days.length < 5; d.setDate(d.getDate() + 1)) {
  if (d.getDay() !== 0 && d.getDay() !== 6) days.push(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
}
const utc = (day, h, mi = 0) => {
  const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, mi);
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}00Z`;
};
const ev = (uid, day, h1, m1, h2, m2, title, extra = []) =>
  ['BEGIN:VEVENT', `UID:${uid}`, `DTSTART:${utc(day, h1, m1)}`, `DTEND:${utc(day, h2, m2)}`, `SUMMARY:${title}`, ...extra, 'END:VEVENT'].join('\r\n');
const ics = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//agentwall test//EN',
  // Day 1 is full. Later days are busy 9:00-15:00, and from day 2 a repeat sits at 16:00-16:30.
  ...days.map((d, i) => ev(`full-${i}`, d, 9, 0, i === 0 ? 18 : 15, 0, i === 0 ? 'All-day workshop' : 'Deep project block')),
  ev('weekly', days[1], 16, 0, 16, 30, 'PRIVATE: salary review', ['RRULE:FREQ=DAILY;COUNT=4']),
  'END:VCALENDAR',
].join('\r\n');
const dir = mkdtempSync(join(tmpdir(), 'agentwall-'));
const file = join(dir, 'test.ics');
writeFileSync(file, ics);
const dayId = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ---------- 1. Sample week by default ----------
cli(['browser', 'reload']);
await sleep(3500);
evalPage(`(localStorage.removeItem('agentwall.calendar.v1'), localStorage.removeItem('agentwall.board.v1'), 1)`);
cli(['browser', 'reload']);
await sleep(3500);
let c = hook('calendar');
check('default: the sample week, labelled as not real', c.real === false && /SAMPLE WEEK/.test(c.label), JSON.stringify(c));
check('start page says so', /sample week/i.test(evalPage(`document.getElementById('cal-status').textContent`)));

// ---------- 2. Import through the real file box ----------
page({ do: 'open', selector: '#cal-setup' });
page({ do: 'fill', selector: '#cal-guest', value: 'Priya' });
page({ do: 'fill', selector: '#cal-email', value: 'priya@example.com' });
page({ do: 'fill', selector: '#cal-topic', value: 'the Q3 budget' });
page({ do: 'fill', selector: '#cal-owner', value: 'Balu' });
page({ do: 'file', selector: '#cal-file', path: file });
await sleep(5000); // it reads, says so, then reloads
c = hook('calendar');
check('after the import the wall is on YOUR calendar, for the next 5 working days', c.real === true && /^YOUR CALENDAR/.test(c.label) && c.days[0] === dayId(days[0]) && c.days.length === 5, JSON.stringify(c));
check('busy times were read (5 long blocks + 4 repeats inside working hours)', c.busy === 9 && c.guest === 'Priya', `busy=${c.busy} guest=${c.guest}`);
page({ do: 'open', selector: '#cal-setup' });
const status = evalPage(`document.getElementById('cal-status').textContent`);
check('start page shows it', /YOUR CALENDAR/.test(status) && /9 busy times/.test(status), status);
const stored = evalPage(`localStorage.getItem('agentwall.calendar.v1')`);
check('only blocks are kept, not the calendar text', !/VCALENDAR|RRULE|UID/.test(stored) && /salary review/.test(stored));
shot('start-page-your-calendar');

// ---------- 3. The agent plans on it ----------
hook('setWatch', false);
hook('setHoldSeconds', 1);
hook('setUnsendSeconds', 1);
try { xr('enter'); } catch (e) { console.log('      enter:', e.message.slice(0, 120)); }
await sleep(1500);
xr('set-input-mode', { mode: 'hand' });
xr('set-connected', { device: 'hand-right', connected: true });
xr('set-transform', { device: 'headset', position: { x: 0, y: 1.2, z: 0 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
hook('restart');
await sleep(2500);
await hook('heard', 'Find a time for my app tester call and draft the invite');
await sleep(3000);
const plan = hook('plan');
// Day 2: 15:30 would end at the 16:00 repeat with no 10-minute gap, so 17:00 is the first time that fits.
check('first free time is found on your own week', plan?.slot?.id === `${dayId(days[1])}T17:00`, plan?.slot?.id);
check('the invite uses your guest, topic and name; no sample words', plan?.invite?.to === 'Priya <priya@example.com>' && /^Call about the Q3 budget: /.test(plan.invite.subject) && /Thanks,\nBalu$/.test(plan.invite.body) && !/app test/i.test(plan.invite.body), `${plan?.invite?.to} | ${plan?.invite?.subject}`);
shot('wall-your-calendar');

// Approve with a real emulated pinch-and-hold.
const t = hook('targets').invite;
xr('set-transform', { device: 'hand-right', position: { x: 0.18, y: 1.0, z: -0.3 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
xr('look-at', { device: 'hand-right', target: { x: t[0], y: t[1], z: t[2] } });
await sleep(300);
xr('set-select-value', { device: 'hand-right', value: 1 });
await sleep(1800);
xr('set-select-value', { device: 'hand-right', value: 0 });
await sleep(2500);
const box = hook('outbox');
check('held and sent to the demo outbox', box.length === 1 && box[0].status === 'sent' && box[0].minutes === 30, JSON.stringify(box.map((o) => [o.status, o.minutes])));
check('no example change on a real calendar: the control is not offered for a calendar from a file', hook('calendarControl') === null && hook('flow').conflict === null && hook('review') === null);

// ---------- 4. Back on the page: a real email draft and calendar file ----------
try { xr('exit'); } catch (e) { console.log('      exit:', e.message.slice(0, 120)); }
await sleep(1500);
const sent = evalPage(`(() => { const b = document.getElementById('sent-box'); return { hidden: b.hidden, text: b.textContent, links: [...b.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href').slice(0, 40), a.getAttribute('download')]) }; })()`);
check('"Approved by you" lists the invite', sent.hidden === false && /Call about the Q3 budget/.test(sent.text) && /Priya <priya@example.com>/.test(sent.text) && !/\(sample\)/.test(sent.text), sent.text.slice(0, 120));
check('it offers an email draft in your own mail app', sent.links.some((l) => l[0] === 'Open email draft' && l[1].startsWith('mailto:priya@example.com?subject=')), JSON.stringify(sent.links));
check('and a calendar file', sent.links.some((l) => /calendar/.test(l[0]) && l[1].startsWith('blob:') && l[2] === 'agent-wall-event.ics'));
const icsOut = evalPage(`fetch(document.querySelector('#sent-box a[download]').href).then((r) => r.text())`);
// 5:00 PM on this machine's wall clock, written as the instant in UTC (the same moment in any time zone).
check('the file holds the approved instant', icsOut.includes(`DTSTART:${utc(days[1], 17, 0)}`) && /SUMMARY:Call about the Q3 budget/.test(icsOut), icsOut.split('\r\n').filter((l) => /DTSTART|SUMMARY/.test(l)).join(' | '));
shot('start-page-approved');

// ---------- 5. A newer file with a new event over the approved time ----------
const approved = `${dayId(days[1])}T17:00`;
const ics2 = ics.replace('END:VCALENDAR', `${ev('new-one', days[1], 16, 45, 17, 30, 'PRIVATE: dentist')}\r\nEND:VCALENDAR`);
const file2 = join(dir, 'test2.ics');
writeFileSync(file2, ics2);
page({ do: 'open', selector: '#cal-setup' });
page({ do: 'file', selector: '#cal-file', path: file2 });
await sleep(5500); // it reads, says so, then reloads; the board checks what was approved as it starts
c = hook('calendar');
let kept = hook('outbox');
check('the newer read is on the wall (one more busy time) and the approval was kept, not wiped', c.real === true && c.busy === 10 && kept.length === 1 && kept[0].slotId === approved, `busy=${c.busy} outbox=${kept.length}`);
check('it is blocked at once: the same check as the example', kept[0].blocked?.why === 'conflict' && /overlaps a new busy block$/.test(kept[0].blocked.text) && !/dentist/i.test(kept[0].blocked.text), JSON.stringify(kept[0].blocked));
let rv = hook('review');
check('the review is open before anything else, and says what is not known', rv?.old === approved && rv.detail === 'Guest availability unknown' && hook('flow').card === null, JSON.stringify(rv && [rv.old, rv.detail, rv.candidates.map((x) => x.label)]));
const gone = evalPage(`(() => { const li = document.querySelector('#sent-list li'); return { blocked: li?.classList.contains('blocked'), state: li?.dataset.state, links: li?.querySelectorAll('a').length, buttons: li?.querySelectorAll('button').length, why: li?.querySelector('.why')?.textContent }; })()`);
check('start page: email draft, calendar file and copy are gone for it', gone.blocked === true && gone.state === 'conflict' && gone.links === 0 && gone.buttons === 0 && /CONFLICT/.test(gone.why), JSON.stringify(gone));
check('no link made for it is left behind', evalPage(`document.querySelectorAll('#sent-box a[download]').length`) === 0);
shot('start-page-blocked');

// Replace it in the room: a trial, then one hold.
try { xr('enter'); } catch (e) { console.log('      enter:', e.message.slice(0, 120)); }
await sleep(1500);
xr('set-input-mode', { mode: 'hand' });
xr('set-connected', { device: 'hand-right', connected: true });
xr('set-transform', { device: 'headset', position: { x: 0, y: 1.2, z: 0 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
hook('restart');
await sleep(2500);
hook('setHoldSeconds', 1);
hook('setUnsendSeconds', 1);
const aimAt = (p) => {
  xr('set-transform', { device: 'hand-right', position: { x: 0.18, y: 1.0, z: -0.3 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
  xr('look-at', { device: 'hand-right', target: { x: p[0], y: p[1], z: p[2] } });
};
aimAt(hook('targets').cand0);
await sleep(300);
xr('select', { device: 'hand-right', duration: 0.2 });
await sleep(2500);
const trial = hook('plan');
check('a pinched time is a draft on your own calendar, in place of the old one', trial?.approval === 'needs' && trial.slot?.id !== approved && trial.replaces === kept[0].id && /^Call about the Q3 budget: /.test(trial.invite.subject), `${trial?.slot?.id} ${trial?.approval}`);
shot('wall-your-calendar-conflict');
aimAt(hook('targets').invite);
await sleep(300);
xr('set-select-value', { device: 'hand-right', value: 1 });
await sleep(1800);
xr('set-select-value', { device: 'hand-right', value: 0 });
await sleep(3000);
kept = hook('outbox');
const was = kept.find((o) => o.slotId === approved);
const now = kept.find((o) => o.slotId === trial.slot.id);
check('one hold: the old one is superseded, the new one carries your calendar and its instant', was?.blocked?.why === 'superseded' && now && !now.blocked && now.source === 'yours' && /Z$/.test(now.startUtc ?? ''), JSON.stringify(kept.map((o) => [o.slotId, o.blocked?.why ?? 'ok', o.source])));
try { xr('exit'); } catch (e) { console.log('      exit:', e.message.slice(0, 120)); }
await sleep(1500);
const icsNew = evalPage(`fetch(document.querySelector('#sent-box a[download]').href).then((r) => r.text())`);
const want = new Date(now.startUtc).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
check('its calendar file holds that instant in UTC, so it is the same moment in any time zone', icsNew.includes(`DTSTART:${want}`) && new Date(now.startUtc).getHours() * 60 + new Date(now.startUtc).getMinutes() === Number(trial.slot.id.slice(11, 13)) * 60 + Number(trial.slot.id.slice(14, 16)), icsNew.split('\r\n').filter((l) => /DTSTART/.test(l)).join(' | '));

// ---------- 6. A link that cannot be read keeps what was known, and says so ----------
const before = hook('calendar').busy;
evalPage(`(() => { const k = 'agentwall.calendar.v1'; const d = JSON.parse(localStorage.getItem(k)); d.source = 'link'; d.url = 'https://calendar.google.com/calendar/ical/nobody/basic.ics'; localStorage.setItem(k, JSON.stringify(d)); return 1; })()`);
cli(['browser', 'reload']);
await sleep(6500);
c = hook('calendar');
const said = evalPage(`document.getElementById('cal-msg').textContent`);
check('a failed re-read keeps the last calendar and every approval', c.real === true && c.busy === before && hook('outbox').length === 2, `busy=${c.busy} outbox=${hook('outbox').length}`);
check('and both the wall and the start page say the re-read failed', /REFRESH FAILED/.test(c.label) && /could not be read just now/.test(said), `${c.label} | ${said}`);
check('a linked calendar offers "Refresh my calendar" on the wall', hook('calendarControl')?.label === '⟳ Refresh my calendar', JSON.stringify(hook('calendarControl')));

// ---------- 7. Back to the sample week ----------
page({ do: 'open', selector: '#cal-setup' });
page({ do: 'click', selector: '#cal-sample' });
await sleep(4500);
c = hook('calendar');
check('"Back to the sample week" removes your calendar from this browser', c.real === false && evalPage(`localStorage.getItem('agentwall.calendar.v1')`) === null, JSON.stringify(c));
hook('resetDemo');

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
