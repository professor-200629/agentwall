# Agent Wall: video sequence and Devpost text

Drafts for the Meta VR Start Developer Competition 2026 (Productivity, New
Experience). Deadline: **18 Nov 2026 12:00 PM PT = 19 Nov 1:30 AM IST**. The
rules ask for a public YouTube or Vimeo video under three minutes; footage from
a simulator counts when it shows the same build.

Everything below describes the live build. What ran where is said plainly:
**emulator** means Meta's browser emulator (IWER) on a laptop with scripted
hand pinches; **headset** means a person wore one.

This version (17 Nov) follows an outside review of the entry as a judge would
meet it. Its main points: the first ten seconds showed a static panel and an
"example" label instead of the story; every shot was a close-up of one flat
panel, so nothing looked like a room; the card flying from the wall to the desk
(the one spatial moment) was off camera; the text was over 700 words and gave
a fifth of them to what is not tested.

---

## 1. The video (55 to 60 seconds)

One story: *my AI agent booked a call and I approved it; my week changed; the
wall blocks the old plan and shows why; I try another time in the room; one
hold approves exactly what I see.* Focus time, the day streak and moving a
meeting are not in it.

Three rules for the picture:

- **Wide, from the seat, whenever something moves.** The wall and the desk in
  one frame, so the card is seen leaving the week and landing on the desk.
  Push in only to read the card, for two or three seconds.
- **Start on the result of a real hold.** Before the take, the script plans a
  call and approves it with a real hold. The first frame then shows a time the
  viewer can believe was approved: gold on the wall, a tick in the outbox.
- **One small corner label for the whole video:** "Sample week · Meta's
  emulator". It replaces the big "EXAMPLE" captions and the end-card line.

### How to record it without a headset

```bash
npm run dev
```

The emulator window opens. Put it in front, as large as it goes, and start a
screen recorder on that window (Windows: **Win+Alt+R**). Then, in a second
terminal:

```bash
node scripts/emu/video-take.mjs
```

It first sets the scene (about 40 seconds: a plan, a real hold, the Unsend
window), prints `TAKE STARTS`, and then plays the shots below with scripted
hand pinches, smooth head moves and pauses, printing each shot's time. Do not
touch the mouse while it runs. Cut everything before `TAKE STARTS` when you
edit. `SLOW=1.3` stretches every pause if the voice-over needs more room.
Record the voice afterwards over the picture, add the captions, and put one
quiet music track under it that you have the right to use (the YouTube Audio
Library is free for YouTube videos).

If a tester records on a Quest instead (better: it is the exact build on real
hardware), the same shots apply; cut 10 to 15 seconds of it into the video with
the label "Quest 3 capture".

### Shot list

| # | Time | Picture | Voice-over | Caption |
| --- | --- | --- | --- | --- |
| 1 | 0:00 – 0:04 | Wide, from the seat: the week on the wall with Tuesday 1 PM in gold and a tick in the outbox; the receipt card on the desk. A slow push toward Tuesday. | "Yesterday my AI agent booked a call, and I approved it." | My AI agent booked a call. I approved it. |
| 2 | 0:04 – 0:08 | The hand pinches **Try a calendar change**. A red block lands on Tuesday 1 PM; the old time is crossed out, **CONFLICT**. | "This morning my week changed. What I approved is now wrong." | Then my week changed. |
| 3 | 0:08 – 0:14 | Wide again. The card on the desk is red, **BLOCKED**. The hand pinches **Wed 5:30 PM**: a new card lifts off Wednesday and flies down to the desk. | "Agent Wall blocks it, shows me why on my wall, and puts a new plan on my desk." | Agent Wall |
| 4 | 0:14 – 0:19 | Push in on the card: "WAS Tue 1:00 PM → NOW Wed 5:30 PM" and the one trade-off. | "Old time, new time, and the one thing it costs." | |
| 5 | 0:19 – 0:25 | Wide: pinch **Thu 1:00 PM**. The preview jumps to Thursday and a second card flies down. | "I can try another. Until I hold, it is only a preview." | |
| 6 | 0:25 – 0:30 | Start the hold and let go early: the ring drains. | "Let go early, and nothing happens." | |
| 7 | 0:30 – 0:36 | A full hold: the ring fills, the chime. | "One full hold approves exactly the card in front of me." | One hold · the exact card shown |
| 8 | 0:36 – 0:42 | Wide wall: Thursday in gold. The outbox: "✓ Thu 19 Nov, 1:00 PM" and "✕ REPLACED · Tue 17 Nov, 1:00 PM". (Cut the 5-second countdown out when you edit.) | "The old invite stays as history, and can never go out." | |
| 9 | 0:42 – 0:47 | Pinch the bar on top of the board, drag the week across the room, let it go near the wall: it snaps on. | "And the wall goes where I put it." | |
| 10 | 0:47 – 0:52 | The start page, zoomed on the new item: **Open email draft**, **Add to my calendar**. | "The new invite opens in my own mail app. I press send, not the agent." | |
| End | 0:52 – 0:58 | Wide wall, then the end card. | (none) | Agent Wall: nothing your AI agent plans leaves without your hand · professor-200629.github.io/agentwall · small: "Conflict flow run on a Quest 3 by a Meta Start mentor. This footage: Meta's emulator." |

