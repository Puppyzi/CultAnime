# CultAnime

CultAnime is a self-hosted anime streaming UI backed by Jellyfin metadata, local library sync, and Seerr requests.

## Getting Started

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Local Dev vs Server Deployment

CultAnime has two expected modes.

Local development runs on the developer PC. It can talk to Jellyfin over Tailscale, but it usually cannot see the real anime files directly. Keep the watcher disabled in `.env.local`:

```env
MEDIA_WATCHER_ENABLED=false
JELLYFIN_URL=http://YOUR_TAILSCALE_JELLYFIN_IP:8096
JELLYFIN_API_KEY=replace_with_jellyfin_api_key
```

Server deployment runs on the Linux server or Docker host that can access the real anime folder. Copy `.env.production.example` to `.env.production` and fill in the server values:

```env
MEDIA_WATCHER_ENABLED=true
MEDIA_ROOT=/anime
JELLYFIN_MEDIA_ROOT=/media/anime
ANIME_MOVIE_ROOT=/anime_movies
JELLYFIN_ANIME_MOVIE_ROOT=/media/anime_movies
MEDIA_RESCAN_DEBOUNCE_MS=60000
JELLYFIN_RESCAN_SETTLE_MS=10000
PUID=568
PGID=568
```

`MEDIA_ROOT` is the path CultAnime can read inside its runtime. `JELLYFIN_MEDIA_ROOT` is the path Jellyfin sees for that same folder. Anime movies use the same pairing through `ANIME_MOVIE_ROOT` and `JELLYFIN_ANIME_MOVIE_ROOT`; only Jellyfin movie items under `/media/anime_movies` are imported as movie panels, so the normal `/media/movies` library is ignored. After the watcher sees a change, it waits for the folder to be quiet, asks Jellyfin to rescan the affected series or movie folder, then runs the CultAnime sync.

CultAnime also runs a Jellyfin reconciliation loop by default. `LIBRARY_RECONCILE_INTERVAL_MS` controls how often the app compares Jellyfin's current series/episode list with SQLite, and `LIBRARY_RECONCILE_ON_READ_INTERVAL_MS` controls the minimum time between reconciliation checks triggered by anime list requests. The default read interval is `0`, so a page refresh can remove stale anime panels after Jellyfin has dropped a deleted series; raise this value if you prefer faster list responses over immediate cleanup.

Playback uses signed same-origin HLS URLs so private Jellyfin addresses are never exposed to the browser. Direct and Cloudflare-delivered playback both use the higher Jellyfin HLS ceiling by default. Set `JELLYFIN_PUBLIC_VIDEO_BITRATE` and `JELLYFIN_PUBLIC_AUDIO_BITRATE` only when you intentionally want to cap remote Cloudflare playback after measuring the server's upload capacity. The player retries failed fragments, rebuilds a persistently stalled stream, resumes at the previous playback position, and starts from the highest HLS rendition available. Important browser playback events are posted back to the app and logged in the server terminal; set `PLAYER_EVENT_LOGGING_ENABLED=false` to silence those event logs.

When recent episodes are missing overviews, CultAnime can also ask Jellyfin to retry metadata for those episode items during reconciliation. This is enabled by default and is rate-limited per item by `MISSING_EPISODE_METADATA_REFRESH_INTERVAL_MS` (default 15 minutes). `MISSING_EPISODE_METADATA_REFRESH_LOOKBACK_DAYS` controls how far back episodes are considered, and `MISSING_EPISODE_METADATA_REFRESH_BATCH_LIMIT` limits each reconciliation batch.

On the server, `LOCAL_MEDIA_PRUNE_ENABLED=true` lets CultAnime remove episode rows when the underlying media files are gone from `MEDIA_ROOT`. If every episode appears missing at once, CultAnime skips local pruning unless `LOCAL_MEDIA_PRUNE_ALLOW_MASS_DELETE=true`, which protects against an accidentally unmounted media folder.

The admin page and `/api/admin/*` routes are protected by `ADMIN_PASSWORD`. After a successful login, CultAnime sets a signed HTTP-only admin session cookie. The cookie is marked secure automatically when the request is HTTPS or includes `x-forwarded-proto=https`; set `ADMIN_COOKIE_SECURE=true` only if your HTTPS proxy does not pass that header.

`PUID` and `PGID` control the Linux user that runs the app inside Docker. On TrueNAS SCALE, `568:568` is commonly used for app datasets. Set these to the owner of the folder mounted at `/app/data` so SQLite can create `cultanime.db`.

The `Request` tab talks to Seerr/Jellyseerr through CultAnime's backend when `SEERR_URL` and `SEERR_API_KEY` are set, for example `SEERR_URL=http://YOUR_SEERR_SERVER:5055`. Keep Seerr connected to Sonarr/Radarr/Jellyfin so requests flow through Seerr first, then the downloader saves series under `/media/anime` and anime movies under `/media/anime_movies`, Jellyfin scans, and CultAnime syncs the new anime into the library. The Seerr API key is server-only and is never exposed to the browser.

The admin Manage tab has two deletion paths. `Delete Local` only removes the CultAnime SQLite row. `Remove Server` is the destructive path: it calls Sonarr for series/season files or Radarr for movies, asks Jellyfin to refresh, runs a CultAnime sync, then removes the local row. CultAnime can discover Sonarr/Radarr API settings from Seerr/Jellyseerr; set `SONARR_URL`/`SONARR_API_KEY` or `RADARR_URL`/`RADARR_API_KEY` only if you want direct downloader configuration. For season-level anime panels, CultAnime removes the linked season files and unmonitors that season instead of deleting unrelated seasons.

Request search and submit are anime-gated. By default, CultAnime only allows TV/movie results that are animation and have Japanese origin/language metadata from Seerr/TMDB. You can extend the accepted metadata with `SEERR_ANIME_ORIGIN_COUNTRIES=JP,CN,KR` or `SEERR_ANIME_LANGUAGES=ja,zh,ko` if your library should include donghua or Korean animation. Movie requests are sent to Seerr with `SEERR_ANIME_MOVIE_ROOT_FOLDER=/media/anime_movies`.

For production, run CultAnime on the server that can reach Jellyfin, Seerr, SQLite storage, and the anime media mount. The included Docker files and production env example are the expected deployment path.
