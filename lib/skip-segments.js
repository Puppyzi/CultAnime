export const SKIP_TYPES = ['intro', 'outro'];
export const SKIP_MODES = ['auto', 'custom', 'absent', 'disabled'];

export function validSegment(segment, duration) {
  return (
    SKIP_TYPES.includes(segment?.type) &&
    typeof segment.start === 'number' &&
    Number.isFinite(segment.start) &&
    typeof segment.end === 'number' &&
    Number.isFinite(segment.end) &&
    segment.start >= 0 &&
    segment.end > segment.start &&
    Number.isFinite(duration) &&
    duration > 0 &&
    segment.end <= duration
  );
}

// Overlapping detections are ambiguous: never choose a boundary arbitrarily.
export function safeSegments(segments, duration) {
  const unique = [
    ...new Map(
      segments.filter((s) => validSegment(s, duration)).map((s) => [`${s.type}:${s.start}:${s.end}`, s])
    ).values(),
  ];
  return unique
    .filter((s) => !unique.some((other) => other !== s && s.start < other.end && other.start < s.end))
    .sort((a, b) => a.start - b.start);
}

export function normalizeJellyfinSegments(items, duration) {
  return safeSegments(
    (Array.isArray(items) ? items : []).map((item) => ({
      type: String(item.Type || '').toLowerCase(),
      start: typeof item.StartTicks === 'number' ? item.StartTicks / 10_000_000 : NaN,
      end: typeof item.EndTicks === 'number' ? item.EndTicks / 10_000_000 : NaN,
      source: 'jellyfin',
    })),
    duration
  );
}

export function resolveSkipSegments(automatic, overrides, mediaKey, duration) {
  const types = {};
  const candidates = [];
  for (const type of SKIP_TYPES) {
    const saved = overrides.find((row) => row.type === type);
    const stale = Boolean(saved && saved.media_key !== mediaKey);
    const mode = saved && !stale ? saved.mode : 'auto';
    // A changed file needs review before re-enabling a previously corrected segment.
    const segments = stale
      ? []
      : mode === 'custom'
        ? saved.segments.map((s) => ({ ...s, type, source: 'manual' }))
        : mode === 'auto'
          ? automatic.filter((s) => s.type === type)
          : [];
    types[type] = { mode, stale, segments };
    candidates.push(...segments);
  }
  const manual = safeSegments(
    candidates.filter((s) => s.source === 'manual'),
    duration
  );
  const automaticCandidates = candidates.filter(
    (s) =>
      s.source !== 'manual' && !manual.some((override) => s.start < override.end && override.start < s.end)
  );
  const segments = safeSegments([...manual, ...automaticCandidates], duration);
  for (const type of SKIP_TYPES) types[type].segments = segments.filter((s) => s.type === type);
  return { segments, types };
}

export function parseSkipOverrides(body, duration) {
  if (!body || typeof body !== 'object') throw new Error('Invalid skip settings.');
  return SKIP_TYPES.map((type) => {
    const value = body[type];
    if (!value || !SKIP_MODES.includes(value.mode)) throw new Error(`Choose a valid ${type} mode.`);
    const segments = value.mode === 'custom' ? value.segments : [];
    if (
      !Array.isArray(segments) ||
      segments.length > 10 ||
      (value.mode === 'custom' && segments.length === 0)
    ) {
      throw new Error(`Add between 1 and 10 ${type} intervals.`);
    }
    const normalized = segments.map((s) => ({ type, start: s.start, end: s.end }));
    if (
      normalized.some((s) => !validSegment(s, duration)) ||
      safeSegments(normalized, duration).length !== normalized.length
    ) {
      throw new Error(`Invalid ${type} times: use non-overlapping intervals within the episode runtime.`);
    }
    return { type, mode: value.mode, segments: normalized };
  });
}
