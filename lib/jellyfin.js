/**
 * Jellyfin API client for CultAnime.
 *
 * Handles communication with a Jellyfin server to resolve stream URLs
 * for anime episodes. Uses the Jellyfin REST API with an API key.
 */

import crypto from 'crypto';

const JELLYFIN_URL = () => process.env.JELLYFIN_URL?.replace(/\/+$/, '');
const JELLYFIN_API_KEY = () => process.env.JELLYFIN_API_KEY;
const JELLYFIN_PROXY_PATH = '/api/jellyfin';
const PROXY_EXPIRES_PARAM = 'cultanimeProxyExpires';
const PROXY_SIGNATURE_PARAM = 'cultanimeProxySig';
const PROXY_IGNORED_PARAMS = new Set([
  'api_key',
  'cultanimeSession',
  PROXY_EXPIRES_PARAM,
  PROXY_SIGNATURE_PARAM,
]);
const DEFAULT_PROXY_TTL_SECONDS = 12 * 60 * 60;
const DEFAULT_STREAM_VIDEO_BITRATE = 20_000_000;
const DEFAULT_STREAM_AUDIO_BITRATE = 320_000;

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
}

export function getJellyfinBaseUrl() {
  return JELLYFIN_URL();
}

export function getJellyfinApiKey() {
  return JELLYFIN_API_KEY();
}

function getProxySecret() {
  const apiKey = JELLYFIN_API_KEY();
  return process.env.JELLYFIN_PROXY_SECRET || apiKey;
}

function normalizeProxySearchParams(searchParams) {
  const pairs = [];

  for (const [key, value] of searchParams) {
    if (!PROXY_IGNORED_PARAMS.has(key)) {
      pairs.push([key, value]);
    }
  }

  pairs.sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    if (leftKey === rightKey) return leftValue.localeCompare(rightValue);
    return leftKey.localeCompare(rightKey);
  });

  const normalized = new URLSearchParams();
  for (const [key, value] of pairs) {
    normalized.append(key, value);
  }

  return normalized.toString();
}

function signProxyTarget(relativePathname, searchParams, expiresAt) {
  const secret = getProxySecret();
  if (!secret) {
    throw new Error('Jellyfin proxy signing is not configured.');
  }

  return crypto
    .createHmac('sha256', secret)
    .update(`${expiresAt}\n${relativePathname}\n${normalizeProxySearchParams(searchParams)}`)
    .digest('base64url');
}

