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
import { blockedWord, itemSlot, kindOf } from './logic/review.js';
import { clock, dayLabel, type Slot } from './logic/scheduler.js';
import type { WeekModel } from './logic/week.js';
import { CanvasPanel, COLORS, drawWrapped, font, pill, PX_PER_M, roundRect } from './ui/canvas-panel.js';
import {
  CHIP_FONT_PX,
  drawAltRow,
  drawCandidate,
  drawChip,
  drawGlow,
  drawInviteCard,
  drawReviewBar,
  drawTray,
  type InviteExtras,
} from './ui/cards.js';
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
  // Voice on/off, just left of Move.
  const voiceW = px(64);
  const voice = { x: move.x - moveW / 2 - px(12) - voiceW / 2, y: move.y, w: voiceW, h: moveH };
  const replan = { x: 0, y: mural.y - mural.h / 2 + 0.135, w: 0.8, h: 0.13 };
  // The calendar control sits beside the outbox tray: it acts on what you approved.
  const calW = px(262);
  const trayW = W - margin * 2 - calW - px(12);
  const tray = { x: left + trayW / 2, y: -H / 2 + margin + trayH / 2, w: trayW, h: trayH };
  const calendar = { x: W / 2 - margin - calW / 2, y: tray.y, w: calW, h: trayH };
  // Conflict review: one bar where the chips were (they are hidden meanwhile, except the mic),
  // with two big "try this time" targets. About 22 x 9 cm each: a hand ray that wobbles
  // 1 degree moves about 3 cm at 2 m.
  const mic = chips[chips.length - 1];
  const gap = px(12);
  const barRight = mic.x - mic.w / 2 - gap;
  const barTop = H / 2 - px(140);
  const barBottom = H / 2 - px(250);
  const review = { x: (left + barRight) / 2, y: (barTop + barBottom) / 2, w: barRight - left, h: barTop - barBottom };
  const cancelW = px(116);
  const candH = review.h - px(18);
  const candW = Math.min(px(224), Math.max(px(150), (review.w - px(300) - cancelW - gap * 4) / 2));
  const reviewCancel = { x: barRight - gap - cancelW / 2, y: review.y, w: cancelW, h: candH };
  const cand1 = { x: reviewCancel.x - cancelW / 2 - gap - candW / 2, y: review.y, w: candW, h: candH };
  const cand0 = { x: cand1.x - candW - gap, y: review.y, w: candW, h: candH };
  return {
    chips,
    mural,
    move,
    voice,
    pill: { w: 0.2, h: 0.05 },
    replan,
    replanYes: { x: replan.x + 0.17, y: replan.y, w: 0.14, h: 0.07 },
    replanNo: { x: replan.x + 0.32, y: replan.y, w: 0.13, h: 0.07 },
    tray,
    calendar,
    review,
    reviewCancel,
    candidates: [cand0, cand1],
    /** Room for the review bar's words, left of the first target (canvas pixels). */
    reviewTextPx: Math.max(120, (cand0.x - candW / 2 - gap - left) * PX_PER_M - 30),
  };
})();

/** The desk invite card is drawn at wall-card resolution and shrunk on the desk. */
export const INVITE = { w: 0.62, h: 0.52, deskScale: 0.55 };

/** Layers in front of the board, in metres, so nothing z-fights. */
const Z = { mural: 0.004, pill: 0.008, replan: 0.012, button: 0.016, cue: 0.02 };
const GLOW_PAD = 0.03;
const DESK_HINT = { w: 0.56, h: 0.05 };
const RING_SEGMENTS = 64;
/** Seconds the agent's sweep across the week takes. */
export const SWEEP_SECONDS = 1.8;
/** The invite's flight from the gold slot on the wall down to the desk. */
export const FLY = { newPlanSeconds: 0.9, pickSeconds: 0.55, arc: 0.22, startScale: 0.3 };

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** The agent's card on the wall: a conflict (re-plan?) or a next-step offer. */
export interface AgentCardView {
  title: string;
  text: string;
  yes: string;
  no: string;
  tone: 'warn' | 'next';
  /** On an empty board: the one line that says where to start (instead of the default). */
  hint?: string;
}

