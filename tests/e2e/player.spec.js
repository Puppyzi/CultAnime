import { expect, test } from '@playwright/test';
import { preparePlayer } from '../helpers/player-fixture.mjs';

const playerSelector = '[data-cultanime-player="videojs"]';

async function openPlayer(page) {
  await page.goto('/watch/9001/1');
  const video = page.locator(`${playerSelector} video`);
  await expect.poll(() => video.evaluate((element) => element.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeGreaterThanOrEqual(7);
  return video;
}

async function openSettings(page) {
  const settings = page.getByRole('button', { name: 'Player settings', exact: true });
  await page.locator(playerSelector).hover();
  if ((await settings.getAttribute('aria-expanded')) !== 'true') await settings.click();
  await expect(page.getByLabel('Speed', { exact: true })).toBeVisible();
}

test('plays HLS with Video.js, resumes history, and honors a deliberate pause', async ({ page }) => {
  const state = await preparePlayer(page);
  const video = await openPlayer(page);
  await expect(video).not.toHaveAttribute('controls');
  await expect.poll(() => video.evaluate((element) => element.volume)).toBe(0.4);
  await page.locator(playerSelector).hover();
  if (await video.evaluate((element) => element.paused))
    await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => video.evaluate((element) => element.paused)).toBe(false);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(() => video.evaluate((element) => element.paused)).toBe(true);
  const requestCount = state.streams.length;
  // The old watchdog reloaded an unrecognized custom-control pause after 3–8s.
  await page.waitForTimeout(10000);
  expect(state.streams).toHaveLength(requestCount);
  await expect.poll(() => video.evaluate((element) => element.paused)).toBe(true);
  expect(state.events.some((event) => event.event === 'video-paused-by-user')).toBe(true);
  expect(state.history.some((entry) => entry.progress >= 7)).toBe(true);
  expect(state.sessions.length).toBeGreaterThan(0);
  await page.getByRole('heading', { name: 'Test episode 1', exact: true }).click();
  await page.keyboard.press('k');
  await expect.poll(() => video.evaluate((element) => element.paused)).toBe(false);
  expect(state.errors).toEqual([]);
});

test('switches soft subtitles off and on without restarting the stream', async ({ page }, testInfo) => {
  const state = await preparePlayer(page);
  const video = await openPlayer(page);
  await openSettings(page);
  const count = state.streams.length;
  await page.getByLabel('Subtitles', { exact: true }).selectOption('off');
  await expect
    .poll(() =>
      video.evaluate((element) => [...element.textTracks].filter((track) => track.mode === 'showing').length)
    )
    .toBe(0);
  await page.getByLabel('Subtitles', { exact: true }).selectOption('3');
  await expect
    .poll(() =>
      video.evaluate((element) => [...element.textTracks].find((track) => track.mode === 'showing')?.language)
    )
    .toBe('es');
  expect(state.streams).toHaveLength(count);
  expect(await page.evaluate(() => localStorage.getItem('cultanime.subtitleTrack.9001'))).toBe('3');
  await page.screenshot({ path: testInfo.outputPath('desktop-player.png'), fullPage: true });
  expect(state.errors).toEqual([]);
});

test('keeps fullscreen, position and speed through audio and styled-subtitle changes', async ({ page }) => {
  const state = await preparePlayer(page);
  const video = await openPlayer(page);
  await page.locator(playerSelector).hover();
  await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.getAttribute('data-cultanime-player')))
    .toBe('videojs');
  await openSettings(page);
  await page.getByLabel('Speed', { exact: true }).selectOption('1.5');
  await page.getByLabel('Audio', { exact: true }).selectOption('1');
  await expect(page.getByLabel('Audio', { exact: true })).toBeEnabled();
  await expect.poll(() => video.evaluate((element) => element.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeGreaterThanOrEqual(7);
  await expect.poll(() => video.evaluate((element) => element.playbackRate)).toBe(1.5);
  expect(state.streams.at(-1).searchParams.get('audioStreamIndex')).toBe('1');
  await page.getByLabel('Subtitles', { exact: true }).selectOption('4');
  await expect(page.getByLabel('Subtitles', { exact: true })).toBeEnabled();
  await expect.poll(() => video.evaluate((element) => element.readyState)).toBeGreaterThanOrEqual(2);
  expect(state.streams.at(-1).searchParams.get('subtitleMode')).toBe('burned');
  expect(state.streams.at(-1).searchParams.get('subtitleStreamIndex')).toBe('4');
  await expect.poll(() => video.evaluate((element) => element.querySelectorAll('track').length)).toBe(0);
  await page.getByLabel('Subtitles', { exact: true }).selectOption('2');
  await expect(page.getByLabel('Subtitles', { exact: true })).toBeEnabled();
  await expect
    .poll(() =>
      video.evaluate((element) => [...element.textTracks].some((track) => track.mode === 'showing'))
    )
    .toBe(true);
  expect(state.streams.at(-1).searchParams.get('subtitleMode')).toBe('soft');
  expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  expect(state.errors).toEqual([]);
});

test('retries a failed stream and cleans up the session on navigation', async ({ page }) => {
  const state = await preparePlayer(page, { failInitially: true });
  await page.goto('/watch/9001/1');
  await expect(page.locator(playerSelector).getByRole('alert')).toContainText('Test connection interrupted');
  const originalVideo = await page.locator(`${playerSelector} video`).elementHandle();
  state.allowPlayback();
  await page.getByRole('button', { name: 'Retry playback' }).click();
  const video = page.locator(`${playerSelector} video`);
  await expect.poll(() => video.evaluate((element) => element.readyState)).toBeGreaterThanOrEqual(2);
  expect(await originalVideo.evaluate((element) => element === document.querySelector('video'))).toBe(true);
  await page.getByRole('link', { name: 'Browse', exact: true }).click();
  await expect(page).toHaveURL(/\/browse/);
  await expect.poll(() => state.sessions.some((session) => session.action === 'stop')).toBe(true);
  expect(state.errors).toEqual([]);
});

test('mobile settings stay usable and autoplay preference controls episode navigation', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await preparePlayer(page);
  const video = await openPlayer(page);
  await openSettings(page);
  // An open settings panel must survive the controls' two-second idle timer.
  await page.waitForTimeout(2500);
  await expect(page.getByLabel('Speed', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mobile-player.png'), fullPage: true });
  await page.getByRole('checkbox', { name: 'Autoplay next episode' }).uncheck();
  await video.evaluate((element) => element.dispatchEvent(new Event('ended')));
  await expect(page).toHaveURL(/\/watch\/9001\/1$/);
  await page.getByRole('checkbox', { name: 'Autoplay next episode' }).check();
  await video.evaluate((element) => element.dispatchEvent(new Event('ended')));
  await expect(page).toHaveURL(/\/watch\/9001\/2$/);
  await expect(page.getByRole('heading', { name: 'Test episode 2', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.errors).toEqual([]);
});

test('recovers a media error at the saved position without replacing the player', async ({ page }) => {
  const state = await preparePlayer(page);
  const video = await openPlayer(page);
  const count = state.streams.length;
  const originalVideo = await video.elementHandle();
  await video.evaluate((element) => element.dispatchEvent(new Event('error')));
  await expect.poll(() => state.streams.length).toBeGreaterThan(count);
  await expect.poll(() => video.evaluate((element) => element.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeGreaterThanOrEqual(7);
  expect(await originalVideo.evaluate((element) => element === document.querySelector('video'))).toBe(true);
  expect(state.sessions.some((session) => session.action === 'stop')).toBe(true);
  expect(state.errors).toEqual([]);
});
