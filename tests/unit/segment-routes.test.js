import { beforeEach, expect, it, vi } from 'vitest';
import { GET as publicGet } from '../../app/api/episodes/[episodeId]/segments/route';
import { GET as adminGet, PUT as adminPut } from '../../app/api/admin/episodes/[episodeId]/segments/route';
import { getEpisodeSegments, saveEpisodeSegments } from '../../lib/episode-segments';
import { requireAdmin } from '../../lib/admin-api';

vi.mock('../../lib/episode-segments', () => ({ getEpisodeSegments: vi.fn(), saveEpisodeSegments: vi.fn() }));
vi.mock('../../lib/admin-api', () => ({ requireAdmin: vi.fn() }));
const context = { params: Promise.resolve({ episodeId: '1' }) };
beforeEach(() => vi.resetAllMocks());

it('does not expose source identity or admin settings to viewers', async () => {
  getEpisodeSegments.mockResolvedValue({
    segments: [],
    mediaKey: 'private',
    types: { intro: { mode: 'disabled' } },
  });
  const response = await publicGet({}, context);
  expect(await response.json()).toEqual({ episodeId: 1, segments: [] });
  expect(response.headers.get('Cache-Control')).toBe('no-store');
});

it('fails open for optional skip metadata when the provider fails', async () => {
  getEpisodeSegments.mockRejectedValue(new Error('upstream failed'));
  const response = await publicGet({}, context);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ episodeId: 1, segments: [] });
});

it('rejects invalid episode IDs before requesting metadata', async () => {
  expect((await publicGet({}, { params: Promise.resolve({ episodeId: 'NaN' }) })).status).toBe(400);
  expect(getEpisodeSegments).not.toHaveBeenCalled();
});

it.each([adminGet, adminPut])('requires admin authentication for skip settings', async (handler) => {
  requireAdmin.mockResolvedValue(new Response(null, { status: 401 }));
  expect((await handler({}, context)).status).toBe(401);
  expect(getEpisodeSegments).not.toHaveBeenCalled();
  expect(saveEpisodeSegments).not.toHaveBeenCalled();
});

it('reports stale-file conflicts without claiming the settings were saved', async () => {
  saveEpisodeSegments.mockRejectedValue(Object.assign(new Error('Reload settings'), { status: 409 }));
  const response = await adminPut({ json: async () => ({}) }, context);
  expect(response.status).toBe(409);
});
