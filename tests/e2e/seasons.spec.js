import { expect, test } from '@playwright/test';

const season = (number, title = number === 1 ? 'Example' : 'Example Season ' + number) => ({
  id: 9000 + number,
  title,
  season_label: 'Season ' + number,
  description: 'Description for season ' + number,
  cover_image: '/season-' + number + '.png',
  banner_image: '/banner-' + number + '.png',
  episode_count: number === 1 ? 2 : 1,
  episodes_total: number === 1 ? 2 : 1,
  genres: ['Adventure'],
  studios: [],
  status: 'FINISHED',
  format: 'TV',
  year: 2020 + number,
  episodes: Array.from({ length: number === 1 ? 2 : 1 }, (_, i) => ({
    id: number * 100 + i,
    episode_number: i + 4,
    title: 'Season ' + number + ' episode ' + (i + 4),
  })),
});

async function fixture(page, seasons = [season(1), season(3)]) {
  const requests = [];
  const watchlist = [];
  await page.route('**/api/anime/900*', (route) => {
    requests.push(route.request().url());
    const id = Number(new URL(route.request().url()).pathname.split('/').pop());
    return route.fulfill({ json: { ...(seasons.find((item) => item.id === id) || seasons[0]), seasons } });
  });
  await page.route('**/api/watchlist', (route) => {
    if (route.request().method() === 'POST') watchlist.push(route.request().postDataJSON());
    return route.fulfill({ json: { watchlist: [] } });
  });
  await page.route('**/api/history', (route) => route.fulfill({ json: { history: [] } }));
  await page.route('**/api/thumbnail/**', (route) => route.fulfill({ status: 204 }));
  await page.route('**/api/download-series/*?metadata=1', (route) => {
    const animeId = Number(new URL(route.request().url()).pathname.split('/').pop());
    return route.fulfill({
      json: { animeId, totalSizeBytes: 1024, episodeCount: 1, filename: 'season.zip' },
    });
  });
  return { requests, watchlist };
}

