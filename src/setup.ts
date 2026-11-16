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

/** The saved board belongs to the old calendar: start clean on the new one. */
function restart(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage blocked: nothing was saved anyway
  }
  location.reload();
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
  const active = activeCalendar();
  status.textContent = saved
    ? `${active.label} · ${active.cal.busy.owner.length} busy times this week`
    : 'Now showing: the sample week.';
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
    say(`Read. ${r.busy} busy times in the next two working weeks. Restarting…`, 'good');
    setTimeout(restart, 700);
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
      setTimeout(restart, 500);
    } else {
      say('Read a calendar first.', 'bad');
    }
  });

  sample.addEventListener('click', () => {
    useSample();
    say('Back to the sample week. Restarting…', 'good');
    setTimeout(restart, 500);
  });
}
