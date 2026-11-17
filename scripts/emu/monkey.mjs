// A "monkey" in the emulator: random pinches, holds, drags, calendar changes and reloads,
// with rules checked after every step. It looks for states a person could reach by pinching
// things in an order nobody planned.
// Run from the agentwall folder, dev server up:  node scripts/emu/monkey.mjs [seed] [steps] [log file]
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SEED = Number(process.argv[2] ?? 1);
const STEPS = Number(process.argv[3] ?? 100);
const LOG = process.argv[4] ?? join(tmpdir(), `agentwall-monkey-${SEED}.log`);
writeFileSync(LOG, '');
const out = (s) => {
  console.log(s);
  appendFileSync(LOG, s + '\n');
};

const CLI = 'node_modules/@iwsdk/cli/dist/cli.js';
function cli(args, input) {
  const full = [CLI, ...args];
  if (input !== undefined) full.push('--input-json', JSON.stringify(input));
  const o = JSON.parse(execFileSync(process.execPath, full, { encoding: 'utf8', timeout: 90_000 }));
  if (o.ok === false) throw new Error(o.error?.message ?? 'failed');
  return o.data;
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

// A small seeded random source, so a run can be repeated.
let s = SEED >>> 0;
const rnd = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rnd() * list.length)];

const HOME = { x: 0, y: 1.2, z: 0 };
const HAND = { 'hand-right': { x: 0.18, y: 1.0, z: -0.3 }, 'hand-left': { x: -0.18, y: 1.0, z: -0.3 } };

const ERR_HOOK = `(window.__errs = window.__errs || [], window.__errHook || (window.__errHook = (addEventListener('error', (e) => window.__errs.push('error: ' + e.message + ' @' + String(e.filename || '').split('/').pop() + ':' + e.lineno)), addEventListener('unhandledrejection', (e) => window.__errs.push('rejection: ' + ((e.reason && e.reason.message) || e.reason))), (() => { const ce = console.error; console.error = (...a) => { window.__errs.push('console.error: ' + a.map((x) => (x && x.message) || String(x)).join(' ').slice(0, 300)); ce.apply(console, a); }; })(), 1)), 1)`;

const STATE = `(() => { const a = window.agentwall; if (!a) return null; const o = a.outbox(); const p = a.plan(); const r = a.review(); const f = a.flow(); const i = a.interaction(); const d = a.drag(); const m = a.mural();
  return { plan: p && { slot: p.slot && p.slot.id, approval: p.approval, rule: p.constraintText, moving: !!p.moving, invite: !!p.invite, subj: p.invite ? p.invite.subject : null, version: p.version, task: p.task },
    review: r && { item: r.item, old: r.old, trial: r.trial, cands: r.candidates.map((c) => c.id), bar: r.bar },
    flow: { sendingLeft: f.sendingLeft, conflict: f.conflict, card: f.card, moving: f.moving },
    outbox: o.map((x) => ({ id: x.id, slot: x.slotId, status: x.status, blocked: x.blocked ? x.blocked.why : null, by: (x.blocked && x.blocked.by) || null, replaces: x.replaces || null, subj: x.subject, example: !!x.example })),
    it: { hold: i.hold, busy: i.busy, line: i.agentLine, boardVisible: i.boardVisible, presses: i.presses },
    drag: d, cal: a.calendarControl(), state: a.state(), sweeping: m.sweeping,
    errs: (window.__errs || []).slice(-4), nErrs: (window.__errs || []).length, hasErrHook: !!window.__errHook,
    targets: a.targets(), desk: a.desk() }; })()`;

function read() {
  return evalPage(STATE);
}
async function settle(ms = 20_000) {
  await sleep(600);
  const t0 = Date.now();
  let st = read();
  while (st && (st.it.busy || st.sweeping) && Date.now() - t0 < ms) {
    await sleep(500);
    st = read();
  }
  return st;
}

function aimAt(device, point) {
  xr('set-transform', { device, position: HAND[device], orientation: { pitch: 0, yaw: 0, roll: 0 } });
  xr('look-at', { device, target: { x: point[0], y: point[1], z: point[2] } });
}
const pinch = (device, value) => xr('set-select-value', { device, value });

