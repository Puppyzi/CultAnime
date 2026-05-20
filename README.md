This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

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
MEDIA_RESCAN_DEBOUNCE_MS=60000
JELLYFIN_RESCAN_SETTLE_MS=10000
PUID=568
PGID=568
```

`MEDIA_ROOT` is the path CultAnime can read inside its runtime. `JELLYFIN_MEDIA_ROOT` is the path Jellyfin sees for that same folder. After the watcher sees a change, it waits for the folder to be quiet, asks Jellyfin to rescan the affected series folder, then runs the CultAnime sync.

CultAnime also runs a Jellyfin reconciliation loop by default. `LIBRARY_RECONCILE_INTERVAL_MS` controls how often the app compares Jellyfin's current series/episode list with SQLite, and `LIBRARY_RECONCILE_ON_READ_INTERVAL_MS` controls the minimum time between reconciliation checks triggered by anime list requests. The default read interval is `0`, so a page refresh can remove stale anime panels after Jellyfin has dropped a deleted series; raise this value if you prefer faster list responses over immediate cleanup.

On the server, `LOCAL_MEDIA_PRUNE_ENABLED=true` lets CultAnime remove episode rows when the underlying media files are gone from `MEDIA_ROOT`. If every episode appears missing at once, CultAnime skips local pruning unless `LOCAL_MEDIA_PRUNE_ALLOW_MASS_DELETE=true`, which protects against an accidentally unmounted media folder.

`PUID` and `PGID` control the Linux user that runs the app inside Docker. On TrueNAS SCALE, `568:568` is commonly used for app datasets. Set these to the owner of the folder mounted at `/app/data` so SQLite can create `cultanime.db`.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
