import { describe, expect, it } from 'vitest';
import { readPlayerNumber, resumeSecondsFromHistory } from '../../lib/player-preferences';

describe('player preferences', () => {
  it('resumes meaningful progress and ignores near-start positions', () => {
    expect(resumeSecondsFromHistory({ progress: 95 })).toBe(95);
    expect(resumeSecondsFromHistory({ progress: 3 })).toBe(0);
    expect(resumeSecondsFromHistory({ progress: 'invalid' })).toBe(0);
  });

  it('uses the fallback when no numeric preference has been stored', () => {
    global.window = { localStorage: { getItem: () => null } };
    expect(readPlayerNumber('missing', 1, { min: 0.5, max: 2 })).toBe(1);
    delete global.window;
  });
});
