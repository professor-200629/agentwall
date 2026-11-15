import { VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { BoardSystem } from './board-system.js';
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

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
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
  world.visibilityState.subscribe((v) => {
    const flat = v === VisibilityState.NonImmersive;
    intro.hidden = !flat || userHid;
    showBtn.hidden = !flat || !userHid;
  });
});
