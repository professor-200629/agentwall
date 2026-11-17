import { VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { refreshLinked } from './calendar-source.js';
import { initSetup, showCalendarStatus } from './setup.js';
import { renderSent } from './sent.js';
import { activeCalendar } from './calendar-source.js';
import { LEARN_KEY } from './logic/learn.js';
import { QUEUE_KEY } from './logic/queue.js';
import { STORAGE_KEY } from './logic/storage.js';
import { freshUrl, needsReload, RELOAD_KEY } from './logic/version.js';
import { unlockAudio } from './ui/sound.js';

// Run the newest build even if the browser cached an older index.html.
void (async () => {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    const deployed = res.ok ? ((await res.json()) as { build?: string }).build : undefined;
    let tried: string | null = null;
    try {
      tried = sessionStorage.getItem(RELOAD_KEY);
    } catch {
      // storage blocked: still safe, needsReload compares against null
    }
    // Runs once at page load, before anyone can enter mixed reality.
    if (deployed && needsReload(__AGENTWALL_BUILD__, deployed, tried)) {
      try {
        sessionStorage.setItem(RELOAD_KEY, deployed);
      } catch {
        return; // without the guard a reload could loop; keep the old build instead
      }
      location.replace(freshUrl(location.href, deployed));
    }
  } catch {
    // offline or no version.json: keep running what we have
  }
})();

/** The Worker URL is set at build time (GitHub Actions variable). Empty = no AI, no calendar links. */
const WORKER_URL: string = String(import.meta.env.VITE_AGENT_URL ?? '').trim();
initSetup(WORKER_URL);

// Start over: the saved board (approvals, the example change), today's queue and learned rules.
// Wired before anything else loads, so it can rescue a page that fails to start.
const reset = document.getElementById('reset-board') as HTMLButtonElement | null;
const hasBoard = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
};
if (reset) {
  reset.hidden = !hasBoard();
  reset.addEventListener('click', () => {
    try {
      for (const key of [STORAGE_KEY, QUEUE_KEY, LEARN_KEY]) localStorage.removeItem(key);
    } catch {
      // storage blocked: there was nothing to clear
    }
    location.reload();
  });
}

// A linked calendar is read again first (at most 4 s), so the board starts on today's truth.
// The board is imported after that, because it picks its calendar when it loads.
void refreshLinked(WORKER_URL)
  .catch(() => undefined)
  .then(() => {
    // A failed re-read keeps the last calendar; the page and the wall both say so.
    showCalendarStatus();
    return Promise.all([
      World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions),
      import('./board-system.js'),
    ]);
  })
  .then(([world, { BoardSystem }]) => {
  world.registerSystem(BoardSystem);

  // 2D start page: one button that enters mixed reality.
  const intro = document.getElementById('intro') as HTMLDivElement;
  const enter = document.getElementById('enter-xr') as HTMLButtonElement;
  const note = document.getElementById('xr-note') as HTMLParagraphElement;
  // Everything is loaded: until here the button says "Loading…" and cannot be pressed.
  enter.textContent = 'Enter mixed reality';
  enter.disabled = false;

  // No mixed reality here: explain, and say the mouse works like a pinch.
  const noXr = (why: string) => {
    enter.disabled = true;
    note.textContent = `${why} On this screen you can still try it: click a chip, and hold the mouse on the invite for 1 second.`;
  };
  if (!world.xrEnabled || !navigator.xr) {
    noXr('This browser has no WebXR. Open this page in the Meta Quest Browser to put the board on your wall.');
  } else {
    navigator.xr.isSessionSupported('immersive-ar').then((ok) => {
      if (!ok) noXr('Mixed reality is not supported here. Open this page in the Meta Quest Browser.');
    });
  }
  // Desktop preview: the first click anywhere also allows sound.
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  enter.addEventListener('click', () => {
    unlockAudio(); // browsers allow sound only after a click
    world.launchXR();
  });

  // Hide / show the help box so it doesn't cover the board on small screens.
  const hideBtn = document.getElementById('hide-intro') as HTMLButtonElement;
  const showBtn = document.getElementById('show-intro') as HTMLButtonElement;
  let userHid = false;
  hideBtn.addEventListener('click', () => {
    userHid = true;
    intro.hidden = true;
    showBtn.hidden = false;
  });
  showBtn.addEventListener('click', () => {
    userHid = false;
    intro.hidden = false;
    showBtn.hidden = true;
  });
  // Desktop preview: the list follows what you approve with the mouse.
  window.addEventListener('agentwall:saved', () => {
    const active = activeCalendar();
    renderSent(active.cal, active.real);
    if (reset) reset.hidden = !hasBoard();
  });
  // The list is also right on first load: yesterday's approvals, checked against today's calendar.
  {
    const active = activeCalendar();
    renderSent(active.cal, active.real);
  }
  world.visibilityState.subscribe((v) => {
    const flat = v === VisibilityState.NonImmersive;
    // Back on the page: what you approved in mixed reality, as a real email draft and calendar file.
    if (flat) {
      const active = activeCalendar();
      renderSent(active.cal, active.real);
    }
    intro.hidden = !flat || userHid;
    showBtn.hidden = !flat || !userHid;
  });
})
  .catch((e) => {
    // The app did not start (a failed download, a browser without WebGL): say so instead of a dead button.
    console.error(e);
    const enter = document.getElementById('enter-xr');
    const note = document.getElementById('xr-note');
    if (enter) enter.textContent = 'Could not start';
    if (note) note.textContent = 'Agent Wall could not start. Reload the page. If it still does not start, use “Start over” below.';
    if (reset) reset.hidden = false;
  });
