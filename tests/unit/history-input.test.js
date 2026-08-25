import { describe, expect, it } from 'vitest';
import { parseHistoryInput } from '../../lib/history-input';

describe('parseHistoryInput', () => {
  it('normalizes a valid playback update', () => {
    expect(parseHistoryInput({ episode_id: '4', anime_id: 2, progress: 45.5, duration: 120, completed: true }).value).toEqual({
      episodeId: 4, animeId: 2, progress: 45.5, duration: 120, completed: true,
    });
  });

  it.each([
    [{ episode_id: 0, anime_id: 2, progress: 1 }, 'episode'],
    [{ episode_id: 1, anime_id: 'nope', progress: 1 }, 'anime'],
    [{ episode_id: 1, anime_id: 2, progress: -1 }, 'progress'],
    [{ episode_id: 1, anime_id: 2, progress: 1, duration: Infinity }, 'duration'],
  ])('rejects invalid input %#', (input, messagePart) => {
    expect(parseHistoryInput(input).error.toLowerCase()).toContain(messagePart);
  });
});