/** A conflict under review: the bar above the week, and the marks on the week itself. */
export interface ReviewView {
  /** "CONFLICT", or "CONFLICT · EXAMPLE CHANGE" for the labelled example. */
  title: string;
  reason: string;
  detail: string;
  /** What the agent understood from what you said ('' when nothing was said). */
  note: string;
  noteAi: boolean;
  candidates: Array<{ label: string; why: string; slot: Slot }>;
  /** Which candidate is on trial, or null. */
  trial: number | null;
  /** The back-out button: "Cancel" a trial, "Not now" the review. */
  cancel: string;
  /** The old time. It stays on the wall. */
  old: Slot;
  /** True while the card on the desk is a trial, not an approval. */
  preview: boolean;
}

/** The compact control beside the outbox: try the example change, review a conflict, or re-read your link. */
export interface CalendarButtonView {
  label: string;
  sub: string;
  primary: boolean;
}

export interface BoardView {
  plan: Plan | null;
  week: WeekModel | null;
  invite: InviteExtras;
  card: AgentCardView | null;
  fresh: Set<string>;
  review: ReviewView | null;
}

export class Board {
  readonly object = new Group();
  readonly desk = new Group();
  /** Palm-up cue: a small label and ring over your palm while you hold it. */
  readonly palm = new Group();
  private palmLabel = new CanvasPanel(0.26, 0.05, 'palm-label');
  private palmRing: Mesh<RingGeometry, MeshBasicMaterial>;
  status: BoardStatus = 'searching';
  private plan: Plan | null = null;
  private week: WeekModel | null = null;
  private fresh = new Set<string>();
  /** The board itself: pinchable only so the hand ray shows a cursor anywhere on it. */
  readonly backPanel = new CanvasPanel(BOARD.width, BOARD.height, 'board');
  readonly moveButton = new CanvasPanel(LAYOUT.move.w, LAYOUT.move.h, 'move-board');
  private moveLook = '';
  readonly voiceButton = new CanvasPanel(LAYOUT.voice.w, LAYOUT.voice.h, 'voice-toggle');
  private voiceLook = '';
  /** First 10 seconds: a pulsing glow says "start here" on the first chip until you ask. */
  private startGlow = new CanvasPanel(LAYOUT.chips[0].w + 0.05, LAYOUT.chips[0].h + 0.05, 'start-glow');
  /** The board pops in when it lands. */
  private appearT = -1;
  private appearScale = 1;
  readonly mural = new CanvasPanel(LAYOUT.mural.w, LAYOUT.mural.h, 'week-mural');
  readonly altRows = [0, 1].map((i) => new CanvasPanel(LAYOUT.pill.w, LAYOUT.pill.h, `alt-slot-${i}`));
  private tray = new CanvasPanel(LAYOUT.tray.w, LAYOUT.tray.h, 'outbox-tray');
  readonly chipPanels = LAYOUT.chips.map((r, i) => new CanvasPanel(r.w, r.h, `chip-${CHIPS[i].id}`));
  private replanPanel = new CanvasPanel(LAYOUT.replan.w, LAYOUT.replan.h, 'replan-card');
  readonly replanButtons = [
    new CanvasPanel(LAYOUT.replanYes.w, LAYOUT.replanYes.h, 'replan-yes'),
    new CanvasPanel(LAYOUT.replanNo.w, LAYOUT.replanNo.h, 'replan-no'),
  ];
  private reviewBar = new CanvasPanel(LAYOUT.review.w, LAYOUT.review.h, 'review-bar');
  /** The two big "try this time" targets of a conflict review. */
  readonly candidateButtons = LAYOUT.candidates.map((r, i) => new CanvasPanel(r.w, r.h, `candidate-${i}`));
  readonly reviewCancel = new CanvasPanel(LAYOUT.reviewCancel.w, LAYOUT.reviewCancel.h, 'review-cancel');
  readonly calendarButton = new CanvasPanel(LAYOUT.calendar.w, LAYOUT.calendar.h, 'calendar-change');
  private review: ReviewView | null = null;
  private reviewKey = '';
  private hoverCand: number | null = null;
  private hoverCancel = false;
  private calendarLook: { view: CalendarButtonView | null; hovered: boolean } | null = null;
  /** The card on the desk is blocked (a conflict): no amber glow, nothing to approve. */
  private inviteBlocked = false;
  /** Says what the ring approves, e.g. "HOLD TO APPROVE · Wed 5:30 PM". */
  private holdLabel = new CanvasPanel(0.4, 0.052, 'hold-label');
  private holdText = '';
  /** Honour "reduce motion": no sweep and no flight, the labels carry the link. */
  reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private cue = new CanvasPanel(BOARD.width + 0.08, BOARD.height + 0.08, 'wall-cue');
  /** A tab under the board: "the card is on your desk", shown when the desk is out of view. */
  private deskHint = new CanvasPanel(DESK_HINT.w, DESK_HINT.h, 'desk-hint');
  /** Which calendar this is: the sample week or your own, bottom left. */
  private sourceLabel = { text: '', real: false };
  /** The morning queue's line beside the title, e.g. "TODAY 1 of 2 cleared". */
  private queueLine = { text: '', clear: false };
  /** True while eye gaze does the pointing (Meta VR Glasses, Quest Pro): hints say "look", not "point". */
  private lookMode = false;
  readonly inviteCard = new CanvasPanel(INVITE.w, INVITE.h, 'invite-card');
  private glow = new CanvasPanel(INVITE.w + GLOW_PAD * 2, INVITE.h + GLOW_PAD * 2, 'invite-glow');
  private ring = new Group();
  private ringFill: Mesh<RingGeometry, MeshBasicMaterial>;
  private chipLooks: string[] = CHIPS.map(() => '');
  private agentLine = { text: '', color: COLORS.muted };
  private invitePlan: Plan | null = null;
  private inviteKey = '';
  private card: AgentCardView | null = null;
  private cardKey = '';
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
    this.add(this.object, this.voiceButton.mesh, LAYOUT.voice.x, LAYOUT.voice.y, Z.pill, 4);
    this.add(this.object, this.calendarButton.mesh, LAYOUT.calendar.x, LAYOUT.calendar.y, Z.pill, 4);
    this.add(this.object, this.reviewBar.mesh, LAYOUT.review.x, LAYOUT.review.y, Z.replan, 5);
    this.candidateButtons.forEach((b, i) => this.add(this.object, b.mesh, LAYOUT.candidates[i].x, LAYOUT.candidates[i].y, Z.button, 6));
    this.add(this.object, this.reviewCancel.mesh, LAYOUT.reviewCancel.x, LAYOUT.reviewCancel.y, Z.button, 6);
    this.add(this.object, this.startGlow.mesh, LAYOUT.chips[0].x, LAYOUT.chips[0].y, Z.pill - 0.002, 3);
    this.startGlow.draw((c, w, h) => {
      c.shadowColor = COLORS.link;
      c.shadowBlur = 18;
      c.lineWidth = 6;
      c.strokeStyle = COLORS.link;
      roundRect(c, 12, 12, w - 24, h - 24, (h - 24) / 2);
      c.stroke();
    });
    this.add(this.object, this.cue.mesh, 0, 0, Z.cue, 7);
    this.add(this.object, this.deskHint.mesh, 0, -BOARD.height / 2 - DESK_HINT.h / 2 - 0.012, Z.pill, 4);
    this.deskHint.mesh.visible = false;
    this.deskHint.draw((c, w, h) => {
      roundRect(c, 2, 2, w - 4, h - 4, (h - 4) / 2);
      c.fillStyle = 'rgba(46, 34, 10, 0.95)';
      c.fill();
      c.lineWidth = 3;
      c.strokeStyle = COLORS.amber;
      c.stroke();
      const t = '▼  The card is on your desk · pinch and hold it';
      let size = 24;
      font(c, size, 700);
      while (size > 12 && c.measureText(t).width > w - 36) font(c, --size, 700);
      c.fillStyle = COLORS.text;
      c.textBaseline = 'middle';
      c.fillText(t, (w - c.measureText(t).width) / 2, h / 2 + 1);
      c.textBaseline = 'alphabetic';
    });
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
    hitPad(this.voiceButton.mesh, LAYOUT.voice.w, LAYOUT.voice.h, px(6), px(12));
    // Pads meet halfway across the gaps, so a wobbling ray never falls between two targets.
    this.candidateButtons.forEach((b, i) => hitPad(b.mesh, LAYOUT.candidates[i].w, LAYOUT.candidates[i].h, px(6), px(9)));
    hitPad(this.reviewCancel.mesh, LAYOUT.reviewCancel.w, LAYOUT.reviewCancel.h, px(6), px(9));
    hitPad(this.calendarButton.mesh, LAYOUT.calendar.w, LAYOUT.calendar.h, px(5), px(10));
    this.setVoiceButton(true, false);