async function enter() {
  try { xr('enter'); } catch {}
  await sleep(1500);
  xr('set-input-mode', { mode: 'hand' });
  xr('set-connected', { device: 'hand-right', connected: true });
  xr('set-connected', { device: 'hand-left', connected: true });
  xr('set-transform', { device: 'headset', position: HOME, orientation: { pitch: 0, yaw: 0, roll: 0 } });
  evalPage(ERR_HOOK);
  hook('setLateWallSeconds', 90);
}

const fmt = (st) =>
  !st
    ? 'no app'
    : `plan=${st.plan ? `${st.plan.slot ?? '-'}/${st.plan.approval}${st.plan.moving ? '/moving' : ''}` : '-'} review=${st.review ? `${st.review.old}>${st.review.trial ?? 'x'}[${st.review.cands.length}]` : '-'} send=${st.flow.sendingLeft === null ? '-' : st.flow.sendingLeft.toFixed(1)} conflict=${st.flow.conflict ? 'Y' : '-'} card=${st.flow.card ?? '-'} outbox=[${st.outbox.map((o) => `${o.slot}${o.status === 'sending' ? '~' : ''}${o.blocked ? '!' + o.blocked[0] : ''}`).join(' ')}] line="${String(st.it.line).slice(0, 70)}"`;

let violations = 0;
const notes = [];
function violation(step, text) {
  violations++;
  out(`  !! VIOLATION (step ${step}): ${text}`);
}
function note(step, text) {
  notes.push(`step ${step}: ${text}`);
  out(`  .. note: ${text}`);
}

/** Rules that must hold whenever no pinch is down. */
function checkAlways(step, st, errsBefore) {
  if (!st) return violation(step, 'the app is gone (no window.agentwall)');
  if (st.nErrs > errsBefore) violation(step, `new JavaScript error: ${st.errs.slice(-(st.nErrs - errsBefore)).join(' | ')}`);
  if (st.it.hold !== 0) violation(step, `hold ring still at ${st.it.hold} with no pinch down`);
  if (st.drag.active !== null) violation(step, `still dragging "${st.drag.active}" with no pinch down`);
  if (st.it.busy) violation(step, 'the agent is still busy after 20 s');
  const ids = st.outbox.map((o) => o.id);
  if (new Set(ids).size !== ids.length) violation(step, `two outbox items share an id: ${ids.join(', ')}`);
  for (const o of st.outbox) {
    if (o.blocked && o.status === 'sending') violation(step, `item ${o.id} is blocked and still sending`);
    if (o.blocked === 'superseded' && o.by && !ids.includes(o.by)) note(step, `item ${o.id} says it was replaced by ${o.by}, which is not in the outbox`);
  }
  const usable = st.outbox.filter((o) => !o.blocked);
  const slots = usable.map((o) => o.slot);
  const twice = slots.find((x, i) => slots.indexOf(x) !== i);
  if (twice) violation(step, `two usable approvals for the same time ${twice}`);
  if (st.flow.conflict && !st.plan) violation(step, 'a conflict is shown with no card');
  if (st.review) {
    if (st.review.cands.includes(st.review.old)) violation(step, 'the conflicted time is offered as a replacement');
    if (st.review.trial !== null) {
      if (!st.plan || st.plan.slot !== st.review.cands[st.review.trial]) violation(step, `trial ${st.review.trial} but the card shows ${st.plan?.slot}`);
      if (st.plan && st.plan.approval === 'approved' && st.flow.sendingLeft === null) violation(step, 'a trial card is approved while the review is still open');
    } else if (st.plan && st.plan.slot !== st.review.old) violation(step, `review of ${st.review.old} but the card shows ${st.plan.slot}`);
    if (st.review.cands.length === 0) note(step, `review with no other time to offer (control: ${st.cal ? st.cal.label : 'hidden'})`);
  }
  if (!st.it.boardVisible && !st.flow.moving) note(step, `board not visible (state ${st.state})`);
  if (/No free time/i.test(st.it.line)) note(step, `"${st.it.line}"`);
}

const TEXTS = ['only after 4 PM', 'not Wednesday', 'any time', 'on Thursday', 'not before lunch', 'block two hours of focus time', 'move my design review to Thursday', 'what is the weather', 'can we do it on Friday after 3'];

