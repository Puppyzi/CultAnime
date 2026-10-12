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
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  await page.locator(playerSelector).hover();
  if ((await settings.getAttribute('aria-expanded')) !== 'true') await settings.click();
  await expect(page.getByRole('menuitem', { name: 'Speed', exact: true })).toBeVisible();
}

async function chooseSetting(page, label, option) {
  await openSettings(page);
  await page.getByRole('menuitem', { name: label, exact: true }).click();
  await page.getByRole('menuitemradio', { name: option, exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Speed', exact: true })).toBeVisible();
  await openSettings(page);
}

test('settings use compact submenus, checked choices and keyboard back navigation', async ({
  page,
}, testInfo) => {
  const state = await preparePlayer(page);
  const video = await openPlayer(page);
  await openSettings(page);
  const gear = page.getByRole('button', { name: 'Settings', exact: true });
  await expect(gear).toHaveAttribute('title', 'Settings');
  await expect(gear.locator('svg')).toHaveCSS('rotate', '90deg');
  await expect(page.locator(`${playerSelector} select`)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('settings-root.png') });
  const speed = page.getByRole('menuitem', { name: 'Speed', exact: true });
  await speed.focus();
  const paused = await video.evaluate((element) => element.paused);
  const position = await video.evaluate((element) => element.currentTime);
  await page.keyboard.press('ArrowRight');
  const submenu = page.getByRole('menu', { name: 'Speed', exact: true });
  await expect(submenu).toBeVisible();
  await expect(submenu).toHaveCSS('translate', '0px');
  await expect(page.getByRole('menuitemradio', { name: '1×', exact: true })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  expect(await video.evaluate((element) => element.paused)).toBe(paused);
  expect(await video.evaluate((element) => element.currentTime)).toBeLessThan(position + 3);
  await page.screenshot({ path: testInfo.outputPath('settings-speed.png') });
  await page.keyboard.press('ArrowLeft');
  await expect(speed).toBeFocused();
  await speed.click();
  await page.getByRole('menuitemradio', { name: '1.5×', exact: true }).click();
  await expect(speed).toContainText('1.5×');
  await expect.poll(() => video.evaluate((element) => element.playbackRate)).toBe(1.5);
  await page.keyboard.press('Escape');
  await expect(gear).toHaveAttribute('aria-expanded', 'false');
  await expect(gear).toBeFocused();
  await expect(gear.locator('svg')).toHaveCSS('rotate', 'none');
  await gear.click();
  await page.getByRole('heading', { name: 'Test episode 1', exact: true }).click();
  await expect(gear).toHaveAttribute('aria-expanded', 'false');
  expect(state.errors).toEqual([]);
});

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
  await chooseSetting(page, 'Subtitles', 'Off');
  await expect
    .poll(() =>
      video.evaluate((element) => [...element.textTracks].filter((track) => track.mode === 'showing').length)
    )
    .toBe(0);
  await chooseSetting(page, 'Subtitles', 'Spanish');
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
  await chooseSetting(page, 'Speed', '1.5×');
  await chooseSetting(page, 'Audio', 'English');
  await expect(page.getByRole('menuitem', { name: 'Audio', exact: true })).toBeEnabled();
  await expect.poll(() => video.evaluate((element) => element.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeGreaterThanOrEqual(7);
  await expect.poll(() => video.evaluate((element) => element.playbackRate)).toBe(1.5);
  expect(state.streams.at(-1).searchParams.get('audioStreamIndex')).toBe('1');
  await chooseSetting(page, 'Subtitles', 'English styled');
  await expect(page.getByRole('menuitem', { name: 'Subtitles', exact: true })).toBeEnabled();
  await expect.poll(() => video.evaluate((element) => element.readyState)).toBeGreaterThanOrEqual(2);
  expect(state.streams.at(-1).searchParams.get('subtitleMode')).toBe('burned');
  expect(state.streams.at(-1).searchParams.get('subtitleStreamIndex')).toBe('4');
  await expect.poll(() => video.evaluate((element) => element.querySelectorAll('track').length)).toBe(0);
  await chooseSetting(page, 'Subtitles', 'English full');
  await expect(page.getByRole('menuitem', { name: 'Subtitles', exact: true })).toBeEnabled();
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
  await expect(page.getByRole('menuitem', { name: 'Speed', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mobile-player.png'), fullPage: true });
  await page.getByRole('menuitem', { name: 'Speed', exact: true }).click();
  const speedMenu = page.getByRole('menu', { name: 'Speed', exact: true });
  await expect(speedMenu).toHaveCSS('translate', '0px');
  await page.screenshot({ path: testInfo.outputPath('mobile-speed.png'), fullPage: true });
  await page.getByRole('menuitemradio', { name: '2×', exact: true }).click();
  await expect.poll(() => video.evaluate((element) => element.playbackRate)).toBe(2);
  await page.keyboard.press('Escape');
  await page.getByRole('switch', { name: 'Autoplay next episode' }).click();
  await video.evaluate((element) => element.dispatchEvent(new Event('ended')));
  await expect(page).toHaveURL(/\/watch\/9001\/1$/);
  await page.locator('[data-cultanime-player]').hover();
  await page.getByRole('switch', { name: 'Autoplay next episode' }).click();
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

test('keeps a deliberate pause when changing audio or burned subtitles', async ({ page }) => {
  const state = await preparePlayer(page);
  const video = await openPlayer(page);
  await page.locator(playerSelector).hover();
  if (await video.evaluate((element) => element.paused))
    await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const position = await video.evaluate((element) => element.currentTime);
  await openSettings(page);
  await chooseSetting(page, 'Audio', 'English');
  await expect(page.getByRole('menuitem', { name: 'Audio', exact: true })).toBeEnabled();
  await expect.poll(() => video.evaluate((element) => element.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => video.evaluate((element) => element.paused)).toBe(true);
  await chooseSetting(page, 'Subtitles', 'English styled');
  await expect(page.getByRole('menuitem', { name: 'Subtitles', exact: true })).toBeEnabled();
  await expect.poll(() => video.evaluate((element) => element.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => video.evaluate((element) => element.paused)).toBe(true);
  const count = state.streams.length;
  await page.waitForTimeout(10000);
  expect(state.streams).toHaveLength(count);
  expect(await video.evaluate((element) => element.currentTime)).toBeCloseTo(position, 0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => video.evaluate((element) => element.paused)).toBe(false);
  await openSettings(page);
  await chooseSetting(page, 'Audio', 'Japanese');
  await expect(page.getByRole('menuitem', { name: 'Audio', exact: true })).toBeEnabled();
  await expect.poll(() => video.evaluate((element) => element.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => video.evaluate((element) => element.paused)).toBe(false);
  expect(state.errors).toEqual([]);
});

test('supports seeking, mute, volume and help without triggering playback shortcuts in settings', async ({
  page,
}) => {
  const state = await preparePlayer(page);
  const video = await openPlayer(page);
  await page.getByRole('heading', { name: 'Test episode 1', exact: true }).click();
  await page.keyboard.press('m');
  await expect.poll(() => video.evaluate((element) => element.muted)).toBe(true);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeGreaterThanOrEqual(17);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeLessThan(9);
  await page.locator(playerSelector).hover();
  const volume = page.getByRole('slider', { name: 'Volume', exact: true });
  await volume.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => video.evaluate((element) => element.volume)).toBeGreaterThan(0.4);
  await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
  await openSettings(page);
  await page.getByRole('menuitem', { name: 'Speed', exact: true }).focus();
  const paused = await video.evaluate((element) => element.paused);
  await page.keyboard.press('k');
  expect(await video.evaluate((element) => element.paused)).toBe(paused);
  await page.keyboard.press('Escape');
  await page.locator(playerSelector).focus();
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Player shortcuts' })).toBeVisible();
  expect(
    await page
      .getByRole('dialog', { name: 'Player shortcuts' })
      .evaluate((element) => document.fullscreenElement?.contains(element))
  ).toBe(true);
  await page.keyboard.press('k');
  expect(await video.evaluate((element) => element.paused)).toBe(paused);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Player shortcuts' })).toBeHidden();
  expect(state.errors).toEqual([]);
});

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
]) {
  test(
    'wrapped subtitle options scroll within the settings popup (' + viewport.width + 'px)',
    async ({ page }) => {
      await page.setViewportSize(viewport);
      await preparePlayer(page, { longSubtitleLabels: true });
      await openPlayer(page);
      await openSettings(page);
      await page.getByRole('menuitem', { name: 'Subtitles', exact: true }).click();
      const menu = page.getByRole('menu', { name: 'Subtitles', exact: true });
      // Wait for the submenu entrance and popup sizing before scrolling. Resizing
      // during the transition can clamp scrollTop back toward zero.
      await expect(menu).toHaveCSS('translate', '0px');
      await menu.evaluate(async (element) => {
        await Promise.all(
          element.parentElement.getAnimations({ subtree: true }).map((animation) => animation.finished)
        );
      });
      await expect
        .poll(() =>
          menu.evaluate((element) => {
            const popup = element.parentElement.getBoundingClientRect();
            const bounds = element.getBoundingClientRect();
            return bounds.top >= popup.top && bounds.bottom <= popup.bottom + 1;
          })
        )
        .toBe(true);
      expect(await menu.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
      await menu.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect
        .poll(() =>
          menu.evaluate((element) => {
            const last = element.querySelector('[role=menuitemradio]:last-child').getBoundingClientRect();
            const bounds = element.getBoundingClientRect();
            return element.scrollTop > 0 && last.bottom <= bounds.bottom + 1 && last.top >= bounds.top;
          })
        )
        .toBe(true);
      await menu.getByRole('menuitemradio').last().click();
      await expect(page.getByRole('menuitem', { name: 'Subtitles', exact: true })).toContainText(
        'English styled'
      );
    }
  );
}