test('switches all season content instantly, preserving selection on refresh and back', async ({ page }) => {
  const { requests, watchlist } = await fixture(page);
  await page.goto('/anime/9001');
  await expect(page.getByRole('heading', { name: 'Example', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Select season: Season 1', exact: true }).click();
  await expect(page.getByRole('menuitemradio')).toHaveCount(2);
  await expect(page.getByRole('menuitemradio', { name: 'Season 1 2 Episodes' })).toBeVisible();
  await expect(page.getByRole('menuitemradio', { name: /Season 2/ })).toHaveCount(0);
  const before = requests.length;
  await page.getByRole('menuitemradio', { name: 'Season 3 1 Episode' }).click();
  await expect(page.getByRole('heading', { name: 'Example Season 3', exact: true })).toBeVisible();
  await expect(page.locator('.anime-detail-description')).toHaveText('Description for season 3');
  await expect(page.locator('.anime-detail-cover')).toHaveAttribute('src', '/season-3.png');
  await expect(page.locator('.anime-detail-banner-bg')).toHaveAttribute('style', /banner-3/);
  await expect(page.getByRole('heading', { name: 'Episodes (1)' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start Watching' })).toHaveAttribute('href', '/watch/9003/4');
  await expect(page.locator('.episode-item')).toHaveAttribute('href', '/watch/9003/4');
  expect(requests).toHaveLength(before);
  await page.getByRole('button', { name: '+ Add to Watchlist', exact: true }).click();
  await expect(page.getByRole('button', { name: '✓ In Watchlist', exact: true })).toBeVisible();
  expect(watchlist).toEqual([{ anime_id: 9003, action: 'add' }]);
  await page.getByRole('button', { name: 'Download All', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download ZIP' })).toHaveAttribute(
    'href',
    '/api/download-series/9003'
  );
  await expect(page).toHaveURL(/season=9003/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Example Season 3', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Example', exact: true })).toBeVisible();
});

test('supports named seasons and keyboard selection on mobile without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const seasons = [
    season(1, 'Bakemonogatari'),
    season(2, 'Nisemonogatari'),
    season(3, 'Monogatari Series Second Season'),
  ].map((item) => ({ ...item, season_label: item.title }));
  await fixture(page, seasons);
  await page.goto('/anime/9001');
  const trigger = page.getByRole('button', { name: 'Select season: Bakemonogatari', exact: true });
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio').first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitemradio').last()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Monogatari Series Second Season', exact: true })
  ).toBeVisible();
  const selectedTrigger = page.getByRole('button', {
    name: 'Select season: Monogatari Series Second Season',
    exact: true,
  });
  await expect(selectedTrigger).toBeFocused();
  await selectedTrigger.click();
  const box = await page.getByRole('menu', { name: 'Available seasons' }).boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(selectedTrigger).toBeFocused();
});

test('shows only season 3 and supports existing season URLs', async ({ page }) => {
  await fixture(page, [season(3)]);
  await page.goto('/anime/9003');
  await page.getByRole('button', { name: 'Select season: Season 3', exact: true }).click();
  await expect(page.getByRole('menuitemradio')).toHaveCount(1);
  await expect(page.getByRole('menuitemradio')).toHaveText('Season 31 Episode');
});

test.describe('touch season selection', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  for (const losesFocus of [false, true]) {
    test(`selects a season by tapping${losesFocus ? ' when touch clears focus' : ''}`, async ({ page }) => {
      await fixture(page);
      await page.goto('/anime/9001');
      await page.getByRole('button', { name: 'Select season: Season 1', exact: true }).tap();
      await expect(page.getByRole('menuitemradio').first()).toBeFocused();

      if (losesFocus) {
        // Reproduce browsers that blur the focused option without focusing the tapped button.
        await page.getByRole('menu').evaluate((menu) => {
          menu.addEventListener('pointerdown', () => document.activeElement.blur(), { once: true });
        });
      }

      await page.getByRole('menuitemradio', { name: 'Season 3 1 Episode' }).tap();
      await expect(page.getByRole('heading', { name: 'Example Season 3', exact: true })).toBeVisible();
      await expect(page).toHaveURL(/season=9003/);
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(page.locator('.episode-item')).toHaveAttribute('href', '/watch/9003/4');

      const trigger = page.getByRole('button', { name: 'Select season: Season 3', exact: true });
      await trigger.tap();
      await page.getByRole('heading', { name: 'Example Season 3', exact: true }).tap();
      await expect(page.getByRole('menu')).toHaveCount(0);
      await trigger.tap();
      await page.getByRole('menuitemradio', { name: 'Season 1 2 Episodes' }).tap();
      await expect(page.getByRole('heading', { name: 'Example', exact: true })).toBeVisible();
    });
  }
});

test('homepage requests grouped cards and uses current artwork with an earliest-season link', async ({
  page,
}) => {
  await fixture(page);
  await page.route('**/api/anime?*', (route) => {
    expect(new URL(route.request().url()).searchParams.get('group')).toBe('series');
    return route.fulfill({
      json: {
        anime: [
          {
            ...season(3),
            id: 9001,
            title: 'Example',
            first_episode_number: 4,
            season_ids: [9001, 9003],
            season_count: 2,
          },
        ],
        total: 1,
      },
    });
  });
  await page.goto('/');
  const card = page.locator('.home-anime-grid .anime-card');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.anime-card-image')).toHaveAttribute('src', /season-3/);
  await expect(card.locator('.anime-card-image-link')).toHaveAttribute('href', '/anime/9001');
  await expect(card.getByRole('link', { name: 'Watch', exact: true })).toHaveAttribute(
    'href',
    '/watch/9001/4'
  );
  await card.locator('.anime-card-link').click();
  await expect(page).toHaveURL(/\/anime\/9001$/);
  await expect(page.getByRole('heading', { name: 'Example', exact: true })).toBeVisible();
  await expect(page.locator('.anime-detail-cover')).toHaveAttribute('src', '/season-1.png');
});