const ACTIONS = [
  ['tap', 46], ['hold', 16], ['shortHold', 4], ['dragBoard', 4], ['dragCard', 4], ['under', 5], ['wait', 8],
  ['recenter', 2], ['reload', 3], ['heard', 6], ['cell', 6], ['twoHands', 5], ['reenter', 2],
];
const TOTAL = ACTIONS.reduce((n, a) => n + a[1], 0);
function chooseAction() {
  let x = rnd() * TOTAL;
  for (const [name, w] of ACTIONS) {
    if ((x -= w) < 0) return name;
  }
  return 'tap';
}

// ---------- start ----------
out(`monkey seed=${SEED} steps=${STEPS}`);
cli(['browser', 'reload']);
await sleep(3500);
evalPage(`(['agentwall.calendar.v1','agentwall.board.v1','agentwall.queue.v1','agentwall.learn.v1'].forEach((k) => localStorage.removeItem(k)), 1)`);
cli(['browser', 'reload']);
await sleep(3500);
await enter();
hook('simulateNoPlanes', false);
hook('restart');
await sleep(2500);
let st = await settle();
out(`start: ${fmt(st)}`);
let failures = 0;

for (let step = 1; step <= STEPS; step++) {
  const before = st ?? read();
  if (!before) {
    out(`step ${step}: no app, reloading`);
    cli(['browser', 'reload']);
    await sleep(4000);
    await enter();
    st = await settle();
    continue;
  }
  const errsBefore = before.hasErrHook ? before.nErrs : 0;
  const action = chooseAction();
  let what = action;
  try {
    if (action === 'tap') {
      const name = pick(Object.keys(before.targets));
      what = `tap ${name}`;
      aimAt('hand-right', before.targets[name]);
      await sleep(250);
      xr('select', { device: 'hand-right', duration: 0.2 });
      st = await settle();
      if (st && st.outbox.length > before.outbox.length) {
        const added = st.outbox.filter((o) => !before.outbox.some((b) => b.id === o.id));
        if (added.some((o) => !o.example)) violation(step, `a short pinch on "${name}" added an approval: ${JSON.stringify(added)}`);
        else note(step, `a short pinch on "${name}" added the labelled example approval`);
      }
    } else if (action === 'hold' || action === 'shortHold') {
      aimAt('hand-right', before.targets.invite);
      await sleep(250);
      pinch('hand-right', 1);
      await sleep(action === 'hold' ? 2600 : 150);
      pinch('hand-right', 0);
      st = await settle();
      if (st) {
        const added = st.outbox.filter((o) => !before.outbox.some((b) => b.id === o.id));
        if (added.length > 1) violation(step, `one hold added ${added.length} approvals`);
        if (added.length === 1) {
          if (before.flow.conflict) violation(step, 'a hold approved a card that was BLOCKED');
          if (before.review && before.review.trial === null) violation(step, 'a hold approved during a review with no time on trial');
          if (before.plan && before.plan.approval === 'approved') violation(step, 'a hold approved a card that was already approved');
          if (!before.plan || added[0].subj !== before.plan.subj) violation(step, `approved "${added[0].subj}" but the card showed "${before.plan?.subj}"`);
          if (action === 'shortHold') note(step, 'the short hold approved (emulator commands are slow: check by hand before trusting this)');
        }
      }
    } else if (action === 'dragBoard' || action === 'dragCard') {
      const name = action === 'dragBoard' ? 'grab:board' : 'grab:card';
      const t = before.targets[name];
      aimAt('hand-right', t);
      await sleep(250);
      pinch('hand-right', 1);
      await sleep(400);
      const dx = (rnd() - 0.5) * 0.8;
      const dy = (rnd() - 0.5) * 0.3;
      xr('look-at', { device: 'hand-right', target: { x: t[0] + dx, y: t[1] + dy, z: t[2] } });
      await sleep(500);
      pinch('hand-right', 0);
      st = await settle();
      what = `${action} dx=${dx.toFixed(2)} dy=${dy.toFixed(2)}`;
      if (st && st.outbox.length !== before.outbox.length) violation(step, `a drag of ${name} changed the outbox`);
      if (st && before.plan && st.plan && st.plan.approval !== before.plan.approval && before.flow.sendingLeft === null) violation(step, `a drag of ${name} changed the approval from ${before.plan.approval} to ${st.plan.approval}`);
    } else if (action === 'under') {
      const r = hook('changeUnderHand');
      what = `calendar change under the card (${r})`;
      st = await settle();
    } else if (action === 'wait') {
      await sleep(3500);
      st = await settle();
    } else if (action === 'recenter') {
      hook('recenter');
      await sleep(1500);
      st = await settle();
    } else if (action === 'reload') {
      cli(['browser', 'reload']);
      await sleep(4000);
      await enter();
      await sleep(2000);
      st = await settle();
      if (st && before.flow.sendingLeft === null) {
        const lost = before.outbox.filter((b) => !st.outbox.some((o) => o.id === b.id));
        if (lost.length) violation(step, `a reload lost approvals: ${lost.map((o) => o.id).join(', ')}`);
        for (const b of before.outbox) {
          const o = st.outbox.find((x) => x.id === b.id);
          if (o && b.blocked && !o.blocked) violation(step, `a reload unblocked ${b.id} (${b.blocked})`);
        }
      }
    } else if (action === 'reenter') {
      xr('exit');
      await sleep(1500);
      await enter();
      await sleep(2500);
      st = await settle();
      if (st && st.outbox.length !== before.outbox.length && before.flow.sendingLeft === null) violation(step, 'leaving and re-entering changed the outbox');
    } else if (action === 'heard') {
      const text = pick(TEXTS);
      what = `heard "${text}"`;
      hook('heard', text);
      st = await settle(30_000);
      if (st && st.outbox.length > before.outbox.length) violation(step, `speech "${text}" added an approval`);
    } else if (action === 'cell') {
      const day = Math.floor(rnd() * 5);
      const minute = 540 + Math.floor(rnd() * 18) * 30;
      what = `tap week cell day ${day} ${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, '0')}`;
      const p = hook('muralPoint', day, minute);
      if (p) {
        aimAt('hand-right', p);
        await sleep(250);
        xr('select', { device: 'hand-right', duration: 0.2 });
      }
      st = await settle();
      if (st && st.outbox.length > before.outbox.length) violation(step, 'a pinch on the week added an approval');
    } else if (action === 'twoHands') {
      const other = pick(Object.keys(before.targets).filter((n) => n !== 'invite'));
      what = `hold the card with the right hand, pinch "${other}" with the left mid-hold`;
      aimAt('hand-right', before.targets.invite);
      aimAt('hand-left', before.targets[other]);
      await sleep(250);
      pinch('hand-right', 1);
      xr('select', { device: 'hand-left', duration: 0.2 });
      await sleep(2600);
      const mid = read();
      pinch('hand-right', 0);
      st = await settle();
      if (st) {
        const added = st.outbox.filter((o) => !before.outbox.some((b) => b.id === o.id) && !o.example);
        if (added.length > 1) violation(step, `two-hand step added ${added.length} approvals`);
        if (added.length === 1 && before.plan && added[0].subj !== before.plan.subj) {
          violation(step, `approved "${added[0].subj}" but the card showed "${before.plan.subj}" when the hold began (mid-hold card: "${mid?.plan?.subj}")`);
        }
        if (added.length === 1 && (before.flow.conflict || (before.review && before.review.trial === null))) violation(step, 'two-hand step approved a blocked card');
      }
    }
    failures = 0;
  } catch (e) {
    failures++;
    out(`step ${step}: ${what} -> emulator command failed: ${String(e.message).slice(0, 160)}`);
    try { pinch('hand-right', 0); } catch {}
    if (failures >= 3) {
      out('three failures in a row: stopping');
      break;
    }
    st = null;
    continue;
  }
  out(`step ${step}: ${what} -> ${fmt(st)}`);
  checkAlways(step, st, errsBefore);
}

out(`\nDONE seed=${SEED}: ${violations} violation(s), ${notes.length} note(s)`);
for (const n of notes) out(`  note ${n}`);
try { pinch('hand-right', 0); } catch {}