    // Palm cue: label + progress ring, hidden until you hold a palm toward your face.
    this.palmLabel.draw((c, w, h) => {
      roundRect(c, 2, 2, w - 4, h - 4, (h - 4) / 2);
      c.fillStyle = 'rgba(16, 28, 46, 0.92)';
      c.fill();
      c.lineWidth = 3;
      c.strokeStyle = COLORS.link;
      c.stroke();
      const t = 'Hold to bring the board here';
      let size = 26;
      font(c, size, 700);
      while (size > 12 && c.measureText(t).width > w - 28) font(c, --size, 700);
      c.fillStyle = COLORS.text;
      c.textBaseline = 'middle';
      c.fillText(t, (w - c.measureText(t).width) / 2, h / 2 + 1);
    });
    // Drawn at 0.26 m and shown at half size (13 cm): twice the pixels, so it stays sharp ~30 cm from the eyes.
    this.palmLabel.mesh.scale.setScalar(0.5);
    this.palmLabel.mesh.position.set(0, 0.038, 0);
    this.palmLabel.mesh.renderOrder = 9;
    this.palmRing = new Mesh(
      new RingGeometry(0.016, 0.022, RING_SEGMENTS, 1, Math.PI / 2, Math.PI * 2),
      new MeshBasicMaterial({ color: COLORS.link, side: DoubleSide, transparent: true, depthWrite: false }),
    );
    this.palmRing.scale.x = -1;
    this.palmRing.renderOrder = 9;
    this.palm.add(this.palmLabel.mesh, this.palmRing);
    this.palm.visible = false;

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
    this.holdLabel.mesh.position.set(0, -0.122, 0.002);
    this.holdLabel.mesh.renderOrder = 8;
    this.holdLabel.mesh.visible = false;
    this.ring.add(this.holdLabel.mesh);
    this.ring.position.set(0, 0, 0.012);
    this.ring.visible = false;
    this.desk.add(this.ring);
    this.desk.scale.setScalar(INVITE.deskScale);
    this.desk.visible = false;

