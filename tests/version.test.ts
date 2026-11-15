import { describe, expect, it } from 'vitest';
import { freshUrl, needsReload } from '../src/logic/version.js';

describe('always run the newest build (Quest tester had to clear browser data)', () => {
  it('reloads once when a newer build is live', () => {
    expect(needsReload('1f47b20', 'abc1234', null)).toBe(true);
    // Already reloaded for that build and still old: do not loop.
    expect(needsReload('1f47b20', 'abc1234', 'abc1234')).toBe(false);
    // A later deploy gets its own one reload.
    expect(needsReload('1f47b20', 'def5678', 'abc1234')).toBe(true);
  });

  it('does nothing when up to date, in dev, or when the version is unknown', () => {
    expect(needsReload('abc1234', 'abc1234', null)).toBe(false);
    expect(needsReload('dev', 'abc1234', null)).toBe(false);
    expect(needsReload('abc1234', undefined, null)).toBe(false);
  });

  it('builds a URL no cache has seen, keeping the rest of the address', () => {
    expect(freshUrl('https://x.github.io/agentwall/', 'abc1234')).toBe('https://x.github.io/agentwall/?v=abc1234');
    expect(freshUrl('https://x.github.io/agentwall/?v=old&debug=1', 'abc1234')).toBe(
      'https://x.github.io/agentwall/?v=abc1234&debug=1',
    );
  });
});
