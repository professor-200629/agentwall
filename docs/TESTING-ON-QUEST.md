# Testing Agent Wall on a Quest (10 minutes)

Thank you for helping! I don't have a headset, so you are the first person to
try this on real hardware.

**Link:** https://professor-200629.github.io/agentwall/

Nothing is ever sent: the calendar is sample data and the "outbox" is a demo.
The app saves its board only in your browser.

## Before you start

- Quest 3 or 3S with **hand tracking on** (Settings › Movement tracking).
- Best: a room with **Space Setup** done (Settings › Physical space › Space
  setup), so the board can stick to a wall. Without it the board floats in
  front of you; that is expected.
- Sit down, facing a wall 1–3 m away.

## Steps (please note what happens at each one)

1. Open the link in **Meta Quest Browser**. Wait for the page to load
   (it may take ~10 s the first time). Press **Enter mixed reality**.
   - Did it ask for permission (spatial data)? Did you allow it?
2. **Where did the board appear?** On your wall, or floating in front of you?
   Look at the chip in its top-right corner: "ON YOUR WALL" or "FLOATING".
3. **Can you read it?** Read the title and the line under it out loud from
   your seat. Too small / fine / too big?
4. Point your hand at **"Find time + draft invite"** and pinch (thumb + index
   finger). The agent sweeps the week on the wall (busy times get struck out),
   one time turns **gold**, and an email card appears **on your table** (or
   just above your lap if there is no table near you).
   - Was it easy to aim and pinch? Did anything else get pinched by mistake?
   - Where did the email card land: table, lap, or somewhere odd?
5. Pinch **"Only after 4 PM"**. The gold time and the email should change.
   Look at the small line on the right of the header: does it say
   "Planned by AI · Groq" or "Rules · …"?
   - Point at an amber striped area on the week ("before 4 PM rule") and
     pinch: the rule should disappear and the agent re-plans.
   - Point at any free (empty) half hour and pinch: the email should move to
     that time.
6. Pinch one of the outlined **"4:00 PM ⇄"** pills on the wall. The email
   should rewrite itself and say "NEEDS APPROVAL". Then pinch a chip again:
   does that next pinch work first time?
7. **Approve:** point at the email card, **pinch and hold** for about one
   second. A ring fills and you hear a chime; the card says "Sending in 5 s".
   - Was holding steady easy? Did the ring ever stop on its own?
   - Did you hear the chime?
   - Optional: while it says "Sending", pinch the card once: it should say
     "Unsent". Then pinch and hold it again to approve.
   - After 5 s the card shows a receipt (RULES / AI / YOU). About 8 s later a
     red "Conflict" appears and a **Re-plan?** card on the wall: pinch
     **Re-plan** and check the invite moves to a new time.
8. New in the latest build (any order, all optional):
   - After asking, the email card should **fly down from the wall to your
     table**, and you may **hear the agent** say the time (🔊 button = voice
     on/off). Did you hear it?
   - After an invite is sent, the agent offers a **prep block** and a
     **reminder**: pinch the left or right button.
   - Pinch **🎯 Focus 2 h**: a 2-hour block on Thursday, as a calendar card.
   - Hold an **open palm toward your face** for a second (no pinch): a ring
     fills and the board comes to where you look. Did it ever trigger when you
     did not want it?
9. Pinch **🎤 Speak** and say: *"Thursday please"*. Wait ~5 s.
   - Did the browser ask for the microphone? Did it break the
     mixed reality view? What did the board show after "Heard: …"?
10. Leave mixed reality (Meta button › exit, or close). Shift in your seat or
   turn your head a little, then press **Enter mixed reality** again. The board
   should come back to the **same spot on the same wall**, and the chip in its
   top-right corner should say "BACK ON YOUR WALL". Did it land in the same
   place?
   - Pinch **⤢ Move board** (top right) and look at another spot on your wall
     for 3 seconds. Did the board move there?
   - Hold the Meta button to recenter your view. Did the board stay where it
     was on the wall?
11. Close the browser tab, open the link again: it should say
    "Welcome back · board saved …".

## Please send back

- Headset model, and whether Space Setup was done.
- For each step: worked / didn't / what you saw.
- **Did it feel smooth or stuttery?** (Quest Browser: three-dot menu ›
  "Show FPS" if you have it, or just your impression.)
- A **screenshot or short screen recording** (Meta button › camera) helps a lot.
- Anything confusing in the first minute.

---

## Short post for the Meta forum / Discord (copy, edit, post)

> **Looking for 1 Quest tester (10 min) – WebXR mixed reality, hands only**
>
> I'm a solo dev in the Start competition without a headset. Agent Wall puts
> a board on your real wall where an AI agent plans one meeting; you approve
> the invite with a pinch-and-hold. Nothing is sent (sample data).
>
> Link: https://professor-200629.github.io/agentwall/
> Checklist (10 steps): https://github.com/professor-200629/agentwall/blob/main/docs/TESTING-ON-QUEST.md
>
> A screenshot or "worked / didn't" for each step would help a lot.
> Happy to test your build back on my side by reading your code or giving feedback.
