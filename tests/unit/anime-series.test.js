import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { groupAnimeSeries, queryAnimeSeries, readAnimeSeriesRows } from '../../lib/anime-series';
import { mediaStatusBadgeLabel } from '../../lib/media-status';
import { formatAnilistData } from '../../lib/anilist';

const season = (number, extra = {}) => ({
  id: number,
  title: number === 1 ? 'Example' : 'Example Season ' + number,
  jellyfin_id: 'series:season:' + number,
  year: 2020 + number,
  season: 'SPRING',
  episode_count: 12,
  first_episode_number: 1,
  episodes_total: 12,
  cover_image: 'cover-' + number,
  description: 'Description ' + number,
  genres: '["Adventure"]',
  format: 'TV',
  created_at: '2026-01-0' + number,
  ...extra,
});

describe('series catalog', () => {
  it('accepts manual records with no alternate title or season metadata', () => {
    const [series] = groupAnimeSeries([
      season(1, { jellyfin_id: null, title_romaji: null, season_number: null }),
      season(3, { jellyfin_id: null, title_romaji: null, series_relations: '[null]' }),
    ]);
    expect(series.season_ids).toEqual([1, 3]);
    expect(series.cover_image).toBe('cover-3');
  });
  it('uses the latest season art even when older seasons were imported later', () => {
    const [series] = groupAnimeSeries([season(3), season(1, { created_at: '2026-10-13' }), season(2)]);
    expect(series).toMatchObject({
      id: 1,
      title: 'Example',
      cover_image: 'cover-3',
      episode_count: 36,
      season_count: 3,
      created_at: '2026-10-13',
    });
    expect(series.seasons.map((s) => s.season_label)).toEqual(['Season 1', 'Season 2', 'Season 3']);
    expect(series.seasons[0]).toMatchObject({ cover_image: 'cover-1', description: 'Description 1' });
  });
  it('keeps the real numbering when only season 3 or seasons 1 and 3 exist', () => {
    expect(groupAnimeSeries([season(3)])[0].seasons.map((s) => s.season_label)).toEqual(['Season 3']);
    const [series] = groupAnimeSeries([season(1), season(2, { episode_count: 0 }), season(3)]);
    expect(series.season_ids).toEqual([1, 3]);
    expect(series.seasons.map((s) => s.season_label)).toEqual(['Season 1', 'Season 3']);
    expect(groupAnimeSeries([season(2, { episode_count: 0 })])).toEqual([]);
  });
  it('keeps named entries together without turning their names into numbers', () => {
    const [series] = groupAnimeSeries([
      season(3, { title: 'Monogatari Series Second Season', episode_count: 23 }),
      season(1, { title: 'Bakemonogatari', episode_count: 15 }),
      season(2, { title: 'Nisemonogatari', episode_count: 11 }),
    ]);
    expect(series.seasons.map((s) => [s.season_label, s.episode_count])).toEqual([
      ['Bakemonogatari', 15],
      ['Nisemonogatari', 11],
      ['Monogatari Series Second Season', 23],
    ]);
  });
  it('uses Jellyfin season 2 for combined cours and keeps the matching description', () => {
    const [series] = groupAnimeSeries([
      season(1),
      season(2, { title: 'Example Season 2 Part 2', episode_count: 24 }),
      season(3),
    ]);
    expect(series.seasons[1]).toMatchObject({
      season_label: 'Season 2',
      title: 'Example Season 2 Part 2',
      episode_count: 24,
      description: 'Description 2',
    });
  });
  it('preserves separate cour titles when both are stored as separate entries', () => {
    const [series] = groupAnimeSeries([
      season(2, { jellyfin_id: null, title: 'Example Season 2 Part 1', year: 2023 }),
      season(4, { jellyfin_id: null, title: 'Example Season 2 Part 2', year: 2024 }),
    ]);
    expect(series.seasons.map((s) => s.season_label)).toEqual([
      'Example Season 2 Part 1',
      'Example Season 2 Part 2',
    ]);
  });
  it('links differently named manual entries through an unavailable prequel/sequel', () => {
    const [series] = groupAnimeSeries([
      season(1, {
        jellyfin_id: null,
        anilist_id: 100,
        title: 'First Story',
        series_relations: '[{"id":200,"type":"SEQUEL"}]',
      }),
      season(3, {
        jellyfin_id: null,
        anilist_id: 300,
        title: 'Final Story',
        series_relations: '[{"id":200,"type":"PREQUEL"}]',
      }),
    ]);
    expect(series.season_ids).toEqual([1, 3]);
    expect(series.seasons.map((s) => s.season_label)).toEqual(['First Story', 'Final Story']);
  });
  it('does not group spin-offs, unrelated shows or title substrings', () => {
    const rows = [
      season(1, { anilist_id: 100, series_relations: '[{"id":200,"type":"SIDE_STORY"}]' }),
      season(2, { jellyfin_id: 'other:season:1', anilist_id: 200 }),
      season(3, { jellyfin_id: null, title: 'Example Other' }),
    ];
    expect(groupAnimeSeries(rows)).toHaveLength(3);
  });
  it('matches any season before paginating distinct series and keeps latest art', () => {
    const rows = [
      season(1, { title: 'First Story' }),
      season(2, { title: 'Second Story', genres: '["Drama"]' }),
      season(5, { jellyfin_id: 'another:season:1', title: 'Other', genres: '["Comedy"]' }),
    ];
    const result = queryAnimeSeries(rows, { search: 'FIRST STORY', genre: 'Drama', limit: 1 });
    expect(result).toMatchObject({ total: 1, totalPages: 1, anime: [{ id: 1, cover_image: 'cover-2' }] });
    expect(result.anime[0]).not.toHaveProperty('seasons');
    expect(queryAnimeSeries(rows, { limit: 1, page: 2 }).anime).toHaveLength(1);
    expect(queryAnimeSeries(rows, { search: '%' }).total).toBe(0);
  });
  it('checks airing completion against the newest season, not aggregate episode counts', () => {
    const [series] = groupAnimeSeries([season(1), season(2, { episode_count: 1, status: 'RELEASING' })]);
    expect(mediaStatusBadgeLabel(series)).toBe('AIRING');
    expect(mediaStatusBadgeLabel({ ...series, latest_episode_count: 12 })).toBe('');
  });
  it('reads downloaded counts and first playable episode without changing records', () => {
    const db = new Database(':memory:');
    try {
      db.exec(
        "CREATE TABLE anime (id INTEGER, title TEXT); CREATE TABLE episodes (id INTEGER, anime_id INTEGER, episode_number INTEGER, season_number INTEGER); INSERT INTO anime VALUES (1, 'Example'), (2, 'Empty'); INSERT INTO episodes VALUES (1, 1, 4, 3), (2, 1, 5, 3);"
      );
      expect(readAnimeSeriesRows(db)).toEqual([
        { id: 1, title: 'Example', episode_count: 2, first_episode_number: 4, season_number: 3 },
        { id: 2, title: 'Empty', episode_count: 0, first_episode_number: null, season_number: null },
      ]);
    } finally {
      db.close();
    }
  });
  it('saves only direct prequel/sequel relationships from AniList', () => {
    const media = {
      id: 100,
      title: { english: 'Example' },
      coverImage: {},
      relations: {
        edges: [
          { relationType: 'SEQUEL', node: { id: 200, format: 'TV' } },
          { relationType: 'ADAPTATION', node: { id: 300, format: 'MANGA' } },
        ],
      },
    };
    expect(JSON.parse(formatAnilistData(media).series_relations)).toEqual([{ id: 200, type: 'SEQUEL' }]);
  });
});
