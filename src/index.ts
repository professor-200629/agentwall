import { VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { refreshLinked } from './calendar-source.js';
import { initSetup } from './setup.js';
import { renderSent } from './sent.js';
import { activeCalendar } from './calendar-source.js';
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

// A linked calendar is read again first (at most 4 s), so the board starts on today's truth.
// The board is imported after that, because it picks its calendar when it loads.
void refreshLinked(WORKER_URL)
  .catch(() => undefined)
  .then(() =>
    Promise.all([
      World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions),
      import('./board-system.js'),
    ]),
  )
  .then(([world, { BoardSystem }]) => {
  world.registerSystem(BoardSystem);

  // 2D start page: one button that enters mixed reality.
  const intro = document.getElementById('intro') as HTMLDivElement;
  const enter = document.getElementById('enter-xr') as HTMLButtonElement;
  const note = document.getElementById('xr-note') as HTMLParagraphElement;

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
  });
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
});
