import { expect, test } from '@playwright/test';

test('loads the app shell and navigates to Browse', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/CultAnime/i);
  await page.getByRole('link', { name: 'Browse' }).click();
  await expect(page.getByRole('heading', { name: 'Browse Anime' })).toBeVisible();
  const search = page.getByRole('searchbox', { name: 'Search the full anime library' });
  await expect(search).toBeVisible();
  await search.fill('unlikely-smoke-title');
  await expect(page).toHaveURL(/q=unlikely-smoke-title/);
});

test('reports application readiness', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({ status: 'ok', components: { database: 'available' } });
});

test('protects the admin page', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login/);
});
