import { fileURLToPath } from 'node:url';
import path from 'node:path';

const fixtureDir = fileURLToPath(new URL('../fixtures/player/', import.meta.url));

export async function preparePlayer(
  page,
  { failInitially = false, castSource = false, longSubtitleLabels = false } = {}
) {
  const streams = [];
  const history = [];
  const sessions = [];
  const events = [];
  const errors = [];
  let fail = failInitially;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('cultanime.playerVolume', '0.4');
    localStorage.setItem('cultanime.audioTrack.9001', '0');
    localStorage.setItem('cultanime.subtitleTrack.9001', '2');
  });
  await page.route('**/api/anime/9001', (route) =>
    route.fulfill({
      json: {
        id: 9001,
        title: 'Player test series',
        episodes_total: 2,
        episodes: [1, 2].map((number) => ({
          id: 9100 + number,
          episode_number: number,
          title: `Test episode ${number}`,
          duration: 30,
        })),
      },
    })
  );
  await page.route('**/api/history**', (route) => {
    if (route.request().method() === 'POST') history.push(route.request().postDataJSON());
    return route.fulfill({ json: { history: [{ progress: 7, duration: 30 }] } });
  });
  await page.route('**/api/watchlist', (route) => route.fulfill({ json: { watchlist: [] } }));
  await page.route('**/api/playback-session', (route) => {
    sessions.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/player-events', (route) => {
    events.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/thumbnail/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"/>',
    })
  );
  await page.route('**/api/stream/**', (route) => {
    const url = new URL(route.request().url());
    streams.push(url);
    if (fail) return route.fulfill({ status: 503, json: { error: 'Test connection interrupted' } });
    const burned = url.searchParams.get('subtitleMode') === 'burned';
    return route.fulfill({
      json: {
        hlsUrl: castSource
          ? 'https://media.example.test/player-fixture/playlist.m3u8'
          : '/player-fixture/playlist.m3u8',
        directUrl: null,
        streamSessionId: `session-${streams.length}`,
        deviceId: 'test-device',
        subtitleMode: burned ? 'burned' : url.searchParams.get('subtitleMode') === 'off' ? 'off' : 'soft',
        burnedInSubtitleIndex: burned ? 4 : null,
        audioStreamIndex: Number(url.searchParams.get('audioStreamIndex') || 0),
        audioTracks: [
          { index: 0, title: 'Japanese', language: 'jpn' },
          { index: 1, title: 'English', language: 'eng' },
        ],
        subtitles: [
          {
            index: 2,
            title: 'English full',
            language: 'en',
            codec: 'srt',
            url: '/player-fixture/english.vtt',
          },
          { index: 3, title: 'Spanish', language: 'es', codec: 'srt', url: '/player-fixture/spanish.vtt' },
          {
            index: 4,
            title: 'English styled',
            language: 'en',
            codec: 'ass',
            url: '/player-fixture/styled.vtt',
          },
        ].map((track) => ({
          ...track,
          title: longSubtitleLabels
            ? track.title + ' - Full Subtitles [9volt] - Default - Forced - ASS'
            : track.title,
        })),
      },
    });
  });
  await page.route('**/player-fixture/**', (route) => {
    const filename = new URL(route.request().url()).pathname.split('/').pop();
    if (filename.endsWith('.vtt'))
      return route.fulfill({
        contentType: 'text/vtt',
        body: 'WEBVTT\n\n00:00:00.000 --> 00:00:30.000\nTest subtitles\n',
      });
    return route.fulfill({
      path: path.join(fixtureDir, filename.replace(/\.ts$/, '.mpegts')),
      contentType: filename.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
    });
  });
  return {
    streams,
    history,
    sessions,
    events,
    errors,
    allowPlayback: () => {
      fail = false;
    },
  };
}
