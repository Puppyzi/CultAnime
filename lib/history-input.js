const MAX_PLAYBACK_SECONDS = 60 * 60 * 24 * 7;

export function parseHistoryInput(body) {
  const episodeId = Number(body?.episode_id);
  const animeId = Number(body?.anime_id);
  const progress = Number(body?.progress);
  const duration = body?.duration == null ? 0 : Number(body.duration);

  if (!Number.isInteger(episodeId) || episodeId <= 0) return { error: 'A valid episode ID is required.' };
  if (!Number.isInteger(animeId) || animeId <= 0) return { error: 'A valid anime ID is required.' };
  if (!Number.isFinite(progress) || progress < 0 || progress > MAX_PLAYBACK_SECONDS) return { error: 'Playback progress is invalid.' };
  if (!Number.isFinite(duration) || duration < 0 || duration > MAX_PLAYBACK_SECONDS) return { error: 'Playback duration is invalid.' };

  return {
    value: {
      episodeId,
      animeId,
      progress,
      duration,
      completed: body?.completed === true,
    },
  };
}
