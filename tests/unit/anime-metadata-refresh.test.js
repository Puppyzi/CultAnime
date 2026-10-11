import { afterEach, describe, expect, it, vi } from 'vitest';
import { bestAnilistCandidate, shouldRefreshAnimeMetadata, shouldRefreshExistingAnimeMetadata } from '../../lib/admin-sync';

afterEach(() => vi.useRealTimers());

describe('anime metadata refresh', () => {
  it('keeps checking rated airing shows so FINISHED can be imported', () => {
    vi.useFakeTimers();
    const record = { id: 1001, anilist_id: 1, rating: 84, status: 'RELEASING' };
    expect(shouldRefreshAnimeMetadata(record)).toBe(true);
    expect(shouldRefreshAnimeMetadata(record)).toBe(false);
    vi.advanceTimersByTime(15 * 60 * 1000);
    expect(shouldRefreshAnimeMetadata(record)).toBe(true);
  });
  it.each([null, 0, ''])('retries missing rating %s on finished shows', (rating) => {
    vi.useFakeTimers();
    const record = { id: 2000 + String(rating).length, anilist_id: String(rating), rating, status: 'FINISHED' };
    record.anilist_id = 'id-' + String(rating);
    expect(shouldRefreshAnimeMetadata(record)).toBe(true);
    vi.advanceTimersByTime(15 * 60 * 1000);
    expect(shouldRefreshAnimeMetadata(record)).toBe(true);
  });
  it('refreshes rated finished entries daily instead of every sync', () => {
    vi.useFakeTimers();
    const record = { id: 1003, anilist_id: 3, rating: 80, status: 'FINISHED' };
    expect(shouldRefreshAnimeMetadata(record)).toBe(true);
    vi.advanceTimersByTime(15 * 60 * 1000);
    expect(shouldRefreshAnimeMetadata(record)).toBe(false);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(shouldRefreshAnimeMetadata(record)).toBe(true);
  });
  it('rematches an unreleased entry with existing episodes, with a cooldown', () => {
    const record = { id: 1004, anilist_id: 4, status: 'NOT_YET_RELEASED' };
    expect(shouldRefreshExistingAnimeMetadata(record, { maxEpisodeNumber: 24 })).toBe(true);
    expect(shouldRefreshExistingAnimeMetadata(record, { maxEpisodeNumber: 24 })).toBe(false);
  });
  it('retries unmatched records even when they have artwork', () => {
    expect(shouldRefreshExistingAnimeMetadata({ id: 1005, cover_image: 'poster.jpg' })).toBe(true);
  });
  it('matches the aired cour instead of an unreleased sequel for a combined season', () => {
    const title = { english: 'Mushoku Tensei: Jobless Reincarnation Season 2', romaji: 'Mushoku Tensei II: Isekai Ittara Honki Dasu' };
    const aired = { id: 1, title, format: 'TV', seasonYear: 2023, episodes: 12, status: 'FINISHED' };
    const upcoming = { id: 2, title: { english: 'Mushoku Tensei: Jobless Reincarnation Season 3 Part 2' }, format: 'TV', status: 'NOT_YET_RELEASED' };
    const context = { baseName: 'Mushoku Tensei: Jobless Reincarnation', seasonNumber: 2, productionYear: 2023, maxEpisodeNumber: 24 };
    expect(bestAnilistCandidate([upcoming, aired], 'series', context)?.id).toBe(1);
    expect(shouldRefreshExistingAnimeMetadata({ ...aired, anilist_id: 1, year: 2023, episodes_total: 12, title: title.english }, context)).toBe(false);
    expect(bestAnilistCandidate([upcoming], 'series', context)).toBe(null);
  });
});
