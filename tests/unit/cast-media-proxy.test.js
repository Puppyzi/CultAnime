import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, OPTIONS } from '../../app/api/jellyfin/[...path]/route';
import { getProxiedJellyfinUrl } from '../../lib/jellyfin';

describe('signed media access for Cast receivers', () => {
  beforeEach(() => {
    vi.stubEnv('JELLYFIN_URL', 'https://jellyfin.example.test');
    vi.stubEnv('JELLYFIN_API_KEY', 'test-key-only');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('serves a signed playlist with CORS and signed segment URLs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('#EXTM3U\nsegment.ts\n', {
        headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const url = getProxiedJellyfinUrl('https://jellyfin.example.test/videos/test/master.m3u8');
    const response = await GET(new NextRequest(`https://anime.example.test${url}`), {
      params: Promise.resolve({ path: ['videos', 'test', 'master.m3u8'] }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const playlist = await response.text();
    expect(playlist).toContain('/api/jellyfin/videos/test/segment.ts?');
    expect(playlist).toContain('cultanimeProxySig=');
    expect(playlist).not.toContain('test-key-only');
  });

  it('still rejects unsigned receiver requests without fetching upstream', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(
      new NextRequest('https://anime.example.test/api/jellyfin/videos/test/segment.ts'),
      {
        params: Promise.resolve({ path: ['videos', 'test', 'segment.ts'] }),
      }
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows receiver range-request preflights without credentials', () => {
    const response = OPTIONS();
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-headers')).toContain('Range');
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
  });
});
