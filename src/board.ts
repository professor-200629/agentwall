/**
 * Agent Wall's visuals. "The wall thinks, the desk decides."
 *
 * - `object` (on the wall): header with chips, the WEEK MURAL (the agent
 *   strikes out every time it can't use, then one gold slot stays lit),
 *   pinchable runner-up pills, a Re-plan card, and the demo outbox tray.
 * - `desk` (on the user's real table, or above their lap): the invite card,
 *   its amber glow and the pinch-and-hold ring.
 *
 * Interactive parts are separate meshes so BoardSystem can make each one its
 * own ray-interactable entity. The board only draws; it never reads input.
 * Board-local metres: origin at the centre, +X right, +Y up, +Z out of the wall.
 */
import {
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Euler,
  Quaternion,
  RingGeometry,
  Vector3,
} from '@iwsdk/core';
import { CHIPS, type ChipLook } from './chips.js';
import type { OutboxItem, Plan } from './logic/plan.js';
import { BOARD } from './logic/placement.js';
import type { WeekModel } from './logic/week.js';
import { CanvasPanel, COLORS, drawWrapped, font, pill, PX_PER_M, roundRect } from './ui/canvas-panel.js';
import { CHIP_FONT_PX, drawAltRow, drawChip, drawGlow, drawInviteCard, drawTray, type InviteExtras } from './ui/cards.js';
import { drawMural, muralGrid, type MuralHover, type MuralView } from './ui/mural.js';
import { playLand, playWhoosh } from './ui/sound.js';

export type BoardStatus = 'searching' | 'wall' | 'same-wall' | 'fallback' | 'preview';

const STATUS: Record<BoardStatus, { chip: string; color: string; hint: string }> = {
  searching: { chip: 'LOOKING FOR A WALL', color: '#9aa4b2', hint: 'Looking for a wall…' },
  wall: { chip: 'ON YOUR WALL', color: COLORS.green, hint: '' },
  'same-wall': { chip: 'BACK ON YOUR WALL', color: COLORS.green, hint: '' },
  fallback: { chip: 'FLOATING · NO WALL FOUND', color: COLORS.amber, hint: '' },
  preview: { chip: 'DESKTOP PREVIEW', color: COLORS.link, hint: '' },
};

const px = (n: number) => n / PX_PER_M;

/** Rectangles in board metres (x/y = centre). */
export const LAYOUT = (() => {
  const W = BOARD.width;
  const H = BOARD.height;
  const margin = 0.035;
  const header = 0.245;
  const trayH = 0.085;
  const top = H / 2 - header - 0.01;
  const bottom = -H / 2 + margin + trayH + 0.012;
  const left = -W / 2 + margin;
  // Chip row inside the header, left to right; widths fit each label.
  const measure = document.createElement('canvas').getContext('2d');
  let x = left;
  const chipH = px(60); // 5.9 cm tall: easier to hit with a hand ray
  const chipY = H / 2 - px(182) - chipH / 2;
  const chips = CHIPS.map((chip) => {
    let w = 0.12;
    if (measure) {
      measure.font = `600 ${CHIP_FONT_PX}px system-ui, sans-serif`;
      // The mic chip also shows "● Listening 5", so size it for the longest label.
      const longest = chip.id === 'mic' ? '● Listening 5' : chip.label;
      w = px(measure.measureText(longest).width + 40);
    }
    const r = { x: x + w / 2, y: chipY, w, h: chipH };
    x += w + px(10);
    return r;
  });
  const mural = { x: 0, y: (top + bottom) / 2, w: W - margin * 2, h: top - bottom };
  // "Move board" button under the status chip (the first Quest tester could not move it).
  const moveW = px(210);
  const moveH = px(56);
  const move = { x: W / 2 - margin - moveW / 2, y: H / 2 - px(78) - moveH / 2, w: moveW, h: moveH };
  const replan = { x: 0, y: mural.y - mural.h / 2 + 0.135, w: 0.8, h: 0.13 };
  return {
    chips,
    mural,
    move,
    pill: { w: 0.2, h: 0.05 },
    replan,
    replanYes: { x: replan.x + 0.17, y: replan.y, w: 0.14, h: 0.07 },
    replanNo: { x: replan.x + 0.32, y: replan.y, w: 0.13, h: 0.07 },
    tray: { x: 0, y: -H / 2 + margin + trayH / 2, w: W - margin * 2, h: trayH },
  };
})();