function signaturesMatch(left, right) {
  const leftBuffer = Buffer.from(left || '');
  const rightBuffer = Buffer.from(right || '');

  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function getProxyTtlMs() {
  const ttlSeconds = Number(process.env.JELLYFIN_PROXY_TTL_SECONDS);
  const safeTtlSeconds = Number.isFinite(ttlSeconds) && ttlSeconds > 0
    ? ttlSeconds
    : DEFAULT_PROXY_TTL_SECONDS;

  return safeTtlSeconds * 1000;
}

function getPathnameRelativeToBase(upstreamUrl, baseUrl) {
  const basePath = baseUrl.pathname.replace(/\/+$/, '');

  if (!basePath || basePath === '/') {
    return upstreamUrl.pathname || '/';
  }

  if (upstreamUrl.pathname === basePath) {
    return '/';
  }

  if (upstreamUrl.pathname.startsWith(`${basePath}/`)) {
    return upstreamUrl.pathname.slice(basePath.length);
  }

  throw new Error('Cannot proxy a URL outside the configured Jellyfin base path.');
}

export function getProxiedJellyfinUrl(jellyfinUrl, options = {}) {
  const baseUrl = JELLYFIN_URL();
  const apiKey = JELLYFIN_API_KEY();

  if (!baseUrl || !apiKey) {
    throw new Error('Jellyfin is not configured.');
  }

  const base = new URL(`${baseUrl}/`);
  const upstream = new URL(jellyfinUrl, base);

  if (upstream.origin !== base.origin) {
    throw new Error('Cannot proxy a URL outside the configured Jellyfin server.');
  }

  const relativePathname = getPathnameRelativeToBase(upstream, base);
  const proxyUrl = new URL(`${JELLYFIN_PROXY_PATH}${relativePathname}`, 'http://cultanime.local');

  for (const [key, value] of upstream.searchParams) {
    if (!PROXY_IGNORED_PARAMS.has(key)) {
      proxyUrl.searchParams.append(key, value);
    }
  }

  const expiresAt = options.expiresAt || Date.now() + getProxyTtlMs();
  proxyUrl.searchParams.set(PROXY_EXPIRES_PARAM, String(expiresAt));
  proxyUrl.searchParams.set(
    PROXY_SIGNATURE_PARAM,
    signProxyTarget(relativePathname, proxyUrl.searchParams, expiresAt)
  );

  return `${proxyUrl.pathname}${proxyUrl.search}`;
}

export function verifyProxiedJellyfinUrl(relativePathname, searchParams) {
  const signature = searchParams.get(PROXY_SIGNATURE_PARAM);
  const expiresAt = Number(searchParams.get(PROXY_EXPIRES_PARAM));

  if (!signature || !Number.isFinite(expiresAt)) {
    return { ok: false, status: 403, error: 'Missing Jellyfin proxy signature' };
  }

  if (expiresAt < Date.now()) {
    return { ok: false, status: 403, error: 'Expired Jellyfin proxy signature' };
  }

  const expected = signProxyTarget(relativePathname, searchParams, expiresAt);
  if (!signaturesMatch(signature, expected)) {
    return { ok: false, status: 403, error: 'Invalid Jellyfin proxy signature' };
  }

  return { ok: true };
}

export function buildJellyfinProxyTargetUrl(relativePathname, searchParams) {
  const baseUrl = JELLYFIN_URL();
  const apiKey = JELLYFIN_API_KEY();

  if (!baseUrl || !apiKey) {
    throw new Error('Jellyfin is not configured.');
  }

  const base = new URL(`${baseUrl}/`);
  const target = new URL(relativePathname.replace(/^\/+/, ''), base);
  const targetParams = new URLSearchParams();

  for (const [key, value] of searchParams) {
    if (!PROXY_IGNORED_PARAMS.has(key)) {
      targetParams.append(key, value);
    }
  }

  targetParams.set('api_key', apiKey);
  target.search = targetParams.toString();

  return target;
}

/**
 * Make an authenticated request to the Jellyfin API.
 */
async function jellyfinRequest(endpoint, options = {}) {
  const baseUrl = JELLYFIN_URL();
  const apiKey = JELLYFIN_API_KEY();

  if (!baseUrl || !apiKey || baseUrl.includes('your-truenas-ip') || apiKey.includes('your-jellyfin')) {
    throw new Error(
      'Jellyfin is not configured. Update JELLYFIN_URL and JELLYFIN_API_KEY in your .env.local file with your actual Jellyfin server details, then restart the dev server.'
    );
  }

  const url = `${baseUrl}${endpoint}`;
  const separator = url.includes('?') ? '&' : '?';
  const authenticatedUrl = `${url}${separator}api_key=${apiKey}`;
  const { headers: optionHeaders, ...requestOptions } = options;

  let res;
  try {
    res = await fetch(authenticatedUrl, {
      ...requestOptions,
      headers: {
        ...optionHeaders,
      },
    });
  } catch (networkErr) {
    throw new Error(`Cannot reach Jellyfin at ${baseUrl}. Make sure the server is running and accessible.`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`Jellyfin API error (${res.status}): ${text}`);
  }

  return res;
}

async function jellyfinFetch(endpoint, options = {}) {
  const res = await jellyfinRequest(endpoint, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...options.headers,
    },
  });

  return res.json();
}

export async function fetchJellyfinResource(endpoint, options = {}) {
  return jellyfinRequest(endpoint, options);
}

export async function notifyJellyfinMediaUpdated(updates) {
  const normalizedUpdates = updates
    .filter(update => update?.path)
    .map(update => ({
      Path: update.path,
      UpdateType: update.updateType || 'Modified',
    }));

  if (normalizedUpdates.length === 0) {
    throw new Error('No media paths were provided for Jellyfin refresh.');
  }

  await jellyfinRequest('/Library/Media/Updated', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ Updates: normalizedUpdates }),
  });
}

