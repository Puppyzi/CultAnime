/**
 * Jellyfin API client for CultAnime.
 *
 * Handles communication with a Jellyfin server to resolve stream URLs
 * for anime episodes. Uses the Jellyfin REST API with an API key.
 */

const JELLYFIN_URL = () => process.env.JELLYFIN_URL?.replace(/\/+$/, '');
const JELLYFIN_API_KEY = () => process.env.JELLYFIN_API_KEY;

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
    VideoBitrate: '20000000',
    AudioBitrate: '320000',
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
export async function checkServerHealth() {
  try {
    const baseUrl = JELLYFIN_URL();
    if (!baseUrl) return false;

    const res = await fetch(`${baseUrl}/System/Ping`);
    return res.ok;
  } catch {
    return false;
  }
}
