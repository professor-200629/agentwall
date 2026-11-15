/**
 * Always run the newest build. GitHub Pages lets browsers keep index.html for
 * 10 minutes (Cache-Control: max-age=600), and Quest Browser can hold it longer:
 * the first Quest tester had to "Delete browser data" to see a fix (15 Nov).
 *
 * On load the app fetches version.json (written at build time, fetched with a
 * fresh query so no cache can answer). If a newer build is live, it reloads
 * once with ?v=<build>, a URL no cache has seen. Plain TypeScript, unit-tested.
 */

/** Should the page reload to pick up the deployed build? */
export function needsReload(running: string, deployed: string | undefined, alreadyTriedFor: string | null): boolean {
  if (running === 'dev' || !deployed || deployed === running) return false;
  return alreadyTriedFor !== deployed; // never loop if the reload did not help
}

/** The same page, with ?v=<build> so the browser must fetch it fresh. */
export function freshUrl(href: string, build: string): string {
  const url = new URL(href);
  url.searchParams.set('v', build);
  return url.toString();
}

export const RELOAD_KEY = 'agentwall.reloadedFor';
