# Agent Wall

A mixed reality board on your real wall where an AI agent plans one real task,
and nothing goes out until you pinch and hold to approve.

Entry for the Meta VR Start Developer Competition 2026 (Productivity track).
Built with Meta's [Immersive Web SDK](https://iwsdk.dev) (WebXR), hands only.

**Status: Day 3.** The app finds a wall and puts the board on it (or floats it
1.2 m in front of you if there is no wall). The agent's plan shows as two linked
cards: a **Slot** card with the best free time from a sample calendar, and an
**Invite** card with an email draft for that time.

- **Pinch an "Also free" row** to use that time instead. The invite rewrites
  itself and goes back to "Needs approval".
- **Pinch and hold the invite for 1 second** to approve it. A ring fills, the
  invite flies into the **Demo outbox** with a chime. Nothing is really sent.
- A short tap does nothing, and one long hold can never approve twice.

AI, voice, preset chips and saving come next.

All calendar data is **sample data** (`src/data/sample-calendar.json`). Nothing
reads a real calendar and nothing is sent.

## Try it

Open the GitHub Pages link in the **Meta Quest Browser** and press
**Enter mixed reality**. Allow spatial data when asked. Quest uses the walls from
your Space Setup; without one, the board floats in front of you.

On a desktop browser you only see a 2D preview of the board.

## Develop

Needs Node 20.19+, 22.12+ or 24.

```bash
npm install
npm run dev          # dev server + Meta Quest 3 emulator (IWER) in a managed browser
npm test             # unit tests (Vitest): wall choice and fallback logic
npm run typecheck
npm run build        # static site in dist/
```

Emulator checks (dev server must be running headless):

```bash
npx iwsdk dev up --headless --allow-browser-automation
node scripts/emu/run.mjs
npx iwsdk dev down
```

## How the board finds a wall

- `src/logic/placement.ts`: plain TypeScript. Picks the vertical plane labelled
  `wall` (or unlabelled) that is 0.4–4 m away, within 60° of where you look, and
  big enough for the board. Doors, windows, screens and wall art are skipped.
  The board goes where your gaze meets the wall, a little below eye level,
  2 cm off the wall, kept inside the wall's edges.
- `src/logic/placement-controller.ts`: waits up to 2.5 s for a wall, then falls
  back to 1.2 m in front of you. A wall that shows up in the first 15 s still
  wins; after that the board stays put.
- `src/board-system.ts`: the IWSDK system that feeds detected planes and the
  head pose into that logic and moves the board.

## How the agent plans

- `src/logic/scheduler.ts`: finds 30-minute times where you and the tester are
  both free, inside 9:00–18:00, on the half hour, with 10 minutes between
  meetings and at least 30 minutes' notice. Rules like "only after 4 PM" narrow
  the search. With the sample week, the default pick is Tue 1:00 PM; "only
  after 4 PM" gives Wed 5:30 PM.
- `src/logic/plan.ts`: the plan is two linked cards. The invite is always
  drafted from the chosen slot; any change rewrites it and resets approval.
- `src/ui/cards.ts`, `src/board.ts`: draw the cards on canvas textures.

## How approval works

- `src/logic/hold.ts`: pinch-and-hold timer. 1 s to approve; ray flicker up to
  0.15 s is forgiven; letting go drains the ring; after approving, the pinch
  must be released before anything can be approved again.
- `src/logic/plan.ts` (`approve`, `addToOutbox`): only an invite that needs
  approval and is linked to the shown slot can be approved.
- `src/board-system.ts`: IWSDK `RayInteractable` on the invite and the "Also
  free" rows; a hand ray adds `Hovered`, a pinch adds `Pressed`. In the desktop
  preview the mouse does the same.

## License

MIT