export async function refreshJellyfinLibrary() {
  await jellyfinRequest('/Library/Refresh', {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
}

export async function refreshJellyfinItemMetadata(itemId, options = {}) {
  if (!itemId) {
    throw new Error('A Jellyfin item ID is required to refresh metadata.');
  }

  const params = new URLSearchParams({
    Recursive: options.recursive ? 'true' : 'false',
    MetadataRefreshMode: options.metadataRefreshMode || 'FullRefresh',
    ImageRefreshMode: options.imageRefreshMode || 'Default',
    ReplaceAllMetadata: options.replaceAllMetadata ? 'true' : 'false',
    ReplaceAllImages: options.replaceAllImages ? 'true' : 'false',
  });

  await jellyfinRequest(`/Items/${encodeURIComponent(itemId)}/Refresh?${params.toString()}`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
}

/**
 * Search for a Jellyfin item by its file path on disk.
 * Since Jellyfin and CultAnime point to the same /media/anime folder,
 * we can match episodes by their file_path.
 *
 * @param {string} filePath - The file path stored in our episodes table.
 * @returns {object|null} The Jellyfin item, or null if not found.
 */
export async function findItemByPath(filePath) {
  try {
    // Normalize the path for comparison (handle Windows vs Linux separators)
    const normalizedTarget = filePath.replace(/\\/g, '/');

    // Get all items recursively with Path field included
    // We filter by video type to avoid matching non-video items
    const data = await jellyfinFetch(
      '/Items?recursive=true&fields=Path,MediaSources&IncludeItemTypes=Episode,Movie&limit=10000'
    );

    if (!data.Items || data.Items.length === 0) return null;

    // Find the item whose path matches our file_path
    const item = data.Items.find(i => {
      if (!i.Path) return false;
      const normalizedItemPath = i.Path.replace(/\\/g, '/');
      return normalizedItemPath === normalizedTarget || normalizedItemPath.endsWith(normalizedTarget);
    });

    return item || null;
  } catch (error) {
    console.error('Jellyfin findItemByPath error:', error.message);
    return null;
  }
}

/**
 * Get Jellyfin playback info by item ID.
 * This includes media sources and embedded audio/subtitle streams.
 *
 * @param {string} itemId - The Jellyfin item ID.
 * @returns {object|null} The Jellyfin item, or null.
 */
export async function getItemById(itemId) {
  try {
    return await jellyfinFetch(`/Items/${itemId}/PlaybackInfo`);
  } catch (error) {
    console.error('Jellyfin getItemById error:', error.message);
    return null;
  }
}

/**
 * Build the HLS master playlist URL for a given Jellyfin item.
 * This URL can be passed directly to hls.js on the frontend.
 *
 * @param {string} itemId - The Jellyfin item ID.
 * @param {object} options - Optional transcoding parameters.
 * @returns {string} The full HLS stream URL.
 */
export function getStreamUrl(itemId, options = {}) {
  const baseUrl = JELLYFIN_URL();
  const apiKey = JELLYFIN_API_KEY();

  if (!baseUrl || !apiKey) {
    throw new Error('Jellyfin is not configured.');
  }

  const params = new URLSearchParams({
    api_key: apiKey,
    MediaSourceId: options.mediaSourceId || itemId,
    VideoCodec: options.videoCodec || 'h264',
    AudioCodec: options.audioCodec || 'aac',
    TranscodingProtocol: 'hls',
    TranscodingContainer: 'ts',
    SubtitleMethod: options.subtitleMethod || 'Hls',
    VideoBitrate: String(positiveInteger(options.videoBitrate, DEFAULT_STREAM_VIDEO_BITRATE)),
    AudioBitrate: String(positiveInteger(options.audioBitrate, DEFAULT_STREAM_AUDIO_BITRATE)),
    MaxWidth: '1920',
    MaxHeight: '1080',
    BreakOnNonKeyFrames: 'true',
  });

  if (options.deviceId) {
    params.set('DeviceId', options.deviceId);
  }

  if (options.playSessionId) {
    params.set('PlaySessionId', options.playSessionId);
  }

  if (options.subtitleStreamIndex !== undefined && options.subtitleStreamIndex !== null) {
    params.set('SubtitleStreamIndex', String(options.subtitleStreamIndex));
  }

  if (options.audioStreamIndex !== undefined && options.audioStreamIndex !== null) {
    params.set('AudioStreamIndex', String(options.audioStreamIndex));
  }

  if (options.alwaysBurnInSubtitleWhenTranscoding) {
    params.set('AlwaysBurnInSubtitleWhenTranscoding', 'true');
    params.set('AllowVideoStreamCopy', 'false');
    params.set('EnableAutoStreamCopy', 'false');
  }

  return `${baseUrl}/Videos/${itemId}/main.m3u8?${params.toString()}`;
}

/**
 * Build a direct stream URL (no transcoding) for when the file is already
 * in a compatible format.
 *
 * @param {string} itemId - The Jellyfin item ID.
 * @returns {string} The direct stream URL.
 */
export function getDirectStreamUrl(itemId, options = {}) {
  const baseUrl = JELLYFIN_URL();
  const apiKey = JELLYFIN_API_KEY();
  const params = new URLSearchParams({
    api_key: apiKey,
    static: 'true',
  });

  if (options.mediaSourceId) {
    params.set('MediaSourceId', options.mediaSourceId);
  }

  if (options.audioStreamIndex !== undefined && options.audioStreamIndex !== null) {
    params.set('AudioStreamIndex', String(options.audioStreamIndex));
  }

  return `${baseUrl}/Videos/${itemId}/stream?${params.toString()}`;
}

/**
 * Build a subtitle stream URL to fetch subtitles as WebVTT.
 */
export function getSubtitleUrl(itemId, mediaSourceId, streamIndex) {
  const baseUrl = JELLYFIN_URL();
  const apiKey = JELLYFIN_API_KEY();
  return `${baseUrl}/Videos/${itemId}/${mediaSourceId}/Subtitles/${streamIndex}/0/Stream.vtt?api_key=${apiKey}`;
}

/**
 * Check if the Jellyfin server is reachable.
 *
 * @returns {boolean} True if the server responded.
 */
export async function checkServerHealth(timeoutMs = 3000) {
  try {
    const baseUrl = JELLYFIN_URL();
    if (!baseUrl) return false;

    const res = await fetch(`${baseUrl}/System/Ping`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}
