export function cleanText(value, fallback) {
  return String(value || fallback).replace(/\s+/g, ' ').trim();
}

export function sanitizeFilename(value) {
  const cleaned = cleanText(value, 'episode')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ');

  if (!cleaned) return 'episode';
  if (cleaned.length <= 160) return cleaned;

  const dotIndex = cleaned.lastIndexOf('.');
  const extension = dotIndex > 0 ? cleaned.slice(dotIndex) : '';

  if (extension.length > 1 && extension.length <= 12) {
    const stem = cleaned
      .slice(0, 160 - extension.length)
      .trim()
      .replace(/[\s._-]*[\[\(\{]*$/g, '')
      .trim();

    return `${stem || 'episode'}${extension}`;
  }

  return cleaned.slice(0, 160).trim() || 'episode';
}

function basename(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() || '';
}

function extensionFromPath(filePath) {
  const originalName = basename(filePath);
  const dotIndex = originalName.lastIndexOf('.');
  return dotIndex > 0 ? originalName.slice(dotIndex) : '';
}

function extensionFromMediaSource(mediaSource) {
  const container = cleanText(mediaSource?.Container, '').toLowerCase();
  if (!container) return '';
  const firstContainer = container.split(',')[0].trim();
  return firstContainer ? `.${firstContainer}` : '';
}

export function buildDownloadFilename(episode, mediaSource) {
  const originalName = basename(episode.file_path);
  if (originalName.includes('.')) {
    return sanitizeFilename(originalName);
  }

  const seriesTitle = cleanText(episode.anime_title, 'CultAnime');
  const episodeTitle = cleanText(episode.title, `Episode ${episode.episode_number}`);
  const extension = extensionFromMediaSource(mediaSource);
  return sanitizeFilename(`${seriesTitle} - ${episodeTitle}${extension}`);
}

export function buildEpisodeZipFilename(episode, mediaSource) {
  const episodeTitle = cleanText(episode.title, `Episode ${episode.episode_number}`);
  const extension = extensionFromPath(episode.file_path) || extensionFromMediaSource(mediaSource);

  return sanitizeFilename(`${episodeTitle}${extension}`);
}

export function buildSeriesDownloadFilename(anime) {
  return `${sanitizeFilename(anime?.title || 'CultAnime')}.zip`;
}

export function contentDisposition(filename) {
  const asciiName = filename.replace(/[^\x20-\x7E]/g, '').replace(/"/g, '');
  return `attachment; filename="${asciiName || 'download'}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function copyHeader(sourceHeaders, targetHeaders, name) {
  const value = sourceHeaders.get(name);
  if (value) targetHeaders.set(name, value);
}

export function bytesFromValue(value) {
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

export async function resolveDownloadSize(mediaSource, directUrl) {
  return bytesFromValue(mediaSource?.Size)
    || bytesFromValue(mediaSource?.size)
    || await sizeFromJellyfinHeaders(directUrl);
}
