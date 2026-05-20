import { NextResponse } from 'next/server';
import { getDirectStreamUrl } from '../../../../lib/jellyfin';
import { resolveEpisodePlayback } from '../../../../lib/playback';

export const dynamic = 'force-dynamic';

function cleanText(value, fallback) {
  return String(value || fallback).replace(/\s+/g, ' ').trim();
}

function sanitizeFilename(value) {
  return cleanText(value, 'episode')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 160)
    || 'episode';
}

function basename(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() || '';
}

function extensionFromMediaSource(mediaSource) {
  const container = cleanText(mediaSource?.Container, '').toLowerCase();
  if (!container) return '';
  const firstContainer = container.split(',')[0].trim();
  return firstContainer ? `.${firstContainer}` : '';
}

function buildDownloadFilename(episode, mediaSource) {
  const originalName = basename(episode.file_path);
  if (originalName.includes('.')) {
    return sanitizeFilename(originalName);
  }

  const seriesTitle = cleanText(episode.anime_title, 'CultAnime');
  const episodeTitle = cleanText(episode.title, `Episode ${episode.episode_number}`);
  const extension = extensionFromMediaSource(mediaSource);
  return sanitizeFilename(`${seriesTitle} - ${episodeTitle}${extension}`);
}

function contentDisposition(filename) {
  const asciiName = filename.replace(/[^\x20-\x7E]/g, '').replace(/"/g, '');
  return `attachment; filename="${asciiName || 'episode'}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function copyHeader(sourceHeaders, targetHeaders, name) {
  const value = sourceHeaders.get(name);
  if (value) targetHeaders.set(name, value);
}

function bytesFromValue(value) {
  const bytes = Number(value);
  return Number.isFinite(bytes) && bytes > 0 ? bytes : null;
}

function sizeFromContentRange(value) {
  const match = String(value || '').match(/\/(\d+)$/);
  return match ? bytesFromValue(match[1]) : null;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function sizeFromJellyfinHeaders(directUrl) {
  try {
    const head = await fetchWithTimeout(directUrl, {
      method: 'HEAD',
      cache: 'no-store',
    });
    const headSize = bytesFromValue(head.headers.get('content-length'));
    if (head.ok && headSize) return headSize;
  } catch {
    // Some Jellyfin setups do not respond to HEAD for direct stream URLs.
  }

  try {
    const range = await fetchWithTimeout(directUrl, {
      headers: { Range: 'bytes=0-0' },
      cache: 'no-store',
    });
    return sizeFromContentRange(range.headers.get('content-range'))
      || bytesFromValue(range.headers.get('content-length'));
  } catch {
    return null;
  }
}

async function resolveDownloadSize(mediaSource, directUrl) {
  return bytesFromValue(mediaSource?.Size)
    || bytesFromValue(mediaSource?.size)
    || await sizeFromJellyfinHeaders(directUrl);
}

export async function GET(request, { params }) {
  try {
    const { episodeId } = await params;
    const { searchParams } = new URL(request.url);
    const playback = await resolveEpisodePlayback(episodeId);

    if (!playback) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    const { episode, jellyfinItemId, mediaSourceId, mediaSource } = playback;
    const directUrl = getDirectStreamUrl(jellyfinItemId, { mediaSourceId });
    const filename = buildDownloadFilename(episode, mediaSource);

    if (searchParams.get('metadata') === '1') {
      return NextResponse.json({
        episodeId: episode.id,
        filename,
        sizeBytes: await resolveDownloadSize(mediaSource, directUrl),
      }, {
        headers: {
          'Cache-Control': 'private, no-store',
        },
      });
    }

    const requestHeaders = {};
    const range = request.headers.get('range');

    if (range) {
      requestHeaders.Range = range;
    }

    const upstream = await fetch(directUrl, {
      headers: requestHeaders,
      cache: 'no-store',
    });

    if (!upstream.ok && upstream.status !== 206) {
      const detail = await upstream.text().catch(() => '');
      return NextResponse.json(
        { error: 'Episode download failed', detail: detail || upstream.statusText },
        { status: upstream.status }
      );
    }

    const headers = new Headers();
    copyHeader(upstream.headers, headers, 'accept-ranges');
    copyHeader(upstream.headers, headers, 'content-length');
    copyHeader(upstream.headers, headers, 'content-range');
    copyHeader(upstream.headers, headers, 'content-type');
    copyHeader(upstream.headers, headers, 'etag');
    copyHeader(upstream.headers, headers, 'last-modified');

    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/octet-stream');
    }

    headers.set('content-disposition', contentDisposition(filename));
    headers.set('cache-control', 'private, no-store');

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers,
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

    console.error('Episode download error:', error);
    return NextResponse.json({ error: 'Episode download error', detail: error.message }, { status: 500 });
  }
}
