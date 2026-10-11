# Video.js branch investigation — October 11, 2026

## Confirmed build failure

The screenshot's `Can't resolve '@videojs/react'` error came from the local
dependency installation. `npm ls --depth=0` reported
`UNMET DEPENDENCY @videojs/react@10.0.1`, and `node_modules/@videojs/react`
did not exist. Both `package.json` and the committed lockfile already declared
the correct package. Installing the dependencies resolved the import failure;
no dependency version change was needed.

After changing branches, run `npm install` before `npm run dev`. Restart an
already-running dev server if it continues to show the old resolution error.
The README now includes this step.

## Reproduced playback defect

Pause an episode, open player settings, and select another audio track.
Playback restarted without pressing Play. The same source-replacement path
is used for burned subtitle changes. This behavior was present in the inherited
stream setup, and the original migration tests did not cover it.

The video had a native `autoPlay` attribute, and each streaming backend also
called `play()` unconditionally when attaching a source. The fix records whether
playback was paused before a track change, removes native autoplay, and lets
the stream pipeline start playback only when intended. New episodes and explicit
Retry actions still attempt playback; a manual Play updates that intent.
Metadata preload allows native sources to restore their position while paused.

A regression test failed before the fix (`paused` was false after changing
audio) and passes afterward. It checks audio and burned subtitle changes,
position retention, ten seconds beyond the recovery timeout, manual resume,
and another track change while playing.

## Integration review and verification

This branch uses Video.js controls and a native video element with the existing
hls.js/Jellyfin stream pipeline. Keeping hls.js is intentional. The Video.js
[Video reference](https://videojs.org/docs/framework/react/reference/components/video)
documents that the component forwards native events and exposes the underlying
`HTMLVideoElement` through its ref. The imported APIs resolve with 10.0.1, and
the application builds successfully with the installed Next.js version.

- ESLint, 11 unit tests, and the production build pass.
- All 9 Chromium player tests pass with local HLS media and mocked API responses.
- Coverage includes resume/volume, deliberate pause, subtitle off/on, audio and
  burned subtitle changes, speed and fullscreen retention, retry, media-error
  recovery, session cleanup, mobile layout, autoplay navigation, and paused
  track changes. Added checks exercise keyboard seeking, mute, volume, editable
  settings, and shortcut help inside fullscreen.

The settings panel now uses Video.js `Menu` components instead of native select
fields. Audio, subtitle, and speed rows open animated submenus with selected
checkmarks and back navigation. The frosted popup resizes for each page; long
lists scroll within the available player area. The gear uses the `Settings`
label and open/close rotation. Tests cover submenu keyboard navigation, focus
restoration, outside-click dismissal, checked choices, mobile scrolling, and
suppression of playback hotkeys while settings are open.

The browser run used the already-running server at `http://localhost:3000`
through a temporary Playwright config. Requesting that same server through
`127.0.0.1` returned 403 for development assets because it was initialized with
a different hostname. This is Next.js development-origin enforcement, not a
player failure. The repository's normal Playwright configuration starts its
own server on port 3100. Stop the other dev instance before using that default
configuration, since both use the same Next.js development output directory.

These tests do not verify live Jellyfin transcoding, long-running remote
streams, Safari/iOS, or physical AirPlay/PiP devices. The existing manual
checklist in [videojs-migration.md](videojs-migration.md#local-sanity-test)
still applies to those cases.
# Google Cast

The controls use Video.js's official Cast icon, `CastButton`, and the
`@videojs/google-cast` extension (10.0.1). The receiver gets the absolute signed
HTTP playlist URL, never hls.js's browser-only blob URL. The signed Jellyfin
proxy supports CORS and range preflights; URL signature validation remains
required for media requests.

Casting needs a supported Chromium browser and a site/stream address reachable
from the receiver. Use a reachable HTTPS deployment for device testing.
Localhost streams are disabled. The hover tooltip reads "Start casting". Unsupported
browsers hide the button; without a reachable Cast device it is disabled.

Watch history reads receiver state while casting. Local recovery is suspended,
and stopping casting retains the receiver position. The stop button explicitly
ends the SDK session because the 10.0.1 provider's picker/disconnect path can
reload the local source after restoring its position.

Select audio and subtitles before casting; those menus are disabled during a
session. Leaving the episode (including autoplay next) ends casting along with
its Jellyfin session. Cast the next episode again if desired. Keep the sender
tab open for the Jellyfin session keepalive.

Automated coverage uses a simulated Google sender SDK against the real Video.js
extension, plus signed-proxy tests. Physical Chromecast playback, receiver codec
support, network discovery, and production TLS reachability require a real
device test.
