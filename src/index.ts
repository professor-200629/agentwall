import { VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { BoardSystem } from './board-system.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(BoardSystem);

  // 2D start page: one button that enters mixed reality.
  const intro = document.getElementById('intro') as HTMLDivElement;
  const enter = document.getElementById('enter-xr') as HTMLButtonElement;
  const note = document.getElementById('xr-note') as HTMLParagraphElement;

  if (!world.xrEnabled || !navigator.xr) {
    enter.disabled = true;
    note.textContent =
      'This browser has no WebXR. Open this page in the Meta Quest Browser to place the board on your wall.';
  } else {
    navigator.xr.isSessionSupported('immersive-ar').then((ok) => {
      if (!ok) {
        enter.disabled = true;
        note.textContent =
          'Mixed reality is not supported here. Open this page in the Meta Quest Browser.';
      }
    });
  }
  enter.addEventListener('click', () => world.launchXR());
  world.visibilityState.subscribe((v) => {
    intro.hidden = v !== VisibilityState.NonImmersive;
  });
});
