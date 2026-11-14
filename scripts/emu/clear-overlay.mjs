// Removes a stale Vite error overlay (left from an earlier broken save) from the page and its app frame.
export default async function run({ page, frame }) {
  const clear = () => {
    const els = document.querySelectorAll('vite-error-overlay');
    els.forEach((e) => e.remove());
    return { overlays: els.length, url: location.href };
  };
  const out = { page: await page.evaluate(clear) };
  if (frame) out.frame = await frame.evaluate(clear);
  return out;
}