    for (const m of [
      this.mural,
      this.glow,
      this.replanPanel,
      ...this.altRows,
      ...this.replanButtons,
      this.cue,
      this.reviewBar,
      ...this.candidateButtons,
      this.reviewCancel,
    ]) {
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

  private drawCardButtons(hover: number | null): void {
    const yes = this.card?.yes ?? 'Re-plan';
    const no = this.card?.no ?? 'Not now';
    this.replanButtons[0].draw((c, w, h) => drawButton(c, w, h, yes, true, hover === 0));
    this.replanButtons[1].draw((c, w, h) => drawButton(c, w, h, no, false, hover === 1));
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

  /** The voice toggle: speaker on or off. */
  setVoiceButton(on: boolean, hovered: boolean): void {
    const key = `${on}|${hovered}`;
    if (key === this.voiceLook) return;
    this.voiceLook = key;
    this.voiceButton.draw((c, w, h) => drawButton(c, w, h, on ? '🔊' : '🔇', false, hovered, 26));
  }

  /** Show the palm cue at a point, turned to face the eyes, with the ring filled to `progress`. */
  setPalmCue(visible: boolean, at?: { x: number; y: number; z: number }, head?: { x: number; y: number; z: number }, progress = 0): void {
    this.palm.visible = visible;
    if (!visible || !at || !head) return;
    this.palm.position.set(at.x, at.y, at.z);
    this.palm.lookAt(head.x, head.y, head.z);
    this.palmRing.geometry.setDrawRange(0, Math.round(RING_SEGMENTS * Math.max(0.02, progress)) * 6);
  }

  /** Test hook: is the "start here" glow showing? */
  get startHintVisible(): boolean {
    return this.startGlow.mesh.visible;
  }

  /** The board just landed (or moved): pop in from 90% with a soft sound. */
  appear(scale: number): void {
    this.appearScale = scale;
    this.appearT = 0;
    this.object.scale.setScalar(scale * 0.9);
    playLand();
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

  /** The tab under the board that points down to the desk card. */
  setDeskHint(visible: boolean): void {
    this.deskHint.mesh.visible = visible;
  }

  get deskHintVisible(): boolean {
    return this.deskHint.mesh.visible;
  }

  /** Say which calendar the wall shows, so sample data is never mistaken for real. */
  setSourceLabel(text: string, real: boolean): void {
    if (text === this.sourceLabel.text) return;
    this.sourceLabel = { text, real };
    this.drawBack();
  }

  /** The morning queue's progress, beside the title. */
  setQueueLine(text: string, clear: boolean): void {
    if (text === this.queueLine.text && clear === this.queueLine.clear) return;
    this.queueLine = { text, clear };
    this.drawBack();
  }

  /** Eyes do the pointing: the hints say "look at" instead of "point your hand at". */
  setLookMode(on: boolean): void {
    if (on === this.lookMode) return;
    this.lookMode = on;
    this.drawBack();
  }

  /** A new size for the board (field-of-view fit), without replaying the pop-in. */
  setScale(scale: number): void {
    this.appearScale = scale;
    if (this.appearT < 0) this.object.scale.setScalar(scale);
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
      if (slotId && !this.reducedMotion) {
        this.flyPending = true;
        this.flyT = -1;
        this.flyDur = (animate ? FLY.newPlanSeconds : FLY.pickSeconds) * this.flySlowdown;
      }
    }
    this.plan = view.plan;
    this.week = view.week;
    this.fresh = view.fresh;
    this.inviteBlocked = view.invite.conflict !== null;

    // Conflict review: the bar and its targets replace the chips (one thing to do at a time).
    const reviewKey = view.review ? JSON.stringify(view.review) : '';
    const reviewChanged = reviewKey !== this.reviewKey;
    if (reviewChanged) {
      const toggled = (this.review === null) !== (view.review === null);
      this.reviewKey = reviewKey;
      this.review = view.review;
      this.hoverCand = null;
      this.hoverCancel = false;
      this.drawReview();
      if (toggled && !planChanged) this.drawBack();
    }

    if (planChanged) this.drawBack();
    if (newPlan && view.plan) {
      this.sweep = animate && !this.reducedMotion ? 0 : 1;
      this.sweepStep = -1;
    }
    this.mural.mesh.visible = view.plan !== null && view.week !== null;
    if (!view.plan) this.altRows.forEach((row) => (row.mesh.visible = false)); // no plan, no runner-ups
    if (planChanged || weekChanged || reviewChanged) this.sweepStep = -1; // force a mural redraw
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
    const cardKey = view.card ? JSON.stringify(view.card) : '';
    if (cardKey !== this.cardKey) {
      this.cardKey = cardKey;
      const card = view.card;
      const hintChanged = (card?.hint ?? '') !== (this.card?.hint ?? '');
      this.card = card;
      if (hintChanged && !this.plan) this.drawBack(); // the empty board's "start here" line
      const show = card !== null;
      this.replanPanel.mesh.visible = show;
      this.replanButtons.forEach((b) => (b.mesh.visible = show));
      if (card) {
        this.replanPanel.draw((c, w, h) => drawAgentCard(c, w, h, card));
        this.hoverReplan = null;
        this.drawCardButtons(null);
      }
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
  setAgentLine(text: string, tone: 'muted' | 'ai' | 'warn' | 'ok' | 'alert' = 'muted'): void {
    // 'alert' (a conflict) is pale red: amber is kept for the decision that waits for your hold.
    const color = { muted: COLORS.muted, ai: COLORS.link, warn: COLORS.amber, ok: COLORS.green, alert: '#ff9a90' }[tone];
    if (text === this.agentLine.text && color === this.agentLine.color) return;
    this.agentLine = { text, color };
    this.drawBack();
  }

  /** The tray keeps blocked items in sight as history: "CONFLICT", "REPLACED". */
  setOutbox(items: OutboxItem[]): void {
    const views = items.map((i) => {
      const slot = itemSlot(i);
      const kind = kindOf(i);
      const when = slot ? `${dayLabel(slot.day).short}, ${clock(slot.start)}` : '';
      const short = !when ? undefined : kind === 'call' ? when : `${kind === 'focus' ? 'Focus' : kind === 'reminder' ? 'Reminder' : 'Moved'} · ${when}`;
      return { subject: i.subject, short, blocked: blockedWord(i) || undefined };
    });
    this.tray.draw((c, w, h) => drawTray(c, w, h, views));
  }

  /** Hover feedback: brighter glow on the invite, highlighted pill or button. */
  setHover(
    invite: boolean,
    alt: number | null,
    replan: number | null = null,
    cand: number | null = null,
    cancel = false,
  ): void {
    this.hoverInvite = invite;
    if (alt !== this.hoverAlt) {
      this.hoverAlt = alt;
      this.drawPills();
    }
    if (replan !== this.hoverReplan) {
      this.hoverReplan = replan;
      this.drawCardButtons(replan);
    }
    if (cand !== this.hoverCand || cancel !== this.hoverCancel) {
      this.hoverCand = cand;
      this.hoverCancel = cancel;
      this.drawReviewButtons();
    }
  }

  /** The bar and its targets, shown only during a conflict review. */
  private drawReview(): void {
    const rv = this.review;
    const on = rv !== null;
    this.reviewBar.mesh.visible = on;
    this.reviewCancel.mesh.visible = on;
    this.candidateButtons.forEach((b, i) => (b.mesh.visible = on && i < (rv?.candidates.length ?? 0)));
    // The chips step aside so one decision is in view; the mic stays (say a limit).
    this.chipPanels.forEach((chip, i) => (chip.mesh.visible = !on || CHIPS[i].id === 'mic'));
    if (!rv) return;
    this.reviewBar.draw((c, w, h) => drawReviewBar(c, w, h, rv, LAYOUT.reviewTextPx));
    this.drawReviewButtons();
  }

  private drawReviewButtons(): void {
    const rv = this.review;
    if (!rv) return;
    this.candidateButtons.forEach((b, i) => {
      const cand = rv.candidates[i];
      if (!cand) return;
      const look = rv.trial === i ? 'trial' : this.hoverCand === i ? 'hover' : 'idle';
      b.draw((c, w, h) => drawCandidate(c, w, h, cand, look));
    });
    this.reviewCancel.draw((c, w, h) => drawButton(c, w, h, rv.cancel, false, this.hoverCancel, 22));
  }

  /** The compact control beside the outbox (redrawn only when it changes). */
  setCalendarButton(view: CalendarButtonView | null, hovered: boolean): void {
    const last = this.calendarLook;
    if (last && last.view === view && (view === null || last.hovered === hovered)) return;
    this.calendarLook = { view, hovered };
    this.calendarButton.mesh.visible = view !== null;
    if (!view) return;
    this.calendarButton.draw((c, w, h) => {
      roundRect(c, 2, 2, w - 4, h - 4, 18);
      c.fillStyle = view.primary ? (hovered ? '#9cc4ff' : COLORS.link) : hovered ? 'rgba(127, 178, 255, 0.4)' : 'rgba(127, 178, 255, 0.14)';
      c.fill();
      c.lineWidth = 3;
      c.strokeStyle = COLORS.link;
      c.stroke();
      c.textBaseline = 'middle';
      let size = 22;
      font(c, size, 800);
      while (size > 13 && c.measureText(view.label).width > w - 24) font(c, --size, 800);
      c.fillStyle = view.primary ? COLORS.ink : COLORS.text;
      c.fillText(view.label, (w - c.measureText(view.label).width) / 2, h * 0.38);
      size = 15;
      font(c, size, 700);
      while (size > 10 && c.measureText(view.sub).width > w - 20) font(c, --size, 700);
      c.fillStyle = view.primary ? COLORS.ink : COLORS.muted;
      c.fillText(view.sub, (w - c.measureText(view.sub).width) / 2, h * 0.72);
      c.textBaseline = 'alphabetic';
    });
  }

  /** 0..1 approval progress; 0 hides the ring. The label says exactly what the hold approves. */
  setHold(progress: number, label = ''): void {
    this.ring.visible = progress > 0;
    const segs = Math.round(progress * RING_SEGMENTS);
    this.ringFill.geometry.setDrawRange(0, segs * 6);
    if (label !== this.holdText) {
      this.holdText = label;
      this.holdLabel.mesh.visible = label !== '';
      if (label) {
        this.holdLabel.draw((c, w, h) => {
          roundRect(c, 2, 2, w - 4, h - 4, (h - 4) / 2);
          c.fillStyle = 'rgba(16, 20, 28, 0.94)';
          c.fill();
          c.lineWidth = 3;
          c.strokeStyle = COLORS.amber;
          c.stroke();
          let size = 24;
          font(c, size, 800);
          while (size > 13 && c.measureText(label).width > w - 30) font(c, --size, 800);
          c.fillStyle = COLORS.text;
          c.textBaseline = 'middle';
          c.fillText(label, (w - c.measureText(label).width) / 2, h / 2 + 1);
          c.textBaseline = 'alphabetic';
        });
      }
    }
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
    const needs = this.plan?.invite != null && this.plan.approval === 'needs' && !this.sweeping && !this.inviteBlocked;
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
    // First 10 seconds: pulse "start here" on the first chip until there is a plan.
    // One thing asks for attention at a time: not while the agent's card or a review is up.
    this.startGlow.mesh.visible = this.plan === null && this.object.visible && this.card === null && this.review === null;
    if (this.startGlow.mesh.visible) {
      (this.startGlow.mesh.material as MeshBasicMaterial).opacity = 0.45 + 0.45 * Math.sin(time * 4);
    }
    if (this.appearT >= 0) {
      this.appearT += dt;
      const t = Math.min(1, this.appearT / 0.35);
      const e = 1 - (1 - t) ** 3;
      this.object.scale.setScalar(this.appearScale * (0.9 + 0.1 * e));
      if (t >= 1) this.appearT = -1;
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
    const rv = this.review;
    const view: MuralView = {
      week,
      // In a review the old time is drawn as a conflict, never as the agent's pick.
      chosen: rv && rv.trial === null ? null : plan.slot,
      alternatives: rv ? [] : plan.alternatives,
      progress: this.sweep >= 1 ? 1 : step / steps,
      reason: plan.reason,
      tag: plan.by === 'ai' ? 'AI' : plan.by === 'you' ? 'YOU' : 'RULES',
      fresh: this.fresh,
      hover: this.sweep >= 1 ? this.muralHover : null,
      review: rv
        ? {
            old: rv.old,
            candidates: rv.candidates.map((cand) => cand.slot),
            preview: rv.preview,
            reason: rv.reason,
            detail: rv.detail,
            note: rv.note,
            noteAi: rv.noteAi,
          }
        : null,
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
      row.mesh.visible = !!alt && di >= 0 && done && this.mural.mesh.visible && this.review === null;
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
      // Glass: a dark, see-through gradient with a soft light along the top edge.
      roundRect(c, 4, 4, W - 8, H - 8, 36);
      const glass = c.createLinearGradient(0, 0, 0, H);
      glass.addColorStop(0, 'rgba(30, 37, 54, 0.86)');
      glass.addColorStop(0.35, 'rgba(18, 22, 32, 0.84)');
      glass.addColorStop(1, 'rgba(12, 15, 22, 0.86)');
      c.fillStyle = glass;
      c.fill();
      const sheen = c.createLinearGradient(0, 0, W * 0.6, H * 0.5);
      sheen.addColorStop(0, 'rgba(255, 255, 255, 0.07)');
      sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
      c.fillStyle = sheen;
      c.fill();
      c.lineWidth = 4;
      c.strokeStyle = 'rgba(160, 190, 255, 0.28)';
      c.stroke();
      c.lineWidth = 2;
      c.strokeStyle = 'rgba(255, 255, 255, 0.10)';
      roundRect(c, 10, 10, W - 20, H - 20, 30);
      c.stroke();

      font(c, 54, 700);
      c.fillStyle = COLORS.text;
      c.fillText('Agent Wall', 44, 86);
      if (this.queueLine.text) {
        const x0 = 44 + c.measureText('Agent Wall').width + 28;
        const room = W - 44 - (LAYOUT.move.w + LAYOUT.voice.w) * PX_PER_M - 40 - x0;
        let size = 22;
        font(c, size, 700);
        while (size > 13 && c.measureText(this.queueLine.text).width > room) font(c, --size, 700);
        c.fillStyle = this.queueLine.clear ? COLORS.green : COLORS.muted;
        c.fillText(this.queueLine.text, x0, 84);
      }
      // Which build this is, so a tester can tell us what they ran.
      font(c, 14, 500);
      c.fillStyle = COLORS.faint;
      const build = `build ${__AGENTWALL_BUILD__}`;
      c.fillText(build, W - 44 - c.measureText(build).width, H - 12);
      if (this.sourceLabel.text) {
        c.fillStyle = this.sourceLabel.real ? COLORS.green : COLORS.faint;
        c.fillText(this.sourceLabel.text, 44, H - 12);
      }
      pill(c, s.chip, W - 44, 46, s.color, COLORS.ink, 20, true);

      font(c, 28, 500);
      c.fillStyle = COLORS.text;
      const task = plan ? `Task · ${plan.task}` : s.hint || 'Ask your agent: pinch a chip below, or 🎤 Speak';
      const taskW = W - 88 - (LAYOUT.move.w + LAYOUT.voice.w) * PX_PER_M - 32;
      if (this.review) {
        // The review bar covers the rule line: the line above it says what just happened.
        const line = this.agentLine.text || task;
        c.fillStyle = this.agentLine.text ? this.agentLine.color : COLORS.text;
        font(c, 26, 600);
        drawWrapped(c, line, 44, 128, taskW, 34, 1);
        return;
      }
      drawWrapped(c, task, 44, 130, taskW, 34, 1);
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
        // One thing to do first: the agent's card says so when it has a start of its own.
        const hint = this.card?.hint ?? 'Pinch “Find time + draft invite” to start';
        const what = this.card?.hint ? 'the button' : 'a chip';
        c.fillText(hint, (W - c.measureText(hint).width) / 2, mid - 8 - (this.card?.hint ? 70 : 0));
        font(c, 26);
        c.fillStyle = COLORS.muted;
        const how = this.lookMode
          ? `Look at ${what}, then tap your thumb and index finger together`
          : `Point your hand at ${what}, then tap your thumb and index finger together`;
        c.fillText(how, (W - c.measureText(how).width) / 2, mid + 36 - (this.card?.hint ? 70 : 0));
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

function drawAgentCard(c: CanvasRenderingContext2D, w: number, h: number, card: AgentCardView): void {
  const warn = card.tone === 'warn';
  roundRect(c, 3, 3, w - 6, h - 6, 22);
  c.fillStyle = warn ? 'rgba(40, 22, 22, 0.97)' : 'rgba(16, 28, 46, 0.97)';
  c.fill();
  c.lineWidth = 4;
  c.strokeStyle = warn ? '#e5534b' : '#7fb2ff';
  c.stroke();
  font(c, 18, 800);
  c.fillStyle = warn ? '#ff9a90' : '#9cc4ff';
  c.fillText(card.title, 24, 34);
  font(c, 22, 600);
  c.fillStyle = COLORS.text;
  drawWrapped(c, card.text, 24, 66, w * 0.55, 28, 2);
}