/** The desk invite card is drawn at wall-card resolution and shrunk on the desk. */
export const INVITE = { w: 0.62, h: 0.52, deskScale: 0.55 };

/** Layers in front of the board, in metres, so nothing z-fights. */
const Z = { mural: 0.004, pill: 0.008, replan: 0.012, button: 0.016, cue: 0.02 };
const GLOW_PAD = 0.03;
const RING_SEGMENTS = 64;
/** Seconds the agent's sweep across the week takes. */
export const SWEEP_SECONDS = 1.8;
/** The invite's flight from the gold slot on the wall down to the desk. */
export const FLY = { newPlanSeconds: 0.9, pickSeconds: 0.55, arc: 0.22, startScale: 0.3 };

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export interface BoardView {
  plan: Plan | null;
  week: WeekModel | null;
  invite: InviteExtras;
  replanText: string | null;
  fresh: Set<string>;
}

export class Board {
  readonly object = new Group();
  readonly desk = new Group();
  status: BoardStatus = 'searching';
  private plan: Plan | null = null;
  private week: WeekModel | null = null;
  private fresh = new Set<string>();
  /** The board itself: pinchable only so the hand ray shows a cursor anywhere on it. */
  readonly backPanel = new CanvasPanel(BOARD.width, BOARD.height, 'board');
  readonly moveButton = new CanvasPanel(LAYOUT.move.w, LAYOUT.move.h, 'move-board');
  private moveLook = '';
  readonly mural = new CanvasPanel(LAYOUT.mural.w, LAYOUT.mural.h, 'week-mural');
  readonly altRows = [0, 1].map((i) => new CanvasPanel(LAYOUT.pill.w, LAYOUT.pill.h, `alt-slot-${i}`));
  private tray = new CanvasPanel(LAYOUT.tray.w, LAYOUT.tray.h, 'outbox-tray');
  readonly chipPanels = LAYOUT.chips.map((r, i) => new CanvasPanel(r.w, r.h, `chip-${CHIPS[i].id}`));
  private replanPanel = new CanvasPanel(LAYOUT.replan.w, LAYOUT.replan.h, 'replan-card');
  readonly replanButtons = [
    new CanvasPanel(LAYOUT.replanYes.w, LAYOUT.replanYes.h, 'replan-yes'),
    new CanvasPanel(LAYOUT.replanNo.w, LAYOUT.replanNo.h, 'replan-no'),
  ];
  private cue = new CanvasPanel(BOARD.width + 0.08, BOARD.height + 0.08, 'wall-cue');
  readonly inviteCard = new CanvasPanel(INVITE.w, INVITE.h, 'invite-card');
  private glow = new CanvasPanel(INVITE.w + GLOW_PAD * 2, INVITE.h + GLOW_PAD * 2, 'invite-glow');
  private ring = new Group();
  private ringFill: Mesh<RingGeometry, MeshBasicMaterial>;
  private chipLooks: string[] = CHIPS.map(() => '');
  private agentLine = { text: '', color: COLORS.muted };
  private invitePlan: Plan | null = null;
  private inviteKey = '';
  private replanText: string | null = null;
  private hoverInvite = false;
  private hoverAlt: number | null = null;
  private hoverReplan: number | null = null;
  /** Sweep progress 0..1, and the last drawn sweep step (redraw only on change). */
  private sweep = 1;
  private sweepStep = -1;
  private muralHover: MuralHover | null = null;
  /** Where the desk card belongs (set by the system: real table or lap). */
  private deskPos = new Vector3();
  private deskQuat = new Quaternion();
  /** Flight state: waiting for the sweep to end, then flying for flyDur seconds. */
  private flyPending = false;
  private flyT = -1;
  private flyDur: number = FLY.newPlanSeconds;
  private flyFrom = new Vector3();
  private flyFromQuat = new Quaternion();
  private flySlotId: string | null = null;
  /** Test hook: stretch the flight so slow emulator commands can see it mid-air. */
  flySlowdown = 1;
  private tmpV = new Vector3();
  private muralHoverKey = '';
  private cueT = -1;
  private popT = -1;

