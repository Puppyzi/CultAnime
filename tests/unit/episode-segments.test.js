import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initSegmentTables } from '../../lib/segment-schema';
import { getEpisodeSegments, saveEpisodeSegments } from '../../lib/episode-segments';
import { getEpisodeSegmentData } from '../../lib/jellyfin';

vi.mock('../../lib/db', () => ({ getDb: vi.fn() }));
vi.mock('../../lib/jellyfin', () => ({ getEpisodeSegmentData: vi.fn() }));

let db;
const detected = () => ({
  available: true,
  media: { Id: 'source', Path: '/media/episode.mkv', Size: 1000, RunTimeTicks: 1440 * 10_000_000 },
  items: [{ Type: 'Intro', StartTicks: 600 * 10_000_000, EndTicks: 690 * 10_000_000 }],
});

beforeEach(() => {
  vi.resetAllMocks();
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE episodes (id INTEGER PRIMARY KEY, file_path TEXT, jellyfin_item_id TEXT, duration REAL, runtime_ticks INTEGER);
    INSERT INTO episodes VALUES (1, '/nonexistent/episode.mkv', 'jellyfin-item', 1440, NULL);`);
  initSegmentTables(db);
  getEpisodeSegmentData.mockResolvedValue(detected());
});
afterEach(() => db.close());

describe('episode segments storage and detection', () => {
  it('caches detection, deduplicates requests, and keeps overrides across refreshes', async () => {
    const [first, second] = await Promise.all([getEpisodeSegments(1, { db }), getEpisodeSegments(1, { db })]);
    expect(second).toEqual(first);
    expect(getEpisodeSegmentData).toHaveBeenCalledTimes(1);
    const saved = await saveEpisodeSegments(
      1,
      { mediaKey: first.mediaKey, intro: { mode: 'disabled' }, outro: { mode: 'absent' } },
      { db }
    );
    expect(saved.segments).toEqual([]);
    const refreshed = await getEpisodeSegments(1, { db, refresh: true });
    expect(refreshed.types.intro.mode).toBe('disabled');
    expect(refreshed.types.outro.mode).toBe('absent');
    expect(refreshed.segments).toEqual([]);
  });

  it('clears an override when automatic detection is explicitly restored', async () => {
    const first = await getEpisodeSegments(1, { db });
    await saveEpisodeSegments(
      1,
      {
        mediaKey: first.mediaKey,
        intro: { mode: 'custom', segments: [{ start: 30, end: 100 }] },
        outro: { mode: 'auto' },
      },
      { db }
    );
    const restored = await saveEpisodeSegments(
      1,
      { mediaKey: first.mediaKey, intro: { mode: 'auto' }, outro: { mode: 'auto' } },
      { db }
    );
    expect(restored.segments).toEqual(first.segments);
    expect(db.prepare('SELECT * FROM episode_skip_overrides').all()).toEqual([]);
  });

  it('detects replacement files and rejects an editor saving against the old version', async () => {
    const first = await getEpisodeSegments(1, { db });
    const settings = { mediaKey: first.mediaKey, intro: { mode: 'disabled' }, outro: { mode: 'auto' } };
    await saveEpisodeSegments(1, settings, { db });
    const replacement = detected();
    replacement.media.Size = 2000;
    getEpisodeSegmentData.mockResolvedValue(replacement);
    const changed = await getEpisodeSegments(1, { db, refresh: true });
    expect(changed.mediaKey).not.toBe(first.mediaKey);
    expect(changed.types.intro.stale).toBe(true);
    expect(changed.segments).toEqual([]);
    await expect(saveEpisodeSegments(1, settings, { db })).rejects.toMatchObject({ status: 409 });
  });

  it('distinguishes missing detection from explicit absence and upstream failure', async () => {
    getEpisodeSegmentData.mockResolvedValue({ ...detected(), items: [] });
    expect((await getEpisodeSegments(1, { db })).detectionStatus).toBe('unknown');
    getEpisodeSegmentData.mockResolvedValue({ media: null, available: false, items: [] });
    const unavailable = await getEpisodeSegments(1, { db, refresh: true });
    expect(unavailable.detectionStatus).toBe('unavailable');
    expect(unavailable.segments).toEqual([]);
  });

  it('still supports manual times if the segment provider is unavailable', async () => {
    getEpisodeSegmentData.mockResolvedValue({ ...detected(), available: false, items: [] });
    const first = await getEpisodeSegments(1, { db });
    const result = await saveEpisodeSegments(
      1,
      {
        mediaKey: first.mediaKey,
        intro: { mode: 'custom', segments: [{ start: 0, end: 80 }] },
        outro: { mode: 'auto' },
      },
      { db }
    );
    expect(result.segments).toEqual([{ type: 'intro', start: 0, end: 80, source: 'manual' }]);
  });

  it('rejects overlapping intro and credits without changing existing settings', async () => {
    const first = await getEpisodeSegments(1, { db });
    await expect(
      saveEpisodeSegments(
        1,
        {
          mediaKey: first.mediaKey,
          intro: { mode: 'custom', segments: [{ start: 600, end: 690 }] },
          outro: { mode: 'custom', segments: [{ start: 650, end: 750 }] },
        },
        { db }
      )
    ).rejects.toThrow('overlap');
    expect(db.prepare('SELECT * FROM episode_skip_overrides').all()).toEqual([]);
  });

  it('deletes cached data and overrides with the episode', async () => {
    const first = await getEpisodeSegments(1, { db });
    await saveEpisodeSegments(
      1,
      { mediaKey: first.mediaKey, intro: { mode: 'absent' }, outro: { mode: 'auto' } },
      { db }
    );
    db.prepare('DELETE FROM episodes WHERE id = 1').run();
    expect(db.prepare('SELECT * FROM episode_skip_cache').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM episode_skip_overrides').all()).toEqual([]);
    expect(await getEpisodeSegments(1, { db })).toBeNull();
  });
});
