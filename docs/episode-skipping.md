# Episode intro and credits skipping

CultAnime shows **Skip Intro** and **Skip Credits** during the first eight playback seconds of each validated interval for the current episode (or until the interval ends, if shorter). The button fills from left to right, then disappears for the rest of that interval. Pausing freezes the fill; rewinding into the eight-second window restores the button at the corresponding fill position. Clicking seeks to the end of the full interval. There is no automatic skip, assumed 90-second opening, or implicit next-episode action. A credits segment that ends before a post-credit scene preserves that scene.

## Enable automatic timestamps

CultAnime reads Jellyfin's native `/MediaSegments/{itemId}` endpoint. Jellyfin 10.10+ supports this API, but a segment provider must populate it. Installing the CultAnime changes alone does not analyze videos.

1. In Jellyfin Dashboard → Plugins → Repositories, add the official Intro Skipper repository: `https://intro-skipper.org/manifest.json`.
2. Install an Intro Skipper release compatible with **your Jellyfin version**, then restart Jellyfin when no one is watching. The server inspected during implementation ran Jellyfin **10.11.11**; the provider's **1.10.11.24** release targets that version. Do not install a Jellyfin 12 build on it.
3. Check the provider's FFmpeg requirements. The 10.11 provider requires Jellyfin FFmpeg with Chromaprint support. Standard Jellyfin container images include it.
4. Start with a small selection of episodes. Configure and run Intro Skipper's detection tasks, and confirm results are exposed as Jellyfin media segments. Existing, correctly named chapters can also be used with Jellyfin's Chapter Segments Provider.
5. Check the provider's intro search window for shows with delayed openings. A scan restricted to the beginning of a video cannot find a later intro. Review episodes where the theme plays over dialogue; audio matching alone cannot decide whether a scene is safe to skip.
6. Open an episode in CultAnime. The button appears during its detected interval. After changing detections, reopen the episode; automatic results are cached for up to 60 seconds. Admin **Refresh detected times** bypasses that cache.

References: [Jellyfin media segments](https://jellyfin.org/docs/general/server/metadata/media-segments/), [Intro Skipper 10.11 requirements](https://github.com/intro-skipper/intro-skipper/tree/10.11), [provider releases](https://github.com/intro-skipper/intro-skipper/releases).

### Verified server setup (2026-10-13)

Intro Skipper **1.10.11.24** was installed on the configured Jellyfin **10.11.11** server and activated with a restart. Its FFmpeg **7.1.4-Jellyfin** check passed, including Chromaprint support. Intro and credits detection are enabled; recap, preview, and commercial detection are disabled. The intro search covers the first **50%** of an episode, capped at **20 minutes**, with one season analyzed at a time. Later openings can still require chapter markers or a manual correction. The provider's automatic detection and default daily scan remain enabled.

A six-episode pilot on **Takopi's Original Sin** produced different opening boundaries for each episode and no credits segment for episode 6. All six results were verified through CultAnime's API. A real Chromium playback check on episode 5 sought from inside the opening to **135.635 seconds**, preserved a user pause, and resumed normally. A credits-skip check on **Akiba Maid War**, episode 1, stopped at **1340.972 seconds**, leaving approximately **79 seconds** available in the same episode. These checks verify the integration; they do not establish that every automatically detected scene is safe to skip.

The subsequent library scan completed successfully in approximately 8.5 minutes with no reported warnings. An API audit of **252 media items** (including the Konosuba movie) found **229 with intros**, **229 with credits**, and **6 with neither**. None of the returned intervals overlapped or exceeded their media runtime. Missing detections remain unknown; they do not prove the episode lacks an opening or ending.

## Correct unusual episodes

Go to **Admin → Episodes → choose a series → Edit → Intro and credits**. Intro and credits each have their own setting:

- **Use detected times:** use Jellyfin's intervals; no data means no button.
- **Set custom times:** enter one or more start/end pairs in seconds from the beginning of the episode. Decimals are supported. Times must fit the episode runtime and must not overlap.
- **No intro/credits in this episode:** record confirmed absence, which later automatic detections cannot override.
- **Do not offer skipping:** suppress the button, for example when the theme accompanies story content.

Save skip settings separately from episode metadata. Reopen a playing episode to fetch the saved settings. Selecting **Use detected times** and saving removes the corresponding manual override.

An unsuccessful scan remains **unknown**, not confirmed absence. Overrides are retained in CultAnime's SQLite database independently of Jellyfin scans and metadata refreshes. They are scoped to the episode's media identity. A changed identity hides corrected/suppressed segments until an admin reviews and saves the settings again. Identity uses the local path/runtime and file size/modification time when accessible, plus Jellyfin's source ID, path, size, and runtime. It is not a full content hash; replacing an inaccessible remote file with identical reported metadata may require manual review.

## Playback and failure behavior

- Segment requests have a short timeout and are separate from stream startup. Unavailable providers or empty/invalid data leave ordinary playback working.
- The player uses its active timeline and seek action, including a connected Google Cast receiver. Seeking preserves pause state.
- A button also appears when resuming or seeking into an interval's first eight seconds. Seeking further into the interval does not restart the prompt. Old requests are canceled when changing episodes.
- Overlapping or out-of-range detections are hidden instead of guessing which endpoint to use.
- Controls support keyboard activation and touch targets at least 44px tall. Custom HTML overlays appear in inline playback and browser fullscreen; operating-system native video fullscreen and picture-in-picture may not display them.
- When Jellyfin cannot identify the media file, skip editing is unavailable until that connection is restored. Manual times work without an installed detector once the media itself can be identified.

## Validation

Automated coverage includes boundary validation, empty and failed detection, delayed openings, durable overrides, file replacement conflicts, admin authentication, touch activation, keyboard activation, paused seeking, post-credit scenes, episode transitions, late responses, and Google Cast seeking. Browser playback uses synthetic segments so tests do not need to scan the real library. The admin UI browser test logs in through `/api/admin/auth` using the development server's configured `ADMIN_PASSWORD`; it mocks all episode writes. CI provides a test-only password and installs both Chromium and WebKit.

Install test browsers with `npx playwright install chromium webkit`. `npm run test:e2e` includes the mobile skip test in WebKit with an iPhone viewport and touch input, alongside the Chromium suite. Run that check alone with `npm run test:e2e -- --project mobile-webkit`.

Before enabling detection across the library, check actual files with ordinary, absent, delayed, and story-overlaid themes, plus post-credit scenes. Also check a physical iPhone, including fullscreen. Automated touch emulation does not verify every native Safari behavior.
