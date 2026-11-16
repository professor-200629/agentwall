# Agent Wall: video sequence and Devpost text

Drafts for the Meta VR Start Developer Competition 2026 (Productivity, New
Experience). Deadline: **18 Nov 2026 12:00 PM PT = 19 Nov 1:30 AM IST**. The
rules ask for a public YouTube or Vimeo video under three minutes; footage from
a simulator counts when it shows the same build.

Everything below describes the build on branch `conflict-review`. What ran
where is said plainly: **emulator** means Meta's browser emulator (IWER) on a
laptop with real emulated hand pinches; **headset** means a person wore one.

---

## 1. The video (75 to 85 seconds)

One story: *an approved time stops fitting, you try another one in the room,
and one hold approves exactly what you see.* Focus time, the day streak and
moving a meeting are not in it.

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

It plays the sequence below with real emulated hand pinches, smooth head moves
and pauses, and prints each shot's time. Do not touch the mouse while it runs.
`SLOW=1.3` stretches every pause if the voice-over needs more room. Record the
voice afterwards over the picture. Crop the emulator's "Remote Control Active"
badge at the bottom, or leave it: it is an honest sign that this is the emulator.

If a tester records on a Quest instead (better: it is the exact build on real
hardware), the same eleven shots apply; the tester follows
`docs/TESTING-ON-QUEST.md`, "The 90-second flow".

### Shot list

| # | Time | Picture | Voice-over | Text on screen |
| --- | --- | --- | --- | --- |
| 1 | 0:00 – 0:04 | Seated view: the board on the wall. One card: "Try it". | "Yesterday I approved a call for Tuesday at one." | Agent Wall · your week on the wall, the decision on your desk |
| 2 | 0:04 – 0:08 | The hand pinches **Try it**. A red block lands on Tuesday 1 PM. | "This morning my week changed." | EXAMPLE CHANGE · synthetic data |
| 3 | 0:08 – 0:15 | Lean in. The old time is crossed out and labelled **CONFLICT**; the block that took it sits beside it, **NEW · EXAMPLE**. The bar: "Tue 1:00 PM overlaps a new busy block". | "The time I approved is taken. The wall shows me why, and the old time stays where it was." | |
| 4 | 0:15 – 0:20 | Look down: the old invite on the desk, red, **BLOCKED**. | "The old invite is blocked at once. Its email draft and calendar file are gone." | Blocked before I did anything |
| 5 | 0:20 – 0:27 | Back to the wall. Pinch **Wed 5:30 PM**. An amber **PREVIEW** appears on Wednesday; Tuesday's conflict is still there. | "I try another time, in the room. It is only a preview." | |
| 6 | 0:27 – 0:33 | The card on the desk: "WAS Tue 1:00 PM → NOW Wed 5:30 PM · Last half hour of the workday". | "The card shows both times and one trade-off." | |
| 7 | 0:33 – 0:39 | Pinch **Thu 1:00 PM** instead. The preview moves. | "I change my mind. Nothing I approved has moved." | |
| 8 | 0:39 – 0:48 | Look down. Pinch and hold: the amber ring fills, labelled "HOLD TO APPROVE · Thu 1:00 PM". A chime. | "One continuous hold approves exactly this card. Let go early, lose tracking, or get a new conflict, and it cancels." | One hold · the exact card shown |
| 9 | 0:48 – 0:56 | "Sending in 5 s · pinch to Unsend", then the receipt: "Blocked the old one (Tue 1:00 PM)". | "Five seconds to take it back." | |
| 10 | 0:56 – 1:03 | The wall: Thursday in gold. The outbox: "✓ Thu 19 Nov, 1:00 PM" and "✕ REPLACED · Tue 17 Nov, 1:00 PM". | "The old invite stays as history, blocked for good." | |
| 11 | 1:03 – 1:12 | The start page: the old item struck out, "Email, calendar file and copy are off". The new one: **Open email draft**, **Add to my calendar**. | "The new one waits as an email draft and a calendar file, in my own apps. Agent Wall sends nothing." | Agent Wall sends nothing |
| End | 1:12 – 1:18 | Link and one line. | (none) | professor-200629.github.io/agentwall · WebXR, hands only, Meta IWSDK · "Recorded in Meta's emulator" (or "Recorded on Quest 3" if a tester records it) |

Optional opening, from the mentors' advice (16 Nov) that the first 10 seconds
must show what the app is and that "grabbing events left and right" is what
makes a calendar interesting: start with 3 seconds of the hand pinching the bar
on top of the board, dragging the week across the room and letting it snap onto
the wall. Then shot 1. (The script does not play this yet; record it by hand in
the emulator, or ask a tester.)

