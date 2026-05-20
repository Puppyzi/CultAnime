import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db';
import { getDirectStreamUrl } from '../../../../lib/jellyfin';
import { resolveEpisodePlayback } from '../../../../lib/playback';
import {
  buildDownloadFilename,
  buildEpisodeZipFilename,
  buildSeriesDownloadFilename,
  contentDisposition,
  resolveDownloadSize,
  sanitizeFilename,
} from '../../../../lib/download';
import { createStoredZipStream, estimateStoredZipSize } from '../../../../lib/zip';

export const dynamic = 'force-dynamic';

function zipEntryPath(folderName, episode, filename, padWidth, seenNames) {
  const episodeNumber = Number(episode.episode_number);
  const prefix = Number.isFinite(episodeNumber)
    ? `${String(episodeNumber).padStart(padWidth, '0')} - `
    : '';
  const candidate = `${folderName}/${prefix}${filename}`;
  const seenCount = seenNames.get(candidate) || 0;

  seenNames.set(candidate, seenCount + 1);
  if (seenCount === 0) return candidate;

  const slashIndex = candidate.lastIndexOf('/');
  const folder = slashIndex >= 0 ? candidate.slice(0, slashIndex + 1) : '';
  const name = slashIndex >= 0 ? candidate.slice(slashIndex + 1) : candidate;
  const dotIndex = name.lastIndexOf('.');
  const stem = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  const extension = dotIndex > 0 ? name.slice(dotIndex) : '';

  return `${folder}${stem} (${seenCount + 1})${extension}`;
}

function assertKnownEpisodeSizes(entries) {
  const missingEpisodes = entries
    .filter(entry => !Number.isFinite(Number(entry.sizeBytes)) || Number(entry.sizeBytes) <= 0)
    .map(entry => ({
      episodeId: entry.episode.id,
      episodeNumber: entry.episode.episode_number,
      title: entry.episode.title,
    }));

  if (missingEpisodes.length > 0) {
    return NextResponse.json({
      error: 'Could not confirm every episode file size',
      missingEpisodes,
    }, { status: 409 });
  }

  return null;
}

async function buildSeriesDownloadPlan(animeId) {
  const db = getDb();
  const anime = db.prepare('SELECT * FROM anime WHERE id = ?').get(animeId);

  if (!anime) return null;

  const episodes = db.prepare(`
    SELECT id, episode_number
    FROM episodes
    WHERE anime_id = ?
    ORDER BY COALESCE(season_number, 1), episode_number
  `).all(animeId);

  const maxEpisodeNumber = episodes.reduce((max, episode) => {
    const episodeNumber = Number(episode.episode_number);
    return Number.isFinite(episodeNumber) ? Math.max(max, episodeNumber) : max;
  }, 0);
  const padWidth = Math.max(2, String(maxEpisodeNumber).length);
  const folderName = sanitizeFilename(anime.title || 'CultAnime');
  const seenNames = new Map();
  const entries = [];

  for (const episodeRef of episodes) {
    const playback = await resolveEpisodePlayback(episodeRef.id);
    if (!playback) continue;

    const { episode, jellyfinItemId, mediaSourceId, mediaSource } = playback;
    const directUrl = getDirectStreamUrl(jellyfinItemId, { mediaSourceId });
    const filename = buildDownloadFilename(episode, mediaSource);
    const zipFilename = buildEpisodeZipFilename(episode, mediaSource);
    const sizeBytes = await resolveDownloadSize(mediaSource, directUrl);

    entries.push({
      episode,
      directUrl,
      filename,
      zipEntryName: zipEntryPath(folderName, episode, zipFilename, padWidth, seenNames),
      sizeBytes,
    });
  }

  return {
    anime,
    filename: buildSeriesDownloadFilename(anime),
    entries,
  };
}

function planMetadata(plan) {
  const mediaSizeBytes = plan.entries.reduce((total, entry) => total + Number(entry.sizeBytes), 0);
  const zipSizeBytes = Number(estimateStoredZipSize(
    plan.entries.map(entry => ({
      name: entry.zipEntryName,
      sizeBytes: entry.sizeBytes,
    }))
  ));

  return {
    animeId: plan.anime.id,
    filename: plan.filename,
    episodeCount: plan.entries.length,
    mediaSizeBytes,
    totalSizeBytes: zipSizeBytes,
    episodes: plan.entries.map(entry => ({
      episodeId: entry.episode.id,
      episodeNumber: entry.episode.episode_number,
      title: entry.episode.title,
      filename: entry.filename,
      sizeBytes: entry.sizeBytes,
    })),
  };
}

export async function GET(request, { params }) {
  try {
    const { animeId } = await params;
    const { searchParams } = new URL(request.url);
    const plan = await buildSeriesDownloadPlan(animeId);

    if (!plan) {
      return NextResponse.json({ error: 'Anime not found' }, { status: 404 });
    }

    if (plan.entries.length === 0) {
      return NextResponse.json({ error: 'No episodes found for this anime' }, { status: 404 });
    }

    const sizeError = assertKnownEpisodeSizes(plan.entries);
    if (sizeError) return sizeError;

    const metadata = planMetadata(plan);

    if (searchParams.get('metadata') === '1') {
      return NextResponse.json(metadata, {
        headers: {
          'Cache-Control': 'private, no-store',
        },
      });
    }

    const zipEntries = plan.entries.map(entry => ({
      name: entry.zipEntryName,
      sizeBytes: entry.sizeBytes,
      lastModified: entry.episode.updated_at || entry.episode.created_at,
      open: () => fetch(entry.directUrl, { cache: 'no-store' }),
    }));

    return new NextResponse(createStoredZipStream(zipEntries), {
      headers: {
        'content-type': 'application/zip',
        'content-length': String(metadata.totalSizeBytes),
        'content-disposition': contentDisposition(metadata.filename),
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error.code === 'JELLYFIN_ITEM_NOT_FOUND') {
      return NextResponse.json(
        {
          error: 'Episode not found in Jellyfin library',
          detail: error.message,
        },
        { status: 404 }
      );
    }

    console.error('Series download error:', error);
    return NextResponse.json({ error: 'Series download error', detail: error.message }, { status: 500 });
  }
}
