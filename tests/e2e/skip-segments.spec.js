import { expect, test } from '@playwright/test';
import { preparePlayer } from '../helpers/player-fixture.mjs';
import { prepareCast } from '../helpers/cast-fixture.mjs';

const segments = [
  { type: 'intro', start: 6, end: 12 },
  { type: 'outro', start: 18, end: 24 },
];

async function pausedPlayer(page) {
  await page.goto('/watch/9001/1');
  const video = page.locator('video');
  await expect.poll(() => video.evaluate((el) => el.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => video.evaluate((el) => el.currentTime)).toBeGreaterThanOrEqual(7);
  await expect.poll(() => video.evaluate((el) => el.seeking)).toBe(false);
  await page.locator('[data-cultanime-player]').hover();
  // Some browser contexts require a user gesture before unmuted playback.
  if (await video.evaluate((el) => el.paused)) {
    await page.getByRole('button', { name: 'Play', exact: true }).click();
  }
  await expect.poll(() => video.evaluate((el) => el.paused)).toBe(false);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(() => video.evaluate((el) => el.paused)).toBe(true);
  return video;
}

async function expectSettledAt(video, seconds) {
  // currentTime changes before decoding/seeked finishes. Starting another seek
  // at that point can interrupt the first one, especially on Linux WebKit.
  await expect.poll(() => video.evaluate((el) => ({
    time: Math.round(el.currentTime * 10) / 10,
    seeking: el.seeking,
    ready: el.readyState >= 2,
    paused: el.paused,
  }))).toEqual({ time: seconds, seeking: false, ready: true, paused: true });
}

async function seekPausedVideo(video, seconds) {
  await video.evaluate((el, time) => { el.currentTime = time; }, seconds);
  await expectSettledAt(video, seconds);
}

test('skip buttons seek within the episode, preserve pause, and return after seeking backwards', async ({
  page,
}) => {
  const state = await preparePlayer(page, { skipSegments: segments });
  const video = await pausedPlayer(page);
  const intro = page.getByRole('button', { name: 'Skip Intro', exact: true });
  await expect(intro).toBeEnabled();
  await intro.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => video.evaluate((el) => el.currentTime)).toBeCloseTo(12, 0);
  expect(await video.evaluate((el) => el.paused)).toBe(true);
  await expect(intro).toHaveCount(0);
  await video.evaluate((el) => {
    el.currentTime = 8;
  });
  await expect(intro).toBeVisible();
  await video.evaluate((el) => {
    el.currentTime = 19;
  });
  await page.getByRole('button', { name: 'Skip Credits', exact: true }).click();
  await expect.poll(() => video.evaluate((el) => el.currentTime)).toBeCloseTo(24, 0);
  await expect(page).toHaveURL(/\/watch\/9001\/1$/);
  expect(await video.evaluate((el) => el.ended)).toBe(false);
  expect(state.streams).toHaveLength(1);
  expect(state.errors).toEqual([]);
});

test('eight-second prompts fill with playback, expire, and return only inside their original window', async ({ page }) => {
  const state = await preparePlayer(page, {
    skipSegments: [
      { type: 'intro', start: 6, end: 16 },
      { type: 'outro', start: 18, end: 29 },
    ],
  });
  const video = await pausedPlayer(page);
  const intro = page.getByRole('button', { name: 'Skip Intro', exact: true });
  const credits = page.getByRole('button', { name: 'Skip Credits', exact: true });
  await seekPausedVideo(video, 10);
  await expect(intro).toBeVisible();
  await expect.poll(() => intro.evaluate((el) => Number(el.style.getPropertyValue('--skip-progress')))).toBeCloseTo(0.5, 2);
  const fill = intro.locator('[aria-hidden="true"]');
  await expect.poll(() => fill.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a)).toBeCloseTo(0.5, 2);
  await page.locator('[data-cultanime-player]').hover();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  // Rendering cadence varies on CI, especially Linux WebKit. Verify continuous
  // animation and actual forward progress without requiring a minimum FPS.
  await expect.poll(() => fill.evaluate((el) => {
    const animation = el.getAnimations()[0];
    return animation && {
      state: animation.playState,
      duration: animation.effect.getTiming().duration,
      easing: animation.effect.getTiming().easing,
    };
  })).toEqual({ state: 'running', duration: 8000, easing: 'linear' });
  await expect.poll(() => fill.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a))
    .toBeGreaterThan(0.55);
  await expect(intro).toHaveCount(0, { timeout: 8000 });
  const expiredAt = await video.evaluate((el) => el.currentTime);
  expect(expiredAt).toBeGreaterThanOrEqual(14);
  expect(expiredAt).toBeLessThan(16);
  await page.locator('[data-cultanime-player]').hover();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(() => video.evaluate((el) => el.paused)).toBe(true);

  await seekPausedVideo(video, 14);
  await expect(intro).toHaveCount(0);
  await seekPausedVideo(video, 8);
  await expect(intro).toBeEnabled();
  await intro.click();
  await expectSettledAt(video, 16);

  await seekPausedVideo(video, 26);
  await expect(credits).toHaveCount(0);
  await seekPausedVideo(video, 22);
  await expect(credits).toBeEnabled();
  await expect.poll(() => credits.evaluate((el) => Number(el.style.getPropertyValue('--skip-progress')))).toBeCloseTo(0.5, 2);
  await credits.click();
  await expectSettledAt(video, 29);
  expect(state.streams).toHaveLength(1);
  expect(state.events.filter((event) => /media-error|hls-fatal-error|stream-reload/.test(event?.event))).toEqual([]);
  expect(state.errors).toEqual([]);
});

