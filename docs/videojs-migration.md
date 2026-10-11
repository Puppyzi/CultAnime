# Video.js migration review — updated October 7, 2026

The watch page now uses **Video.js 10.0.1** (`@videojs/react`), pinned to
the exact stable release. Updated from 10.0.0-rc.4 on October 7, 2026;
`npm view @videojs/react version dist-tags` confirmed 10.0.1 as `latest`.
Source: https://videojs.org/changelog/10.0.1.

The intervening rc.5 API changes were reviewed. Our player does not call the
renamed store actions or use the renamed Minimal skin. Hotkey and gesture
action names are unchanged, and the native `Video` component still exposes
the media element through `ref`, so no player code changes were needed.
The existing hls.js streaming and Jellyfin track handling remain in place.
Migration reference: https://videojs.org/changelog/10.0.0-rc.5.

The work is left uncommitted for review and local testing.

## Changes

- `components/VideoJsPlayer.js`: new Video.js player, built with its React
  components and an editable CultAnime layout. Provides play/pause, seek bar and
  time preview, 10-second skips, volume/mute, fullscreen, picture in picture,
  supported Safari AirPlay controls, touch gestures, and keyboard shortcuts.
- `components/VideoJsPlayer.module.css`: scoped styling with the site's accent,
  responsive controls, focus states, buffering indicator, and a scrollable
  settings panel. Settings stay open while controls would otherwise become idle.
- `app/watch/[animeId]/[ep]/page.js`: replaces native browser controls with the
  new component. Audio, subtitle, speed, and autoplay settings move inside the
  player and remain accessible in container fullscreen. Help also renders inside
  the fullscreen container. Download, MPV, watchlist, and episode navigation
  actions remain available on the watch page.
- The video and its container remain mounted during source changes and errors.
  Track changes and retries can therefore retain fullscreen and the same media
  element. The recovery watchdog now recognizes interactions with custom
  controls and page keyboard shortcuts, so deliberate pauses are respected.
- Soft subtitles can be turned off and back on without removing their tracks
  or rebuilding the stream. Playback speed no longer resets to 1× on every
  metadata load during audio/subtitle switches.
- `app/globals.css`: removes the obsolete external media dropdown styles.
- `package.json` / `package-lock.json`: adds the pinned Video.js React package
  and its dependencies. The hls.js dependency remains.
- `tests/e2e/player.spec.js` and `tests/fixtures/player/`: repeatable browser
  playback tests with local HLS media and mocked Jellyfin API responses.
  Fixture attribution is in the fixture README. Test media is not served by
  the production application.

## Playback architecture

Video.js 10 deliberately separates its UI/state components from the media
renderer. CultAnime uses its `VideoPlayer`, `Container`, `Video`, and control
components. The watch page retains ownership of one hls.js instance per stream,
including native-HLS/direct fallback, stream negotiation, retries, diagnostics,
Jellyfin keepalive/stop requests, history saves, and track preferences.

The Jellyfin track menus use the server's full track list. They do not rely on
the HLS manifest containing every audio/subtitle track. Selecting audio or
ASS/SSA subtitles still negotiates the appropriate Jellyfin stream; soft
subtitles use native WebVTT tracks. This avoids two playback engines or two
competing track-selection systems managing the same media element.

No MKV conversion, server configuration change, or media-library migration is
required. Styled ASS/SSA subtitles still use the existing server burn-in path.
This change does not add new quality encodes, thumbnail storyboards, chapter
metadata, or Chromecast support. Quality adaptation remains limited to the
renditions Jellyfin actually supplies.

## Verification

Re-run successfully on October 7, 2026 with Video.js 10.0.1. Added
`tests/e2e/package.json` with `type: module` so Playwright loads the ES module
fixture helper correctly. Background media watching, library reconciliation,
metadata refresh, and local media pruning were disabled for the browser run.

- `npm run lint`
- `npm run test` — 11 unit tests
- `npm run build`
- `npx playwright test --workers=2` — 6 player tests and 3 existing app smoke tests

The player tests exercise real local HLS decoding in Chromium, saved-position
and volume restore, deliberate pauses beyond the watchdog timeout, keyboard
playback, soft subtitle off/on changes without stream reload, audio and styled
subtitle negotiation while fullscreen, speed/position retention, failed-request
retry, injected media-error recovery, session cleanup on navigation, mobile
layout, and autoplay preference/navigation. Desktop and mobile screenshots are
written under the ignored `test-results/` directory.

The tests use mocked API responses: they verify that burn-in and audio-switch
requests are correct, not that a live Jellyfin server rendered/transcoded those
tracks correctly. Real Jellyfin playback, long-running sessions, Safari/iOS,
AirPlay, and picture-in-picture behavior on physical devices require manual
testing. Live Jellyfin playback was not exercised during this upgrade.

## Local sanity test

Use your normal `.env.local` and populated CultAnime library, run `npm install`
if needed, then `npm run dev` and open an episode at http://localhost:3000.

1. Play, pause for at least a minute, resume, seek, mute, adjust volume, and
   change speed. Confirm playback does not restart while deliberately paused.
2. Switch between Japanese and English audio. Check position, selected audio,
   speed, and fullscreen are retained after the stream reconnects.
3. Try a soft subtitle, Off, then another soft subtitle. Next try an ASS/SSA
   track and return to soft subtitles/Off. Check both visible text and styling.
4. Reload the page to check history and audio/subtitle/volume preferences.
   Test next/previous episodes and autoplay both enabled and disabled.
5. Test Space/K, arrows, M, F, and `?`. Open settings while fullscreen and leave
   them open for a few seconds. Check mobile settings scroll and touch seeking.
6. Briefly interrupt the connection, restore it, and check recovery/Retry.
   Navigate away and verify Jellyfin ends the playback session.
7. Check Safari/iPhone and your usual desktop browser. On iPhone, native
   fullscreen can use Apple's own controls rather than the custom overlay;
   inline playback keeps the CultAnime controls. Check PiP and AirPlay where
   supported and reachable.

Inspect the tracked diff with `git diff`; the new component, CSS module,
report, and tests also appear as untracked files in `git status` until you
choose to stage them. No commit or deployment is part of this migration.