Optional shot 7b (adds about 9 s, `AI=1` in the script): pinch 🎤 and say
**"Could we push it past three o'clock?"**. The bar answers "LIVE AI understood
'only after 3 PM' · now Wed 5:30 PM and Thu 3:30 PM". Use it only if it is
recorded live on a headset or with a real microphone; the script's version uses
a canned answer and must then be captioned "simulated answer". Voice-over: "A
spoken limit changes the search. The AI never approves anything."

### What the video must not claim

- The conflict flow was run on a Quest 3 by a Meta mentor on 16 Nov (README,
  "Status"). You may say that. Do not say the grab bars or the card's new place
  were tested on a headset unless someone has done it by then, and do not quote
  a frame rate: nobody measured one.
- Not "sends the invite". It never does.
- The busy block is an example: the caption in shots 2 and 3 stays.

---

## 2. Devpost text

**Tagline (137 characters; the form allows 140)**

> Your week on your real wall, the decision on your desk. When an approved time stops fitting, try another in the room and hold to approve.

**Inspiration**

An assistant that books a meeting is easy to build and hard to trust, because
the week keeps changing after you say yes. On a screen a changed plan is one
more notification. I wanted to see it: the time I approved, what took it, and
what I could do instead, all at once. A wall is big enough to show a week as
evidence. A desk is where you sign things.

**What it does**

Agent Wall is a hands-only mixed reality page for Meta Quest. Your week is on
your real wall; the one card that needs you is on your real desk (or in front
of your seat when the headset knows no table). When a newer calendar overlaps a
time you already approved:

1. **The wall shows the change.** The old time stays where it was, crossed out
   and labelled CONFLICT, beside the block that took it, with the reason ("Tue
   1:00 PM overlaps a new busy block"). On your own calendar it adds "Guest
   availability unknown". The old invite is blocked at that moment: no email
   draft, no calendar file, no copy.
2. **You try a replacement in the room.** Two large targets offer other times.
   Pinch one: a preview appears on the week while the old conflict stays, and a
   card flies to your desk with both times and one computed trade-off ("Leaves
   30 minutes before Sam's next event"). Switching or cancelling changes nothing
   you approved.
3. **You hold to approve.** One continuous pinch-and-hold approves the exact
   card shown. Letting go early, losing hand tracking, a new conflict or a new
   plan cancels it. The old item stays in the outbox as history, replaced.

You can say a limit ("Could we push it past three o'clock?"). The live AI only
turns the sentence into a limit; code decides what is free, what collides and
what may be handed off, and the board says whether LIVE AI or RULES understood
you. Approved items wait as an email draft and a calendar file for your own
apps. Agent Wall sends nothing.

It runs out of the box on a labelled sample week with a labelled example change:
no account, no key. Your own calendar (an `.ics` file or a private iCal link)
goes through the same check.

**How I built it**

WebXR with Meta's Immersive Web SDK 1.0.1, TypeScript and Vite, on GitHub Pages.
Planes from Space Setup place the board on a wall and the card on a table. All
decisions are plain TypeScript with 301 unit tests; panels are canvas textures,
one draw call each. A small Cloudflare Worker keeps the Groq key off the page.

**Hand interactions**

One hand ray. A pinch selects; a one-second hold commits. The review's targets
are about 22 x 9 cm with pads that meet halfway, so a wobbling ray still lands
on one. The board and the card each have a grab bar, like a Quest window: pinch
it and move your hand, push away to send it far, and the board snaps onto a wall
you let it go near. An open palm toward your face brings the board to you. Hands
stay in the lap; nothing asks you to reach for the wall.

**What is tested, and what is not**

Two people have run it on a real headset. A Quest owner on the Meta forum
tested earlier builds: wall placement, Move board, recenter, the hold ring and
chime, the palm gesture. A Meta Start mentor ran the conflict review on a Quest 3
in a live mentor session and said it worked well, the hand tracking "works
perfectly" and it "felt really smooth". He asked for two changes (the card
farther away; grab and move the calendar), which I made that evening. Those two
have run in Meta's emulator only (22 checks with real emulated pinches). No
frame rate was measured on a Quest.

**What is next**

A headset pass with frame times; the other person's free/busy through a
consented calendar connection; and the same review for anything an agent did
for you, not only meetings.

**Target launch:** (yours to fill in; see the note below)

Note, not for the form: pick a launch date you can keep. The page is already
public, so "open beta now, 1.0 after a headset pass" is a true answer if the
form takes free text.

---

## 3. Before you submit

- [ ] The branch is merged and the Pages build shows its build id on the board.
- [ ] The video is public on YouTube or Vimeo and under three minutes.
- [ ] The video's end card and the Devpost text say the same thing about testing.
- [ ] The link in the form opens in Quest Browser without a login.
