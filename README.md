# Agent Wall

A mixed reality board on your real wall where an AI agent plans one real task,
and nothing goes out until you pinch and hold to approve.

Entry for the Meta VR Start Developer Competition 2026 (Productivity track).
Built with Meta's [Immersive Web SDK](https://iwsdk.dev) (WebXR), hands only.

**Status: Day 5.** Feature-frozen; real AI connected; not yet tested on a real
Quest. **Have a Quest? Please try the 10-step checklist:
[docs/TESTING-ON-QUEST.md](docs/TESTING-ON-QUEST.md).**

1. The app finds a wall and puts the board on it (or floats it 1.2 m in front
   of you if there is no wall).
2. **Ask the agent** by pinching a chip ("Find time + draft invite", "Only after
   4 PM", "Thursday", "Not Wed", "Any time") or pinch **🎤 Speak** and say it.
3. The agent makes two linked cards: a **Slot** (best free time from a sample
   calendar) and an **Invite** email for that time. Change the rule, or pinch an
   "Also free" row, and the invite rewrites itself and needs approval again.
4. **Pinch and hold the invite for 1 second** to approve it into the **Demo
   outbox**. Nothing is really sent.
5. The board is saved in your browser, so it is there when you come back.

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

## The AI, and why the demo never breaks

The AI has one narrow job: turn what you said ("only after 4 PM") plus the
sample calendar into a slot choice and an email. It runs on Groq
(`qwen/qwen3.8-27b`, strict JSON schema) behind a small Cloudflare Worker (`worker/`), so the
API key never ships in the app.

- The app sends the AI only the free slots the scheduler computed; the AI must
  pick one of them.
- Every answer is checked (`src/logic/agent.ts`): a slot that breaks the rule
  is replaced, an email that names the wrong day or time, has links, or is too
  long is replaced by the template.
- If the AI takes more than 3 seconds, errors, or is offline, the rule-based
  scheduler answers instead. The board always says who planned it.
- Voice: the app records up to 5 s (`getUserMedia`), the Worker sends it to
  Whisper (`whisper-large-v3-turbo`). If the mic or the service fails, the
  chips still work.

### Set up the Worker (free)

1. Create a free Groq API key at https://console.groq.com/keys
2. In `worker/`: `npm install`, `npx wrangler login`,
   `npx wrangler secret put GROQ_API_KEY` (paste the key when asked), then
   `npx wrangler deploy`. It prints the Worker URL.
3. Set the URL as a repository variable and redeploy the site:
   `gh variable set AGENT_URL --body https://<your-worker>.workers.dev`
   then `gh workflow run "Test and deploy to GitHub Pages"`.

Without the Worker the app runs in rules mode, and the board says so.

## Performance notes

- Download: the main script is 2.4 MB (0.66 MB gzipped). IWSDK's UI kit pulls in
  a 4.1 MB icon set we never use; `vite.config.ts` swaps it for the two icons
  the kit needs (`src/stubs/uikit-lucide-lite.ts`).
- One draw call and one texture per panel; panels redraw only when their
  content changes. Desktop emulator: 16.7 ms frames (60 fps), no allocations
  in the frame loop. Not yet measured on a Quest.
- Far walls get a bigger board (up to 1.4x) so text stays readable.

## License

MIT
