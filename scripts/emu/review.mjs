// Emulator checks for the conflict review: an approved time stops fitting, you try
// another one in the room, and a fresh hold approves exactly what you see.
// Needs the dev server:  npx iwsdk dev up --headless --allow-browser-automation
// Usage: node scripts/emu/review.mjs   (sample week; every pinch is a real emulated hand-ray pinch)
import { execFileSync } from 'node:child_process';

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
function evalPage(code) {
  process.env.AGENTWALL_PAGE = JSON.stringify({ do: 'eval', code });
  return cli(['browser', 'run', 'scripts/emu/page.mjs']).result;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = '') {
  results.push(!!ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const shot = (name) => {
  try {
    console.log(`      shot ${name}: ${cli(['browser', 'screenshot'], {}).screenshotPath}`);
  } catch (e) {
    console.log(`      shot ${name} failed: ${e.message.slice(0, 100)}`);
  }
};
function aimAt(t) {
  xr('set-transform', { device: 'hand-right', position: { x: 0.18, y: 1.0, z: -0.3 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
  xr('look-at', { device: 'hand-right', target: { x: t[0], y: t[1], z: t[2] } });
}
const aim = (name) => aimAt(hook('targets')[name]);
const pinchValue = (value) => xr('set-select-value', { device: 'hand-right', value });
async function tap(name) {
  const before = hook('interaction').presses;
  aim(name);
  await sleep(250);
  xr('select', { device: 'hand-right', duration: 0.2 });
  await sleep(450);
  if (hook('interaction').presses === before) console.log(`      tap ${name}: NO PRESS`);
}
async function waitIdle(ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!hook('interaction').busy && !hook('mural').sweeping) return;
    await sleep(200);
  }
}
/** Pinch and hold the desk card long enough to approve (the hold is set to 1 s). */
async function holdCard() {
  aim('invite');
  await sleep(300);
  pinchValue(1);
  await sleep(1900);
  pinchValue(0);
  await sleep(300);
}
async function enterXr() {
  try { xr('enter'); } catch (e) { console.log('      enter:', e.message.slice(0, 120)); }
  await sleep(1500);
  xr('set-input-mode', { mode: 'hand' });
  xr('set-connected', { device: 'hand-right', connected: true });
  xr('set-transform', { device: 'headset', position: { x: 0, y: 1.2, z: 0 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
  hook('simulateNoPlanes', false);
  hook('setLateWallSeconds', 90);
  hook('restart');
  await sleep(2500);
  pinchValue(0);
}
async function exitXr() {
  try { xr('exit'); } catch (e) { console.log('      exit:', e.message.slice(0, 120)); }
  await sleep(1500);
}
const page = () =>
  evalPage(`(() => {
    const box = document.getElementById('sent-box');
    return {
      hidden: box.hidden,
      items: [...box.querySelectorAll('li')].map((li) => ({
        blocked: li.classList.contains('blocked'),
        state: li.dataset.state || '',
        what: li.querySelector('.what')?.textContent || '',
        why: li.querySelector('.why')?.textContent || '',
        outside: li.querySelector('.outside')?.textContent || '',
        links: [...li.querySelectorAll('a')].map((a) => a.textContent),
        hrefs: [...li.querySelectorAll('a')].map((a) => a.href.slice(0, 5)),
        buttons: [...li.querySelectorAll('button')].map((b) => b.textContent),
      })),
    };
  })()`);
const TUE = '2026-11-17T13:00';
const old = (box) => box.find((o) => o.slotId === TUE);

// ---------- a clean sample board ----------
cli(['browser', 'reload']);
await sleep(3500);
evalPage(`(['agentwall.calendar.v1','agentwall.board.v1','agentwall.queue.v1','agentwall.learn.v1'].forEach((k) => localStorage.removeItem(k)), 1)`);
cli(['browser', 'reload']);
await sleep(3500);
await enterXr();
hook('setHoldSeconds', 1);
hook('setUnsendSeconds', 2);

// ---------- 1. The first view: one evident action ----------
let flow = hook('flow');
let control = hook('calendarControl');
check('first view: one card offers the example, and nothing else pulses', flow.card === 'example' && flow.startHint === false, JSON.stringify({ card: flow.card, startHint: flow.startHint }));
check('the calendar control says it is an example', control?.label === '⟳ Try a calendar change' && /EXAMPLE/.test(control.sub), JSON.stringify(control));
shot('review-first-view');

// ---------- 2. The change lands: the old approval is blocked at once ----------
await tap('replan:yes'); // "Try it"
await waitIdle();
await sleep(600);
let rv = hook('review');
let box = hook('outbox');
check('snapshot A: an approved call, labelled as the example\'s own', box.length === 1 && box[0].example === true && box[0].slotId === TUE && box[0].status === 'sent', JSON.stringify(box.map((o) => [o.slotId, o.example, o.status])));
check('snapshot B: one new busy block on the sample week, saved with the board', hook('calendar').busy === 12 && /example change/.test(hook('saved')), `busy=${hook('calendar').busy}`);
check('the old approval is blocked immediately, with the reason', box[0].blocked?.why === 'conflict' && box[0].blocked.text === 'Tue 1:00 PM overlaps a new busy block', JSON.stringify(box[0].blocked));
check('the review keeps the old time and offers two other times', rv?.old === TUE && rv.candidates.map((c) => c.label).join('|') === 'Wed 5:30 PM|Thu 1:00 PM' && rv.trial === null, JSON.stringify(rv?.candidates));
check('the wall shows one decision: the bar and the mic, no other chips', rv?.bar === true && rv.chips === 1 && hook('calendarControl') === null, `chips=${rv?.chips}`);
check('the new block is marked on the week', hook('mural').fresh >= 1, `fresh=${hook('mural').fresh}`);
flow = hook('flow');
check('the desk shows the old card, blocked', hook('plan').approval === 'approved' && flow.conflict === 'Tue 1:00 PM overlaps a new busy block' && hook('desk')?.visible === true, flow.conflict);
shot('review-conflict');

// A blocked card cannot be approved, however long you hold it.
await holdCard();
check('holding the blocked card approves nothing', hook('outbox').length === 1 && hook('plan').approval === 'approved' && hook('interaction').peakHold === 0, `peak=${hook('interaction').peakHold}`);

// ---------- 3. Try a time in the room: a preview, nothing approved ----------
await tap('cand0');
await waitIdle();
let plan = hook('plan');
rv = hook('review');
box = hook('outbox');
check('pinch a time: a draft for it lands on the desk, needing approval', plan.slot?.id === '2026-11-18T17:30' && plan.approval === 'needs' && plan.replaces === old(box).id && rv.trial === 0, `${plan.slot?.id} ${plan.approval} trial=${rv.trial}`);
check('the old time is still on the wall, still blocked; nothing approved changed', rv.old === TUE && box.length === 1 && old(box).blocked?.why === 'conflict', JSON.stringify(box.map((o) => o.blocked?.why)));
check('the card reads both times and one trade-off', /^Call|^App test call: Wed 18 Nov, 5:30/.test(plan.invite.subject) && hook('flow').conflict === null, plan.invite.subject);
shot('review-preview');

await tap('cand1');
await waitIdle();
plan = hook('plan');
check('changing candidate swaps the preview and still approves nothing', plan.slot?.id === '2026-11-19T13:00' && plan.approval === 'needs' && hook('review').trial === 1 && hook('outbox').length === 1, plan.slot?.id);

await tap('review:cancel');
await sleep(400);
plan = hook('plan');
rv = hook('review');
check('Cancel: the old card is back, blocked; approvals untouched', plan.slot?.id === TUE && plan.approval === 'approved' && rv?.trial === null && hook('outbox').length === 1 && old(hook('outbox')).blocked?.why === 'conflict', `${plan.slot?.id} ${hook('interaction').agentLine}`);

// ---------- 4. One continuous hold ----------
await tap('cand0');
await waitIdle();
// A very long hold for the three "it must cancel" checks: on a slow laptop one emulator
// command can take 2 to 3 seconds, and the hold must not complete by itself meanwhile.
hook('setHoldSeconds', 40);
aim('invite');
await sleep(300);
pinchValue(1);
await sleep(700);
pinchValue(0);
await sleep(900);
check('an early release approves nothing and says so', hook('plan').approval === 'needs' && hook('outbox').length === 1 && /Let go early/.test(hook('interaction').agentLine), hook('interaction').agentLine);

aim('invite');
await sleep(300);
pinchValue(1);
await sleep(600);
const mid = hook('interaction').hold;
xr('set-connected', { device: 'hand-right', connected: false }); // the hand leaves tracking mid-hold
await sleep(700);
let it = hook('interaction');
check('losing hand tracking mid-hold cancels the hold', mid > 0 && it.hold === 0 && hook('plan').approval === 'needs' && hook('outbox').length === 1 && /hand tracking was lost/.test(it.agentLine), `mid=${mid.toFixed(2)} now=${it.hold} | ${it.agentLine}`);
xr('set-connected', { device: 'hand-right', connected: true });
await sleep(500);
pinchValue(0);
await sleep(500);

aim('invite');
await sleep(300);
pinchValue(1);
await sleep(600);
const mid2 = hook('interaction').hold;
hook('changeUnderHand'); // a newer snapshot takes the time on trial, during the hold
await sleep(500);
it = hook('interaction');
rv = hook('review');
plan = hook('plan');
check('a new conflict mid-hold cancels the hold and ends the trial', mid2 > 0 && it.hold === 0 && rv.trial === null && plan.slot?.id === TUE && hook('outbox').length === 1, `mid=${mid2.toFixed(2)} trial=${rv.trial} | ${it.agentLine}`);
check('the taken time is no longer offered', !rv.candidates.some((c) => c.id === '2026-11-18T17:30') && rv.candidates.length === 2, JSON.stringify(rv.candidates.map((c) => c.label)));
await sleep(1500); // the same pinch, still down, must not start a new hold
check('the pinch that was down cannot carry on into another card', hook('interaction').hold === 0 && hook('outbox').length === 1);
pinchValue(0);
await sleep(500);
hook('setHoldSeconds', 1);

// ---------- 5. A fresh hold approves the exact card shown ----------
hook('setUnsendSeconds', 25); // emulator commands take 1 to 3 seconds each: keep the window open long enough to look
await tap('cand0');
await waitIdle();
const chosen = hook('plan').slot.id;
const chosenLabel = hook('review').candidates[0].label;
const shown = hook('plan').invite;
await holdCard();
box = hook('outbox');
const fresh = box.find((o) => o.slotId === chosen);
check('one full hold approves the replacement shown', hook('plan').approval === 'approved' && fresh?.status === 'sending' && fresh.replaces === old(box).id, `${chosen} ${fresh?.status}`);
check('what was approved is word for word what was on the card', fresh?.subject === shown.subject && fresh.body === shown.body && fresh.to === shown.to, fresh?.subject);
check('in the Unsend window the old one is blocked but not yet replaced', old(box).blocked?.why === 'conflict');
// Wait for the window to close, however slow the machine is.
for (let i = 0; i < 40 && hook('flow').sendingLeft !== null; i++) await sleep(1000);
await sleep(800);
hook('setUnsendSeconds', 2);
box = hook('outbox');
const oldNow = old(box);
const newNow = box.find((o) => o.slotId === chosen);
check('sent: the old item is superseded and names its replacement', oldNow.blocked?.why === 'superseded' && oldNow.blocked.by === newNow.id && newNow.status === 'sent' && !newNow.blocked, JSON.stringify(oldNow.blocked));
check('the approval carries its proposal, its calendar and its instant', /^[0-9a-f]{8}$/.test(newNow.reviewed) && newNow.source === 'sample' && /Z$/.test(newNow.startUtc), `${newNow.reviewed} ${newNow.source} ${newNow.startUtc}`);
check('the review is over: chips are back, nothing is flagged', hook('review') === null && hook('flow').conflict === null && hook('flow').card === null && /Replaced/.test(hook('interaction').agentLine), hook('interaction').agentLine);
shot('review-replaced');

// ---------- 6. The hand-off boundary, and after a reload ----------
await exitXr();
let pg = page();
const pOld = pg.items.find((i) => /Tue 17 Nov, 1:00/.test(i.what));
const pNew = pg.items.find((i) => i.what.includes(chosenLabel.split(' ')[0]));
check('start page: the old item is history, with no link and no button', pOld?.blocked && pOld.state === 'superseded' && pOld.links.length === 0 && pOld.buttons.length === 0 && /REPLACED/.test(pOld.why), JSON.stringify(pOld));
check('it says what is outside Agent Wall\'s control', /cannot reach other apps/.test(pOld?.outside ?? ''));
check('the replacement can be handed off: email draft, calendar file, copy', pNew && !pNew.blocked && pNew.links.length === 2 && pNew.hrefs.join() === 'mailt,blob:' && pNew.buttons.length === 1, JSON.stringify(pNew));

cli(['browser', 'reload']);
await sleep(4000);
box = hook('outbox');
check('after a reload the old one is still superseded and the new one still usable', old(box).blocked?.why === 'superseded' && !box.find((o) => o.slotId === chosen).blocked && hook('calendar').busy === 13, JSON.stringify(box.map((o) => [o.slotId, o.blocked?.why ?? 'ok'])));
pg = page();
check('and the start page shows the same', pg.items.filter((i) => i.blocked).length === 1 && pg.items.filter((i) => !i.blocked && i.links.length === 2).length === 1, JSON.stringify(pg.items.map((i) => [i.state, i.links.length])));

// ---------- 7. The week changes again; reload in the middle of the conflict ----------
await enterXr();
hook('setHoldSeconds', 1);
hook('setUnsendSeconds', 2);
check('nothing needs review, so the control offers the example again', hook('review') === null && hook('calendarControl')?.label === '⟳ Try a calendar change');
await tap('calendar');
await sleep(800);
rv = hook('review');
box = hook('outbox');
check('a second change over the replacement is a new conflict', rv?.old === chosen && box.find((o) => o.slotId === chosen).blocked?.why === 'conflict' && old(box).blocked?.why === 'superseded', JSON.stringify(box.map((o) => [o.slotId, o.blocked?.why ?? 'ok'])));
await exitXr();
pg = page();
check('start page: both are blocked now, nothing to hand off', pg.items.length === 2 && pg.items.every((i) => i.blocked && i.links.length === 0 && i.buttons.length === 0), JSON.stringify(pg.items.map((i) => [i.state, i.links.length])));
cli(['browser', 'reload']);
await sleep(4000);
pg = page();
check('still blocked after a reload, before the board is even entered', pg.items.length === 2 && pg.items.every((i) => i.blocked && i.links.length === 0), JSON.stringify(pg.items.map((i) => i.state)));
await enterXr();
hook('setHoldSeconds', 1);
hook('setUnsendSeconds', 2);
rv = hook('review');
check('entering again opens on the conflict: the old time and other times', rv?.old === chosen && rv.candidates.length > 0 && hook('flow').card === null && hook('flow').conflict !== null, JSON.stringify(rv?.candidates.map((c) => c.label)));
shot('review-on-enter');

await tap('review:cancel'); // "Not now"
await sleep(400);
control = hook('calendarControl');
check('Not now: the item stays blocked and the control brings the review back', hook('review') === null && control?.label === '⚠ Review conflict' && control.primary === true && hook('flow').conflict !== null, JSON.stringify(control));
await tap('calendar');
await sleep(600);
check('pinching it reopens the same review (no new change is added)', hook('review')?.old === chosen && hook('calendar').busy === 14, `busy=${hook('calendar').busy}`);

// ---------- 8. A spoken limit changes the candidates; the model approves nothing ----------
const before = hook('review').candidates.map((c) => c.id).join();
hook('fakeAi', { intent: 'rule', rule: { after: '15:00', before: null, day: '2026-11-19', notDays: [] }, slotId: '2026-11-17T13:00', reason: 'x', body: 'x' });
await hook('heard', 'could we push it to the back half of Thursday');
await sleep(300);
rv = hook('review');
check('rules read "Thursday" themselves: no AI label for what the rules understood', rv.heard?.by === 'rules' && /Rules understood/.test(hook('interaction').agentLine), `${JSON.stringify(rv.heard)} | ${hook('interaction').agentLine}`);
await hook('heard', 'any time');
await hook('heard', 'honestly the later part of the day suits me better');
await sleep(300);
rv = hook('review');
check('a sentence the rules cannot read: the checked AI answer changes the candidates', rv.heard?.by === 'ai' && rv.heard.changed === true && rv.candidates.map((c) => c.id).join() !== before && rv.candidates.every((c) => c.id.startsWith('2026-11-19T') && Number(c.id.slice(11, 13)) >= 15), `${JSON.stringify(rv.heard)} ${JSON.stringify(rv.candidates.map((c) => c.label))}`);
check('the board says who understood it', /Live AI · Groq understood “only after 3 PM, on Thursday 19 Nov”/.test(hook('interaction').agentLine), hook('interaction').agentLine);
check('the model named a busy time; it is not on the wall, and nothing was approved', !rv.candidates.some((c) => c.id === '2026-11-17T13:00') && hook('outbox').length === 2 && hook('plan').approval === 'approved');
shot('review-heard');
const kept = hook('review').candidates.map((c) => c.id).join();
hook('fakeAi', 'offline');
await hook('heard', 'whatever works I suppose');
await sleep(300);
check('offline or unclear: the candidates stay, the board asks again, pinching still works', hook('review').candidates.map((c) => c.id).join() === kept && /Not sure what limit you meant/.test(hook('interaction').agentLine), hook('interaction').agentLine);
hook('fakeAi', null);

// ---------- 9. With motion reduced, the labels carry the link ----------
hook('setReducedMotion', true);
await tap('cand0');
await sleep(500);
const m = hook('mural');
plan = hook('plan');
rv = hook('review');
check('reduced motion: no sweep and no flight; the same time label on the button and the card', m.sweeping === false && m.flying === false && plan.approval === 'needs' && plan.invite.subject.includes(rv.candidates[0].label.split(' ').slice(1).join(' ').replace(' PM', '').replace(' AM', '')), `${rv.candidates[0].label} | ${plan.invite.subject}`);
hook('setReducedMotion', false);
await holdCard();
for (let i = 0; i < 30 && hook('flow').sendingLeft !== null; i++) await sleep(1000);
await sleep(800);
box = hook('outbox');
check('the second replacement goes out; both earlier approvals are history', hook('review') === null && box.filter((o) => o.blocked?.why === 'superseded').length === 2 && box.filter((o) => !o.blocked).length === 1, JSON.stringify(box.map((o) => [o.slotId, o.blocked?.why ?? 'ok'])));
shot('review-end');

// ---------- 10. No room data: the board floats, the card sits in front of the seat ----------
hook('simulateNoPlanes', true);
hook('restart');
await sleep(4500);
await tap('calendar');
await sleep(900);
await tap('cand0');
await waitIdle();
plan = hook('plan');
rv = hook('review');
check('without walls or a table the review still works: floating board, card above the lap', hook('state') === 'fallback' && hook('desk')?.kind === 'lap' && hook('desk').visible === true && rv?.trial === 0 && plan.approval === 'needs', `${hook('state')} ${hook('desk')?.kind} trial=${rv?.trial}`);
shot('review-no-room');
hook('simulateNoPlanes', false);

// ---------- leave it clean ----------
await exitXr();
hook('resetDemo');
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
