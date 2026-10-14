import { expect, test } from '@playwright/test';
import { preparePlayer } from '../helpers/player-fixture.mjs';
import { prepareCast } from '../helpers/cast-fixture.mjs';

test('Cast uses the HTTP source, receiver progress and safe track controls', async ({ page }) => {
  await prepareCast(page);
  const state = await preparePlayer(page, { castSource: true });
  await page.goto('/watch/9001/1');
  const video = page.locator('video');
  await expect.poll(() => video.evaluate((el) => el.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => video.evaluate((el) => el.currentTime)).toBeGreaterThanOrEqual(7);
  await page.locator('[data-cultanime-player]').hover();
  // A fresh CI browser may block unmuted autoplay until a user gesture.
  if (await video.evaluate((el) => el.paused)) {
    await page.getByRole('button', { name: 'Play', exact: true }).click();
  }
  await expect.poll(() => video.evaluate((el) => el.paused)).toBe(false);
  const start = page.getByRole('button', { name: 'Start casting', exact: true });
  await expect(start).toHaveAttribute('title', 'Start casting');
  await start.click();
  await expect(page.getByRole('button', { name: 'Stop casting' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.castTest.loads.length)).toBe(1);
  const request = await page.evaluate(() => window.castTest.loads[0]);
  expect(request.media.contentId).toBe('https://media.example.test/player-fixture/playlist.m3u8');
  expect(request.currentTime).toBeGreaterThanOrEqual(7);
  expect(request.media.tracks.length).toBeGreaterThan(0);
  await page.evaluate(() => window.castTest.advance(22));
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(() => state.history.some((entry) => entry.progress === 22)).toBe(true);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Audio', exact: true })).toBeDisabled();
  await expect(page.getByText('Stop casting to change audio or subtitles.')).toBeVisible();
  await page.keyboard.press('Escape');
  // Longer than the unexpected native-pause recovery timer.
  await page.waitForTimeout(3500);
  expect(state.streams).toHaveLength(1);
  await page.locator('[data-cultanime-player]').hover();
  await page.getByRole('button', { name: 'Stop casting' }).click();
  await expect(page.getByRole('button', { name: 'Start casting' })).toBeVisible();
  await expect.poll(() => video.evaluate((el) => el.currentTime)).toBe(22);
  expect(await video.evaluate((el) => el.paused)).toBe(true);
  await page.getByRole('button', { name: 'Start casting' }).click();
  await expect.poll(() => page.evaluate(() => window.castTest.loads.length)).toBe(2);
  await page.getByRole('button', { name: 'Next episode', exact: true }).click();
  await expect(page).toHaveURL(/\/watch\/9001\/2$/);
  await expect.poll(() => page.evaluate(() => window.castTest.connected)).toBe(false);
  expect(state.errors).toEqual([]);
});

test('Cast cannot send a localhost stream to the TV', async ({ page }) => {
  await prepareCast(page);
  await preparePlayer(page);
  await page.goto('/watch/9001/1');
  await page.locator('[data-cultanime-player]').hover();
  const start = page.getByRole('button', { name: 'Start casting', exact: true });
  await expect(start).toBeDisabled();
  await expect(start).toHaveAttribute('title', 'Start casting');
  expect(await page.evaluate(() => window.castTest.loads)).toEqual([]);
});
