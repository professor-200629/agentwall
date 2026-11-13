// Calls a window.agentwall test hook in the emulator page.
// The hook and arguments come from AGENTWALL_CALL, e.g. '{"fn":"state","args":[]}'.
export default async function run({ page, frame }) {
  const target = frame ?? page;
  const call = JSON.parse(process.env.AGENTWALL_CALL ?? '{"fn":"state","args":[]}');
  return await target.evaluate(({ fn, args }) => {
    const api = window.agentwall;
    if (!api || typeof api[fn] !== 'function') return { error: `no hook ${fn}` };
    return api[fn](...(args ?? []));
  }, call);
}