  constructor() {
    this.object.name = 'agent-wall';
    this.desk.name = 'agent-desk';
    this.add(this.object, this.backPanel.mesh, 0, 0, 0, 1);
    this.add(this.object, this.mural.mesh, LAYOUT.mural.x, LAYOUT.mural.y, Z.mural, 3);
    this.altRows.forEach((row) => this.add(this.object, row.mesh, 0, 0, Z.pill, 4));
    this.add(this.object, this.tray.mesh, LAYOUT.tray.x, LAYOUT.tray.y, Z.mural, 3);
    this.chipPanels.forEach((chip, i) => this.add(this.object, chip.mesh, LAYOUT.chips[i].x, LAYOUT.chips[i].y, Z.pill, 4));
    this.add(this.object, this.replanPanel.mesh, LAYOUT.replan.x, LAYOUT.replan.y, Z.replan, 5);
    this.add(this.object, this.replanButtons[0].mesh, LAYOUT.replanYes.x, LAYOUT.replanYes.y, Z.button, 6);
    this.add(this.object, this.replanButtons[1].mesh, LAYOUT.replanNo.x, LAYOUT.replanNo.y, Z.button, 6);
    this.add(this.object, this.moveButton.mesh, LAYOUT.move.x, LAYOUT.move.y, Z.pill, 4);
    this.add(this.object, this.cue.mesh, 0, 0, Z.cue, 7);
    CHIPS.forEach((_c, i) => this.setChip(i, 'normal'));
    this.setMove('⤢ Move board', false);

    // Bigger, invisible hit areas round every button: the first Quest tester said
    // pinching the chips "requires extreme accuracy". Chip pads meet halfway across
    // the gap between chips, so there is no dead zone and no overlap.
    this.chipPanels.forEach((chip, i) => hitPad(chip.mesh, LAYOUT.chips[i].w, LAYOUT.chips[i].h, px(5), px(16)));
    // Pills sit on the touchable week: pad sideways only, so free times above and below stay pinchable.
    this.altRows.forEach((row) => hitPad(row.mesh, LAYOUT.pill.w, LAYOUT.pill.h, px(12), px(2)));
    this.replanButtons.forEach((b, i) => {
      const r = i === 0 ? LAYOUT.replanYes : LAYOUT.replanNo;
      hitPad(b.mesh, r.w, r.h, px(10), px(14));
    });
    hitPad(this.moveButton.mesh, LAYOUT.move.w, LAYOUT.move.h, px(14), px(12));

    // Desk: glow behind the invite, the invite, and the ring in front.
    this.add(this.desk, this.glow.mesh, 0, 0, -0.002, 2);
    this.add(this.desk, this.inviteCard.mesh, 0, 0, 0, 3);
    const disc = new Mesh(
      new CircleGeometry(0.085, 48),
      new MeshBasicMaterial({ color: 0x10141c, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    const track = new Mesh(
      new RingGeometry(0.055, 0.072, RING_SEGMENTS, 1),
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    this.ringFill = new Mesh(
      new RingGeometry(0.055, 0.072, RING_SEGMENTS, 1, Math.PI / 2, Math.PI * 2),
      // transparent so it renders after (on top of) the transparent disc and track
      new MeshBasicMaterial({ color: COLORS.amber, side: DoubleSide, transparent: true, depthWrite: false }),
    );
    this.ringFill.scale.x = -1; // mirror: counter-clockwise geometry fills clockwise
    this.ringFill.position.z = 0.001;
    this.ring.add(disc, track, this.ringFill);
    disc.renderOrder = 6;
    track.renderOrder = 7;
    this.ringFill.renderOrder = 8;
    this.ring.position.set(0, 0, 0.012);
    this.ring.visible = false;
    this.desk.add(this.ring);
    this.desk.scale.setScalar(INVITE.deskScale);
    this.desk.visible = false;

    for (const m of [this.mural, this.glow, this.replanPanel, ...this.altRows, ...this.replanButtons, this.cue]) {
      m.mesh.visible = false;
    }
    this.glow.draw((c, w, h) => drawGlow(c, w, h, GLOW_PAD * PX_PER_M * 0.5));
    this.cue.draw((c, w, h) => {
      c.shadowColor = '#7fb2ff';
      c.shadowBlur = 30;
      c.lineWidth = 10;
      c.strokeStyle = '#9cc4ff';
      roundRect(c, 20, 20, w - 40, h - 40, 40);
      c.stroke();
    });
    this.replanButtons[0].draw((c, w, h) => drawButton(c, w, h, 'Re-plan', true, false));
    this.replanButtons[1].draw((c, w, h) => drawButton(c, w, h, 'Not now', false, false));
    this.setOutbox([]);
    this.object.visible = false;
    this.drawBack();
  }

  /** What the hand ray is over on the week (redraws the mural only when it changes). */
  setMuralHover(hover: MuralHover | null): void {
    const key = hover ? `${hover.kind}|${hover.day}|${hover.start}|${hover.label}` : '';
    if (key === this.muralHoverKey) return;
    this.muralHoverKey = key;
    this.muralHover = hover;
    if (this.sweep >= 1) {
      this.sweepStep = -1;
      this.drawMuralIfNeeded();
    }
  }

  /** Test hook: what the mural hover shows now. */
  get muralHoverLabel(): string | null {
    return this.muralHover?.label ?? null;
  }

  /** Test hook: the world position of a half hour's centre on the mural. */
  muralPoint(dayIndex: number, minute: number): [number, number, number] | null {
    const week = this.week;
    if (!week) return null;
    const w = this.mural.canvas.width;
    const h = this.mural.canvas.height;
    const g = muralGrid(w, h, week);
    const x = g.x(dayIndex) + g.colW / 2;
    const y = g.y(minute) + g.rowH / 2;
    const local = new Vector3((x / w - 0.5) * LAYOUT.mural.w, (0.5 - y / h) * LAYOUT.mural.h, 0);
    return this.mural.mesh.localToWorld(local).toArray() as [number, number, number];
  }

  /** A hit on the mural (texture uv) as a day column and minute, or null outside the grid. */
  muralSpot(u: number, v: number): { dayIndex: number; minute: number } | null {
    const week = this.week;
    if (!week) return null;
    const w = this.mural.canvas.width;
    const h = this.mural.canvas.height;
    const g = muralGrid(w, h, week);
    const x = u * w;
    const y = (1 - v) * h;
    const dayIndex = Math.floor((x - g.x(0)) / g.colW);
    const minute = week.dayStart + ((y - g.y(week.dayStart)) / g.rowH) * week.step;
    if (dayIndex < 0 || dayIndex >= week.days.length || minute < week.dayStart || minute >= week.dayEnd) return null;
    return { dayIndex, minute };
  }

  /** The Move button's label (e.g. a countdown) and hover state. */
  setMove(label: string, hovered: boolean): void {
    const key = `${label}|${hovered}`;
    if (key === this.moveLook) return;
    this.moveLook = key;
    this.moveButton.draw((c, w, h) => drawButton(c, w, h, label, false, hovered, 22));
  }

  private add(parent: Group, mesh: Mesh, x: number, y: number, z: number, order: number): void {
    mesh.position.set(x, y, z);
    mesh.renderOrder = order;
    parent.add(mesh);
  }

  setStatus(status: BoardStatus): void {
    if (status === this.status) return;
    const onWall = (st: BoardStatus) => st === 'wall' || st === 'same-wall';
    const landed = onWall(status) && !onWall(this.status);
    this.status = status;
    this.drawBack();
    if (landed) this.landCue();
  }

  /** Brief glowing outline when the board locks onto a real wall (Meta: cue surface landing). */
  landCue(): void {
    this.cueT = 0;
    this.cue.mesh.visible = true;
  }

  /**
   * Show the whole state. Redraws only what changed. A new plan (new slot or
   * rule) replays the agent's sweep across the week unless `animate` is false.
   */
  render(view: BoardView, animate = true): void {
    const planChanged = view.plan !== this.plan;
    const newPlan =
      planChanged &&
      (!this.plan ||
        !view.plan ||
        this.plan.slot?.id !== view.plan.slot?.id ||
        this.plan.constraintText !== view.plan.constraintText);
    const weekChanged = view.week !== this.week || view.fresh.size !== this.fresh.size;
    // A new chosen time: the invite flies from that slot on the wall down to the desk.
    const slotId = view.plan?.invite ? (view.plan.slot?.id ?? null) : null;
    if (slotId !== this.flySlotId) {
      this.flySlotId = slotId;
      if (slotId) {
        this.flyPending = true;
        this.flyT = -1;
        this.flyDur = (animate ? FLY.newPlanSeconds : FLY.pickSeconds) * this.flySlowdown;
      }
    }
    this.plan = view.plan;
    this.week = view.week;
    this.fresh = view.fresh;

    if (planChanged) this.drawBack();
    if (newPlan && view.plan) {
      this.sweep = animate ? 0 : 1;
      this.sweepStep = -1;
    }
    this.mural.mesh.visible = view.plan !== null && view.week !== null;
    if (planChanged || weekChanged) this.sweepStep = -1; // force a mural redraw
    this.drawMuralIfNeeded();

    // Desk invite card.
    this.desk.visible = view.plan?.invite != null && this.object.visible;
    // Redraw when the plan object or the extras change (versions can repeat after a reset).
    const key = JSON.stringify(view.invite);
    if (view.plan && (view.plan !== this.invitePlan || key !== this.inviteKey)) {
      this.invitePlan = view.plan;
      this.inviteKey = key;
      const plan = view.plan;
      this.inviteCard.draw((c, w, h) => drawInviteCard(c, w, h, plan, view.invite));
    }

    // Re-plan card.
    if (view.replanText !== this.replanText) {
      this.replanText = view.replanText;
      const text = view.replanText;
      const show = text !== null;
      this.replanPanel.mesh.visible = show;
      this.replanButtons.forEach((b) => (b.mesh.visible = show));
      if (text) this.replanPanel.draw((c, w, h) => drawReplanCard(c, w, h, text));
    }
  }

  /** Redraw one chip, only when its look or label changed. */
  setChip(i: number, look: ChipLook, label = CHIPS[i].label): void {
    const key = `${look}|${label}`;
    if (this.chipLooks[i] === key) return;
    this.chipLooks[i] = key;
    this.chipPanels[i].draw((c, w, h) => drawChip(c, w, h, label, look));
  }

  /** The "who planned this / what is happening" line in the header. */
  setAgentLine(text: string, tone: 'muted' | 'ai' | 'warn' | 'ok' = 'muted'): void {
    const color = { muted: COLORS.muted, ai: COLORS.link, warn: COLORS.amber, ok: COLORS.green }[tone];
    if (text === this.agentLine.text && color === this.agentLine.color) return;
    this.agentLine = { text, color };
    this.drawBack();
  }

  setOutbox(items: OutboxItem[]): void {
    this.tray.draw((c, w, h) => drawTray(c, w, h, items));
  }

  /** Hover feedback: brighter glow on the invite, highlighted pill or button. */
  setHover(invite: boolean, alt: number | null, replan: number | null = null): void {
    this.hoverInvite = invite;
    if (alt !== this.hoverAlt) {
      this.hoverAlt = alt;
      this.drawPills();
    }
    if (replan !== this.hoverReplan) {
      this.hoverReplan = replan;
      this.replanButtons[0].draw((c, w, h) => drawButton(c, w, h, 'Re-plan', true, replan === 0));
      this.replanButtons[1].draw((c, w, h) => drawButton(c, w, h, 'Not now', false, replan === 1));
    }
  }

  /** 0..1 approval progress; 0 hides the ring. */
  setHold(progress: number): void {
    this.ring.visible = progress > 0;
    const segs = Math.round(progress * RING_SEGMENTS);
    this.ringFill.geometry.setDrawRange(0, segs * 6);
  }

  /** A small "pop" of the desk card on approval. */
  celebrate(): void {
    this.popT = 0;
  }

  /** True while the agent's sweep (or the invite's flight to the desk) is still playing. */
  get sweeping(): boolean {
    return this.sweep < 1 || this.flyPending || this.flyT >= 0;
  }

  /** True while the invite is in the air between the wall and the desk. */
  get flying(): boolean {
    return this.flyT >= 0;
  }

  /** Where the desk card should rest; applied at once unless it is flying there. */
  setDeskPose(x: number, y: number, z: number, rotation: Euler): void {
    this.deskPos.set(x, y, z);
    this.deskQuat.setFromEuler(rotation);
    if (this.flyT < 0) {
      this.desk.position.copy(this.deskPos);
      this.desk.quaternion.copy(this.deskQuat);
    }
  }

  private startFlight(): boolean {
    const plan = this.plan;
    const week = this.week;
    const slot = plan?.slot;
    if (!plan || !week || !slot || !this.object.visible) return false;
    const day = week.days.indexOf(slot.day);
    const from = day >= 0 ? this.muralPoint(day, slot.start) : null;
    if (!from) return false;
    this.flyFrom.set(from[0], from[1], from[2]);
    this.object.getWorldQuaternion(this.flyFromQuat);
    this.flyT = 0;
    playWhoosh();
    return true;
  }

  /** Per-frame animation. Cheap: no allocation; canvases redraw only on sweep steps. */
  tick(dt: number, time: number): void {
    const needs = this.plan?.invite != null && this.plan.approval === 'needs' && !this.sweeping;
    this.glow.mesh.visible = needs && this.desk.visible;
    if (this.glow.mesh.visible) {
      const pulse = 0.55 + 0.35 * Math.sin(time * 3.2);
      (this.glow.mesh.material as MeshBasicMaterial).opacity = this.hoverInvite ? 1 : pulse;
    }
    if (this.sweep < 1) {
      this.sweep = Math.min(1, this.sweep + dt / SWEEP_SECONDS);
      this.drawMuralIfNeeded();
    }
    if (this.cueT >= 0) {
      this.cueT += dt;
      const t = Math.min(1, this.cueT / 0.9);
      this.cue.mesh.scale.setScalar(1.06 - 0.06 * t);
      (this.cue.mesh.material as MeshBasicMaterial).opacity = 1 - t;
      if (t >= 1) {
        this.cueT = -1;
        this.cue.mesh.visible = false;
      }
    }
    // The invite flight: wait for the sweep, then arc from the gold slot to the desk.
    if (this.flyPending && this.sweep >= 1) {
      this.flyPending = false;
      if (!this.startFlight()) {
        this.desk.position.copy(this.deskPos);
        this.desk.quaternion.copy(this.deskQuat);
      }
    }
    if (this.flyPending) this.desk.visible = false; // it appears from the wall
    if (this.flyT >= 0) {
      this.flyT += dt;
      const t = Math.min(1, this.flyT / this.flyDur);
      const e = easeInOut(t);
      this.desk.position.lerpVectors(this.flyFrom, this.deskPos, e);
      this.desk.position.y += Math.sin(Math.PI * e) * FLY.arc;
      this.desk.quaternion.slerpQuaternions(this.flyFromQuat, this.deskQuat, e);
      this.desk.scale.setScalar(INVITE.deskScale * (FLY.startScale + (1 - FLY.startScale) * e));
      if (t >= 1) {
        this.flyT = -1;
        this.desk.position.copy(this.deskPos);
        this.desk.quaternion.copy(this.deskQuat);
        this.desk.scale.setScalar(INVITE.deskScale);
        playLand();
      }
    }
    if (this.popT >= 0) {
      this.popT += dt;
      const t = Math.min(1, this.popT / 0.4);
      this.desk.scale.setScalar(INVITE.deskScale * (1 + 0.08 * Math.sin(Math.PI * t)));
      if (t >= 1) this.popT = -1;
    }
  }

  private drawMuralIfNeeded(): void {
    const plan = this.plan;
    const week = this.week;
    if (!plan || !week) return;
    const steps = week.days.length + 1;
    const step = this.sweep >= 1 ? steps : Math.floor(this.sweep * steps);
    if (step === this.sweepStep) return;
    this.sweepStep = step;
    const view: MuralView = {
      week,
      chosen: plan.slot,
      alternatives: plan.alternatives,
      progress: this.sweep >= 1 ? 1 : step / steps,
      reason: plan.reason,
      tag: plan.by === 'ai' ? 'AI' : plan.by === 'you' ? 'YOU' : 'RULES',
      fresh: this.fresh,
      hover: this.sweep >= 1 ? this.muralHover : null,
    };
    this.mural.draw((c, w, h) => drawMural(c, w, h, view));
    this.placePills();
    this.drawPills();
  }

  /** Put the runner-up pills over their cells on the mural (visible once the sweep ends). */
  private placePills(): void {
    const plan = this.plan;
    const week = this.week;
    const done = this.sweep >= 1;
    this.altRows.forEach((row, i) => {
      const alt = plan?.alternatives[i];
      const di = alt && week ? week.days.indexOf(alt.day) : -1;
      row.mesh.visible = !!alt && di >= 0 && done && this.mural.mesh.visible;
      if (!row.mesh.visible || !alt || !week) return;
      const g = muralGrid(this.mural.w, this.mural.h, week);
      const cx = g.x(di) + g.colW / 2;
      const cy = g.y(alt.start) + g.rowH / 2;
      row.mesh.position.set(
        LAYOUT.mural.x - LAYOUT.mural.w / 2 + px(cx),
        LAYOUT.mural.y + LAYOUT.mural.h / 2 - px(cy),
        Z.pill,
      );
    });
  }

  private drawPills(): void {
    const alts = this.plan?.alternatives ?? [];
    this.altRows.forEach((row, i) => {
      if (row.mesh.visible) row.draw((c, w, h) => drawAltRow(c, w, h, alts[i], this.hoverAlt === i));
    });
  }

  private drawBack(): void {
    const s = STATUS[this.status];
    const plan = this.plan;
    this.backPanel.draw((c, W, H) => {
      roundRect(c, 4, 4, W - 8, H - 8, 36);
      c.fillStyle = COLORS.board;
      c.fill();
      c.lineWidth = 4;
      c.strokeStyle = COLORS.line;
      c.stroke();

      font(c, 54, 700);
      c.fillStyle = COLORS.text;
      c.fillText('Agent Wall', 44, 86);
      // Which build this is, so a tester can tell us what they ran.
      font(c, 14, 500);
      c.fillStyle = COLORS.faint;
      const build = `build ${__AGENTWALL_BUILD__}`;
      c.fillText(build, W - 44 - c.measureText(build).width, H - 12);
      pill(c, s.chip, W - 44, 46, s.color, COLORS.ink, 20, true);

      font(c, 28, 500);
      c.fillStyle = COLORS.text;
      const task = plan ? `Task · ${plan.task}` : s.hint || 'Ask your agent: pinch a chip below, or 🎤 Speak';
      drawWrapped(c, task, 44, 130, W - 88 - LAYOUT.move.w * PX_PER_M - 20, 34, 1);
      font(c, 24);
      c.fillStyle = COLORS.muted;
      const rule = plan?.constraintText ? `Rule · ${plan.constraintText}` : 'Rule · none';
      c.fillText(rule, 44, 164);
      if (this.agentLine.text) {
        const ruleW = c.measureText(rule).width;
        font(c, 22, 600);
        c.fillStyle = this.agentLine.color;
        const maxW = W - 88 - ruleW - 40;
        let t = this.agentLine.text;
        while (t.length > 4 && c.measureText(t).width > maxW) t = `${t.slice(0, -2)}…`;
        c.fillText(t, W - 44 - c.measureText(t).width, 164);
      }

      if (!plan) {
        const top = 266;
        const bottom = (BOARD.height / 2 - (LAYOUT.tray.y + LAYOUT.tray.h / 2)) * PX_PER_M - 14;
        c.setLineDash([14, 12]);
        c.lineWidth = 3;
        c.strokeStyle = COLORS.line;
        roundRect(c, 44, top, W - 88, bottom - top, 24);
        c.stroke();
        c.setLineDash([]);
        const mid = (top + bottom) / 2;
        font(c, 32, 600);
        c.fillStyle = COLORS.text;
        const hint = 'Pinch “Find time + draft invite” to start';
        c.fillText(hint, (W - c.measureText(hint).width) / 2, mid - 8);
        font(c, 26);
        c.fillStyle = COLORS.muted;
        const how = 'Point your hand at a chip, then tap your thumb and index finger together';
        c.fillText(how, (W - c.measureText(how).width) / 2, mid + 36);
      }
    });
  }
}

/**
 * An invisible, bigger hit area behind a button. The mesh stays "visible" (IWSDK's
 * pointers skip hidden objects: filter isObjectTreeVisible); only its material is
 * switched off, so three.js never draws it.
 */
function hitPad(mesh: Mesh, w: number, h: number, padX: number, padY: number): void {
  const pad = new Mesh(new PlaneGeometry(w + padX * 2, h + padY * 2), new MeshBasicMaterial({ visible: false }));
  pad.name = `${mesh.name || 'button'}-hit`;
  pad.position.z = -0.0005;
  mesh.add(pad);
}

function drawButton(
  c: CanvasRenderingContext2D,
  w: number,
  h: number,
  text: string,
  primary: boolean,
  hover: boolean,
  size = 26,
): void {
  roundRect(c, 2, 2, w - 4, h - 4, (h - 4) / 2);
  c.fillStyle = primary ? (hover ? '#9cc4ff' : COLORS.link) : hover ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.12)';
  c.fill();
  c.lineWidth = 3;
  c.strokeStyle = primary ? COLORS.link : COLORS.line;
  c.stroke();
  let px = size;
  font(c, px, 800);
  while (px > 14 && c.measureText(text).width > w - 24) font(c, --px, 800);
  c.fillStyle = primary ? COLORS.ink : COLORS.text;
  c.textBaseline = 'middle';
  c.fillText(text, (w - c.measureText(text).width) / 2, h / 2 + 1);
  c.textBaseline = 'alphabetic';
}

function drawReplanCard(c: CanvasRenderingContext2D, w: number, h: number, text: string): void {
  roundRect(c, 3, 3, w - 6, h - 6, 22);
  c.fillStyle = 'rgba(40, 22, 22, 0.97)';
  c.fill();
  c.lineWidth = 4;
  c.strokeStyle = '#e5534b';
  c.stroke();
  font(c, 18, 800);
  c.fillStyle = '#ff9a90';
  c.fillText('AGENT NOTICED A CONFLICT', 24, 34);
  font(c, 22, 600);
  c.fillStyle = COLORS.text;
  drawWrapped(c, text, 24, 66, w * 0.55, 28, 2);
}
