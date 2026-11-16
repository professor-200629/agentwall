/**
 * The start page's "Use my own calendar" box. Plain DOM, text only (textContent,
 * never innerHTML): calendar titles and typed names are other people's text.
 *
 * After a change the page reloads, so the board starts on the new calendar.
 */
import {
  activeCalendar,
  guestFrom,
  importLink,
  importText,
  refreshState,
  savedCalendar,
  setDetails,
  shortLine,
  useSample,
  type Details,
  type ImportResult,
} from './calendar-source.js';
import { ICS_LIMITS } from './logic/ics.js';
import { STORAGE_KEY } from './logic/storage.js';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

/**
 * Reload so the board starts on the new calendar.
 *
 * A newer read of YOUR calendar keeps the board: what you approved is checked
 * against the new snapshot as the board starts, and anything it now overlaps is
 * blocked there. Switching between the sample week and your own calendar clears
 * the board: an approval belongs to the calendar it was made on.
 */
function restart(keepBoard = false): void {
  if (!keepBoard) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // storage blocked: nothing was saved anyway
    }
  }
  location.reload();
}

let showStatus: () => void = () => {};

/** A linked calendar was just read again (or could not be): show what the wall is using now. */
export function showCalendarStatus(): void {
  showStatus();
}

export function initSetup(workerUrl: string): void {
  const status = el<HTMLParagraphElement>('cal-status');
  const msg = el<HTMLParagraphElement>('cal-msg');
  const file = el<HTMLInputElement>('cal-file');
  const link = el<HTMLInputElement>('cal-link');
  const read = el<HTMLButtonElement>('cal-read');
  const guest = el<HTMLInputElement>('cal-guest');
  const email = el<HTMLInputElement>('cal-email');
  const topic = el<HTMLInputElement>('cal-topic');
  const owner = el<HTMLInputElement>('cal-owner');
  const save = el<HTMLButtonElement>('cal-save');
  const sample = el<HTMLButtonElement>('cal-sample');
  if (!status || !msg || !file || !link || !read || !guest || !email || !topic || !owner || !save || !sample) return;

  const saved = savedCalendar();
  showStatus = () => {
    const active = activeCalendar();
    const refresh = refreshState();
    status.textContent = savedCalendar()
      ? `${active.label} · ${active.cal.busy.owner.length} busy times this week`
      : 'Now showing: the sample week.';
    // Read while the page loaded: say if that failed, since the wall then shows the older read.
    if (refresh.tried && !refresh.ok) {
      msg.textContent = `Your link could not be read just now. ${refresh.error} The wall shows the last read; what you approved was checked against that.`;
      msg.className = 'bad';
    }
  };
  showStatus();
  sample.hidden = !saved;
  save.hidden = !saved;
  if (saved) {
    guest.value = saved.guest?.name ?? '';
    email.value = saved.guest?.email ?? '';
    topic.value = saved.topic;
    owner.value = saved.owner;
    if (saved.source === 'link' && saved.url) link.value = saved.url;
  }

  const say = (text: string, kind: 'good' | 'bad' | '' = '') => {
    msg.textContent = text;
    msg.className = kind;
  };
  const details = (): Details => ({
    guest: guestFrom(guest.value, email.value),
    owner: shortLine(owner.value, 24),
    topic: shortLine(topic.value),
  });
  const done = (r: ImportResult) => {
    if (!r.ok) {
      say(r.error, 'bad');
      return;
    }
    // `saved` is what was there when the page loaded: your own calendar before, and again now.
    const again = saved !== null;
    say(
      `Read. ${r.busy} busy times in the next two working weeks. ${again ? 'Checking what you approved against it…' : 'Restarting…'}`,
      'good',
    );
    setTimeout(() => restart(again), 700);
  };

  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    if (f.size > ICS_LIMITS.maxBytes) {
      say('This calendar is too large (over 3 MB).', 'bad');
      return;
    }
    say('Reading…');
    f.text().then(
      (text) => done(importText(text, 'file', { details: details() })),
      () => say('The file could not be read.', 'bad'),
    );
  });

  read.addEventListener('click', () => {
    say('Reading…');
    read.disabled = true;
    void importLink(link.value, workerUrl, { details: details() })
      .then(done)
      .finally(() => {
        read.disabled = false;
      });
  });

  save.addEventListener('click', () => {
    if (setDetails(details())) {
      say('Saved. Restarting…', 'good');
      setTimeout(() => restart(), 500);
    } else {
      say('Read a calendar first.', 'bad');
    }
  });

  sample.addEventListener('click', () => {
    useSample();
    say('Back to the sample week. Restarting…', 'good');
    setTimeout(() => restart(), 500);
  });
}
