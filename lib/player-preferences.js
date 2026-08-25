export const SUBTITLE_PREF_KEY = 'cultanime.subtitleTrack';
export const AUDIO_PREF_KEY = 'cultanime.audioTrack';
export const NEXT_AIRING_HIDDEN_KEY = 'cultanime.nextAiringHidden';
export const PLAYER_VOLUME_KEY = 'cultanime.playerVolume';
export const AUTOPLAY_NEXT_KEY = 'cultanime.autoplayNext';

function mediaPreferenceKey(baseKey, animeId) {
  return animeId ? `${baseKey}.${animeId}` : baseKey;
}

export function readMediaPreference(baseKey, animeId) {
  try {
    const key = mediaPreferenceKey(baseKey, animeId);
    const scoped = window.localStorage.getItem(key);
    if (scoped !== null) return scoped;
    const legacy = window.localStorage.getItem(baseKey);
    if (legacy !== null && animeId) {
      window.localStorage.setItem(key, legacy);
      window.localStorage.removeItem(baseKey);
      return legacy;
    }
    return null;
  } catch { return null; }
}

export function writeMediaPreference(baseKey, animeId, value) {
  try { window.localStorage.setItem(mediaPreferenceKey(baseKey, animeId), value); } catch { /* Optional. */ }
}

export function removeMediaPreference(baseKey, animeId) {
  try { window.localStorage.removeItem(mediaPreferenceKey(baseKey, animeId)); } catch { /* Optional. */ }
}

export function readNextAiringHidden() {
  try { return window.sessionStorage.getItem(NEXT_AIRING_HIDDEN_KEY) === 'true'; } catch { return false; }
}

export function writeNextAiringHidden(hidden) {
  try {
    if (hidden) window.sessionStorage.setItem(NEXT_AIRING_HIDDEN_KEY, 'true');
    else window.sessionStorage.removeItem(NEXT_AIRING_HIDDEN_KEY);
  } catch { /* Optional. */ }
}

export function readPlayerNumber(key, fallback, { min, max } = {}) {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === null || stored === '') return fallback;
    const value = Number(stored);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max ?? value, Math.max(min ?? value, value));
  } catch { return fallback; }
}

export function readPlayerBoolean(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === 'true';
  } catch { return fallback; }
}

export function writePlayerSetting(key, value) {
  try { window.localStorage.setItem(key, String(value)); } catch { /* Optional. */ }
}

export function resumeSecondsFromHistory(entry) {
  const progress = Number(entry?.progress);
  return Number.isFinite(progress) && progress >= 5 ? progress : 0;
}
