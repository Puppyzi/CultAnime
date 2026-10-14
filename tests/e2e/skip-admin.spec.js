import { expect, test } from '@playwright/test';
import nextEnv from '@next/env';
import { ADMIN_COOKIE_NAME, createAdminSessionToken } from '../../lib/admin-auth';

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });

test('admin can correct, disable, and refresh episode skip settings on mobile', async ({
  page,
  context,
  baseURL,
}) => {
  const token = await createAdminSessionToken();
  test.skip(!token, 'Requires a configured ADMIN_PASSWORD for the local admin page.');
  await context.addCookies([{ name: ADMIN_COOKIE_NAME, value: token, url: baseURL }]);
  await page.setViewportSize({ width: 390, height: 844 });
  const anime = {
    id: 9001,
    title: 'Skip test series',
    episodes: [{ id: 9101, episode_number: 1, file_path: '/test.mkv', duration: 1440 }],
  };
  await page.route('**/api/anime?*', (route) => route.fulfill({ json: { anime: [anime] } }));
  await page.route('**/api/anime/9001', (route) => route.fulfill({ json: anime }));
  await page.route('**/api/admin/rescan', (route) => route.fulfill({ json: {} }));
  let settings = {
    episodeId: 9101,
    mediaKey: 'file',
    duration: 1440,
    detectionStatus: 'unknown',
    detectedSegments: [],
    segments: [],
    types: {
      intro: { mode: 'auto', stale: false, segments: [] },
      outro: { mode: 'auto', stale: false, segments: [] },
    },
  };
  const writes = [];
  await page.route('**/api/admin/episodes/9101/segments', (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      writes.push(body);
      settings = {
        ...settings,
        types: { intro: { ...body.intro, stale: false }, outro: { ...body.outro, stale: false } },
      };
    }
    return route.fulfill({ json: settings });
  });
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Episodes', exact: true }).click();
  await page.getByRole('heading', { name: anime.title, exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('form', { name: 'Episode skip settings' });
  await expect(editor.getByText('No automatic timestamps found.', { exact: false })).toBeVisible();
  await editor.getByLabel('Intro behavior').selectOption('custom');
  await editor.getByLabel('Intro start 1 (seconds)').fill('603.581');
  await editor.getByLabel('Intro end 1 (seconds)').fill('692');
  await editor.getByLabel('Credits behavior').selectOption('disabled');
  await editor.getByRole('button', { name: 'Save skip settings' }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({
    mediaKey: 'file',
    intro: { mode: 'custom', segments: [{ start: 603.581, end: 692 }] },
    outro: { mode: 'disabled' },
  });
  await editor.getByRole('button', { name: 'Refresh detected times' }).click();
  await expect(editor.getByLabel('Intro start 1 (seconds)')).toHaveValue('603.581');
  await expect(editor.getByLabel('Credits behavior')).toHaveValue('disabled');
});
