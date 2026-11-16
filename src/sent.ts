/**
 * The start page's "Approved by you" list: every card you held in mixed reality,
 * with a real email draft, a real calendar file and a copy button.
 * Plain DOM, text only (textContent, never innerHTML).
 */
import { asText, eventIcs, mailtoLink } from './logic/handoff.js';
import type { OutboxItem } from './logic/plan.js';
import { restore, STORAGE_KEY } from './logic/storage.js';
import type { CalendarData } from './logic/scheduler.js';

let urls: string[] = [];

function read(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Draw the list from what the board saved. Safe to call any time. */
export function renderSent(cal: CalendarData, real: boolean): void {
  const box = document.getElementById('sent-box');
  const list = document.getElementById('sent-list');
  if (!box || !list) return;
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls = [];
  list.textContent = '';
  const items: OutboxItem[] = (restore(read(), cal)?.outbox ?? []).filter((o) => o.status !== 'sending');
  box.hidden = items.length === 0;
  for (const item of items) {
    const li = document.createElement('li');
    const what = document.createElement('div');
    what.className = 'what';
    what.textContent = item.subject;
    const who = document.createElement('div');
    who.textContent = `To: ${item.to}${real ? '' : ' (sample)'}`;
    li.append(what, who);

    const mail = mailtoLink(item);
    if (mail) {
      const a = document.createElement('a');
      a.href = mail;
      a.textContent = 'Open email draft';
      li.append(a);
    }
    const ics = eventIcs(item);
    if (ics) {
      const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
      urls.push(url);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'agent-wall-event.ics';
      a.textContent = 'Add to my calendar (.ics)';
      li.append(a);
    }
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copy text';
    copy.addEventListener('click', () => {
      const done = (ok: boolean) => {
        copy.textContent = ok ? 'Copied' : 'Could not copy';
        setTimeout(() => (copy.textContent = 'Copy text'), 1500);
      };
      if (!navigator.clipboard) done(false);
      else navigator.clipboard.writeText(asText(item)).then(() => done(true), () => done(false));
    });
    li.append(copy);
    list.append(li);
  }
}