Optional shot (adds about 8 s, `AI=1` in the script), after shot 5: pinch 🎤 and
say **"Could we push it past three o'clock?"**. The bar answers "LIVE AI
understood 'only after 3 PM'". Use it only if it is recorded live on a headset
or with a real microphone; the script's version uses a canned answer and must
then be captioned "simulated answer". Voice-over: "A spoken limit changes the
search. The AI never approves anything."

### What the video must not claim

- The conflict flow was run on a Quest 3 by a Meta mentor on 16 Nov (README,
  "Status"). You may say that. Do not say the grab bars or the card's new place
  were tested on a headset unless someone has done it by then, and do not quote
  a frame rate: nobody measured one on a Quest.
- Not "sends the invite". It never does.
- The busy block is an example and the week is a sample: the corner label says
  so for the whole video.

---

## 2. Devpost text

**Tagline (the form allows 140 characters)**

> An AI agent plans your week on your real wall. When a time you approved stops fitting, it is blocked, and nothing leaves until you hold.

**Inspiration**

An AI agent that books a meeting is easy to build and hard to trust, because
your week keeps changing after you say yes. On a screen a changed plan is one
more notification. I wanted to see it: the time I approved, what took it, and
what I could do instead, all at once. A wall is big enough to show a week as
evidence. A desk is where you sign things.

**What it does**

Agent Wall is a hands-only mixed reality app for Meta Quest. The agent plans on
your real wall; the one card that needs you lands on your real desk. When a
time you approved stops fitting:

1. **The wall blocks it and shows why.** The old time stays where it was,
   crossed out and labelled CONFLICT, beside the block that took it. Its email
   draft and calendar file are withdrawn at that moment.
2. **You try a replacement in the room.** Pinch one of two large times: a
   preview appears on the week, and a card flies to your desk with the old
   time, the new time and one computed trade-off. Switching or cancelling
   changes nothing you approved.
3. **You hold to approve.** One continuous pinch-and-hold approves the exact
   card in front of you. Let go early, lose hand tracking or get a new
   conflict, and it cancels. The old invite stays as history, replaced.

You can also say a limit ("Could we push it past three o'clock?"). A language
model only turns the sentence into a search limit; code decides what is free
and what may leave. Nothing leaves without your hold: an approved invite waits
as an email draft and a calendar file, and the last click is yours, in your own
mail app.

It runs at once on a labelled sample week. Your own calendar (an `.ics` file or
a private iCal link) goes through the same check.

**How I built it**

WebXR with Meta's Immersive Web SDK 1.0.1, TypeScript and Vite, on GitHub Pages.
Planes from Space Setup put the board on a wall and the card on a table. Every
decision is plain TypeScript with 332 unit tests. Each panel is one draw call
and one canvas texture, redrawn only when its content changes. A small
Cloudflare Worker keeps the model key off the page.

**Hand interactions**

One hand ray. A pinch selects; a one-second hold commits; both work with the
hand resting in your lap. The board and the card each have a grab bar, like a
Quest window: pinch it, move your hand, and the board snaps onto a wall you let
it go near.

**On a real Quest 3**

A Meta Start mentor ran the conflict review live in a mentor session on 16 Nov:
the hand tracking "works perfectly" and it "felt really smooth". He asked for a
card farther from the eyes and a calendar he could grab and move. Both shipped
that evening and pass 22 scripted hand-pinch checks in Meta's emulator; they
have not been on a headset yet. An independent Quest owner had earlier
confirmed wall placement, recentering, the hold ring and the palm gesture.

**What is next**

The other person's free/busy through a consented calendar connection; the same
review for anything an agent did for you, not only meetings; and a headset pass
with frame times.

**Target launch:** (yours to fill in; see the note below)

Note, not for the form: pick a launch date you can keep. The page is already
public, so "open beta now, 1.0 after a headset pass" is a true answer if the
form takes free text.

---

## 3. Before you submit

- [ ] The Pages build shows its build id on the board, and it is the build the
      video was recorded on.
- [ ] The video is public on YouTube or Vimeo and under three minutes.
- [ ] The video's corner label, its end card and the Devpost text say the same
      thing about testing.
- [ ] The link in the form opens in Quest Browser without a login.
