import { describe, expect, it } from 'vitest';
import { normalizeJellyfinSegments, parseSkipOverrides, resolveSkipSegments } from '../../lib/skip-segments';

const item = (type, start, end) => ({
  Type: type,
  StartTicks: start * 10_000_000,
  EndTicks: end * 10_000_000,
});
const auto = [{ type: 'intro', start: 600, end: 687.5, source: 'jellyfin' }];

describe('episode skip intervals', () => {
  it('keeps a manual correction when an automatic interval of another type conflicts', () => {
    const result = resolveSkipSegments(
      auto,
      [{ type: 'outro', mode: 'custom', media_key: 'file', segments: [{ start: 650, end: 750 }] }],
      'file',
      1440
    );
    expect(result.segments).toEqual([{ type: 'outro', start: 650, end: 750, source: 'manual' }]);
  });
  it('keeps late openings and fractional boundaries, without assuming a 90 second duration', () => {
    expect(normalizeJellyfinSegments([item('Intro', 600, 687.5), item('Outro', 1200, 1290)], 1440)).toEqual([
      ...auto,
      { type: 'outro', start: 1200, end: 1290, source: 'jellyfin' },
    ]);
  });

  it('rejects unsupported, malformed, backwards, overlapping and out-of-runtime intervals', () => {
    expect(
      normalizeJellyfinSegments(
        [
          item('Recap', 0, 20),
          item('Intro', -1, 5),
          item('Intro', 3, 2),
          item('Outro', 90, 110),
          { Type: 'Intro', StartTicks: null, EndTicks: 2 },
          item('Intro', 10, 30),
          item('Outro', 20, 40),
          item('Outro', 60, 70),
          item('Outro', 60, 70),
        ],
        100
      )
    ).toEqual([{ type: 'outro', start: 60, end: 70, source: 'jellyfin' }]);
  });

  it('never invents an opening for an episode with no data', () => {
    const result = resolveSkipSegments([], [], 'file', 1440);
    expect(result.segments).toEqual([]);
    expect(result.types.intro.mode).toBe('auto');
  });

  it.each(['absent', 'disabled'])('preserves an explicit %s decision over detection', (mode) => {
    const result = resolveSkipSegments(
      auto,
      [{ type: 'intro', mode, media_key: 'file', segments: [] }],
      'file',
      1440
    );
    expect(result.segments).toEqual([]);
    expect(result.types.intro.mode).toBe(mode);
  });

  it('requires review after a file replacement instead of resurrecting suppressed skips', () => {
    const result = resolveSkipSegments(
      auto,
      [{ type: 'intro', mode: 'disabled', media_key: 'old', segments: [] }],
      'new',
      1440
    );
    expect(result.segments).toEqual([]);
    expect(result.types.intro.stale).toBe(true);
  });

  it('supports more than one explicitly corrected interval of the same type', () => {
    const settings = parseSkipOverrides(
      {
        intro: {
          mode: 'custom',
          segments: [
            { start: 10, end: 40 },
            { start: 80, end: 100 },
          ],
        },
        outro: { mode: 'auto' },
      },
      200
    );
    const result = resolveSkipSegments(
      auto,
      settings.map((s) => ({ ...s, media_key: 'file' })),
      'file',
      200
    );
    expect(result.segments.map((s) => [s.start, s.end])).toEqual([
      [10, 40],
      [80, 100],
    ]);
  });

  it.each([
    { start: '', end: 10 },
    { start: null, end: 10 },
    { start: 20, end: 10 },
    { start: 0, end: Infinity },
    { start: 0, end: 201 },
  ])('rejects invalid manual times %#', (segment) => {
    expect(() =>
      parseSkipOverrides({ intro: { mode: 'custom', segments: [segment] }, outro: { mode: 'auto' } }, 200)
    ).toThrow();
  });
});