test.describe('mobile skipping', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('supports real touch events with a reachable button', async ({ page }) => {
    await preparePlayer(page, { skipSegments: segments });
    const video = await pausedPlayer(page);
    const button = page.getByRole('button', { name: 'Skip Intro', exact: true });
    const box = await button.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await button.tap();
    await expect.poll(() => video.evaluate((el) => el.currentTime)).toBeCloseTo(12, 0);
    expect(await video.evaluate((el) => el.paused)).toBe(true);
  });
});

test('missing or failed segment data never blocks playback or invents a skip', async ({ page }) => {
  const state = await preparePlayer(page);
  await page.route('**/api/episodes/*/segments', (route) =>
    route.fulfill({ status: 503, json: { error: 'unavailable' } })
  );
  const video = await pausedPlayer(page);
  await expect(page.getByRole('button', { name: /^Skip (Intro|Credits)$/ })).toHaveCount(0);
  expect(await video.evaluate((el) => el.readyState)).toBeGreaterThanOrEqual(2);
  expect(state.errors).toEqual([]);
});

test('waits for a late opening and removes old timestamps on episode navigation', async ({ page }) => {
  await preparePlayer(page, { skipSegments: [{ type: 'intro', start: 15, end: 22 }] });
  const video = await pausedPlayer(page);
  await expect(page.getByRole('button', { name: 'Skip Intro' })).toHaveCount(0);
  await video.evaluate((el) => {
    el.currentTime = 16;
  });
  await expect(page.getByRole('button', { name: 'Skip Intro' })).toBeVisible();
  await page.locator('[data-cultanime-player]').hover();
  await page.getByRole('button', { name: 'Next episode', exact: true }).click();
  await expect(page).toHaveURL(/\/watch\/9001\/2$/);
  await expect(page.getByRole('button', { name: 'Skip Intro' })).toHaveCount(0);
});

test('a response arriving after navigation cannot enable a skip in another episode', async ({ page }) => {
  await preparePlayer(page, { skipSegments: segments });
  let release;
  const delayed = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/episodes/9101/segments', async (route) => {
    await delayed;
    await route.fulfill({ json: { episodeId: 9101, segments } }).catch(() => {});
  });
  await pausedPlayer(page);
  await page.locator('[data-cultanime-player]').hover();
  await page.getByRole('button', { name: 'Next episode', exact: true }).click();
  await expect(page).toHaveURL(/\/watch\/9001\/2$/);
  release();
  await expect(page.getByRole('button', { name: /^Skip (Intro|Credits)$/ })).toHaveCount(0);
});

test('skip follows the Cast receiver timeline', async ({ page }) => {
  await prepareCast(page);
  const state = await preparePlayer(page, { castSource: true, skipSegments: segments });
  await pausedPlayer(page);
  await page.locator('[data-cultanime-player]').hover();
  await page.getByRole('button', { name: 'Start casting', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop casting' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.castTest.loads.length)).toBe(1);
  await page.evaluate(() => window.castTest.advance(19));
  await page.getByRole('button', { name: 'Skip Credits', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.castTest.currentTime)).toBe(24);
  expect(await page.evaluate(() => window.castTest.connected)).toBe(true);
  expect(state.streams).toHaveLength(1);
  expect(state.errors).toEqual([]);
});
