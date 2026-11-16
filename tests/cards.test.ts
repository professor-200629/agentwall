import { describe, expect, it, vi } from 'vitest';

// The drawing helpers live in the same file as CanvasPanel, which needs the 3D library. The card
// drawing itself is plain canvas calls, so the library is replaced by empty classes here and the
// canvas by one that writes down what was drawn.
vi.mock('@iwsdk/core', () => ({
  CanvasTexture: class {},
  Mesh: class {},
  MeshBasicMaterial: class {},
  PlaneGeometry: class {},
  SRGBColorSpace: 'srgb',
}));

import calendarJson from '../src/data/sample-calendar.json';
import { makePlan } from '../src/logic/plan.js';
import type { CalendarData } from '../src/logic/scheduler.js';
import { COLORS } from '../src/ui/canvas-panel.js';
import { drawInviteCard, type InviteExtras } from '../src/ui/cards.js';

const A = calendarJson as CalendarData;
const W = 640;
const H = 760;

/** A canvas that remembers every text and every filled shape with the colour it was drawn in. */
function recorder() {
  const texts: { text: string; fill: string }[] = [];
  const shapes: string[] = [];
  const state: Record<string, unknown> = { fillStyle: '', font: '' };
  const c = new Proxy(state, {
    get(target, key: string) {
      if (key === 'fillText') return (text: string) => void texts.push({ text, fill: String(target.fillStyle) });
      if (key === 'fill' || key === 'fillRect') return () => void shapes.push(String(target.fillStyle));
      if (key === 'measureText') {
        return (text: string) => {
          const px = Number(/(\d+)px/.exec(String(target.font))?.[1] ?? 20);
          return { width: text.length * px * 0.5 };
        };
      }
      if (key in target) return target[key];
      return () => undefined; // paths, clips, save and restore draw nothing here
    },
    set(target, key: string, value) {
      target[key] = value;
      return true;
    },
  });
  return {
    c: c as unknown as CanvasRenderingContext2D,
    texts,
    words: () => texts.map((t) => t.text).join(' '),
    colours: () => [...texts.map((t) => t.fill), ...shapes],
  };
}

const amber = (colour: string) => colour === COLORS.amber || colour.startsWith('rgba(242, 184, 75');

const TRADE_OFF = 'Late in the day for both of you';
const CONFLICT = 'Tue 1:00 PM overlaps a new busy block';

function extras(over: Partial<InviteExtras> = {}): InviteExtras {
  return { tradeOff: TRADE_OFF, sendingLeft: null, receipt: null, conflict: null, ...over };
}

describe('the invite card on the desk: amber is only for a decision that waits', () => {
  const plan = makePlan(A);

  it('the sample plan has an invite and is not approved yet', () => {
    expect(plan.invite).not.toBeNull();
    expect(plan.approval).not.toBe('approved');
  });

  it('a card waiting for the hold shows its trade-off in amber', () => {
    const r = recorder();
    drawInviteCard(r.c, W, H, plan, extras());
    expect(r.words()).toContain('NEEDS APPROVAL');
    const line = r.texts.find((t) => t.text.includes(TRADE_OFF));
    expect(line?.fill).toBe(COLORS.amber);
    expect(r.words()).toContain('Pinch and hold 1 s to approve');
  });

  it('a blocked card shows the conflict and no trade-off, and nothing on it is amber', () => {
    const r = recorder();
    drawInviteCard(r.c, W, H, plan, extras({ conflict: CONFLICT }));
    expect(r.words()).toContain('BLOCKED');
    expect(r.words()).toContain(CONFLICT);
    expect(r.words()).toContain('Nothing can be sent from this.');
    // The old time no longer fits, so a note about that old time says nothing useful,
    // and there is nothing on this card to decide: no amber.
    expect(r.words()).not.toContain(TRADE_OFF);
    expect(r.colours().filter(amber)).toEqual([]);
    expect(r.words()).not.toContain('to approve');
  });

  it('a replacement on trial shows its trade-off pale: amber stays for the pill and the hold line', () => {
    const r = recorder();
    drawInviteCard(r.c, W, H, plan, extras({ change: { was: 'Tue 1:00 PM', now: 'Wed 5:30 PM' } }));
    const line = r.texts.find((t) => t.text.includes(TRADE_OFF));
    expect(line).toBeDefined();
    expect(amber(line!.fill)).toBe(false);
    const hold = r.texts.find((t) => t.text.includes('Pinch and hold 1 s to approve Wed 5:30 PM'));
    expect(hold?.fill).toBe(COLORS.amber);
  });
});
