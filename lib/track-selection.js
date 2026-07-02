/**
 * Shared audio/subtitle track heuristics.
 *
 * Pure functions with no server-only imports, so both the server-side stream
 * resolver (lib/playback.js) and the client-side player use the exact same
 * automatic track choices.
 */

function trackText(track) {
  return `${track?.language || ''} ${track?.title || ''}`.toLowerCase();
}

export function isJapaneseAudioTrack(track) {
  const text = trackText(track);
  return text.includes('jpn') || text.includes('japanese') || text.includes('ja ');
}

export function isEnglishSubtitle(subtitle) {
  const text = trackText(subtitle);
  return text.includes('eng') || text.includes('english') || text.includes(' en ');
}

export function isSignsOnlySubtitle(subtitle) {
  const text = trackText(subtitle);
  return subtitle?.isForced
    || text.includes('forced')
    || text.includes('signs')
    || text.includes('songs');
}

export function isFullSubtitle(subtitle) {
  const text = trackText(subtitle);
  return text.includes('full') || text.includes('dialog') || text.includes('dialogue');
}

export function requiresBurnedInSubtitle(subtitle) {
  const codec = (subtitle?.codec || '').toLowerCase();
  return codec === 'ass' || codec === 'ssa';
}

export function chooseSubtitle(subtitles, requestedIndex) {
  if (requestedIndex !== null && requestedIndex !== undefined) {
    const requested = subtitles.find(sub => String(sub.index) === String(requestedIndex));
    if (requested) return requested;
  }

  return subtitles.find(sub => isEnglishSubtitle(sub) && isFullSubtitle(sub) && !isSignsOnlySubtitle(sub))
    || subtitles.find(sub => isEnglishSubtitle(sub) && !isSignsOnlySubtitle(sub))
    || subtitles.find(sub => isFullSubtitle(sub) && !isSignsOnlySubtitle(sub))
    || subtitles.find(sub => isEnglishSubtitle(sub))
    || subtitles.find(sub => sub.isDefault)
    || subtitles[0]
    || null;
}

export function chooseAudioTrack(audioTracks, requestedIndex) {
  if (requestedIndex !== null && requestedIndex !== undefined) {
    const requested = audioTracks.find(track => String(track.index) === String(requestedIndex));
    if (requested) return requested;
  }

  return audioTracks.find(track => isJapaneseAudioTrack(track))
    || audioTracks.find(track => track.isDefault)
    || audioTracks[0]
    || null;
}
