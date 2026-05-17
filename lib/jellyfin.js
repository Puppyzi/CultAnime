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
async function jellyfinFetch(endpoint, options = {}) {
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

  let res;
  try {
    res = await fetch(authenticatedUrl, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
  } catch (networkErr) {
    throw new Error(`Cannot reach Jellyfin at ${baseUrl}. Make sure the server is running and accessible.`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`Jellyfin API error (${res.status}): ${text}`);
  }

  return res.json();
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
 * Get a Jellyfin item by its ID.
 *
 * @param {string} itemId - The Jellyfin item ID.
 * @returns {object|null} The Jellyfin item, or null.
 */
export async function getItemById(itemId) {
  try {
    return await jellyfinFetch(`/Items/${itemId}?fields=Path,MediaSources`);
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
    MediaSourceId: itemId,
    VideoCodec: options.videoCodec || 'h264',
    AudioCodec: options.audioCodec || 'aac',
    TranscodingProtocol: 'hls',
    TranscodingContainer: 'ts',
    // Subtitle handling — burn subtitles into the video stream
    SubtitleMethod: options.subtitleMethod || 'Encode',
    // Default to a high bitrate for anime quality
    MaxStreamingBitrate: String(options.maxBitrate || 20000000),
    // Enable breaking on non-key frames for faster seeking
    BreakOnNonKeyFrames: 'true',
  });

  // If the file can be direct-played (e.g. already H.264 MP4), Jellyfin
  // will skip transcoding automatically and serve the file directly.
  return `${baseUrl}/Videos/${itemId}/master.m3u8?${params.toString()}`;
}

/**
 * Build a direct stream URL (no transcoding) for when the file is already
 * in a compatible format.
 *
 * @param {string} itemId - The Jellyfin item ID.
 * @returns {string} The direct stream URL.
 */
export function getDirectStreamUrl(itemId) {
  const baseUrl = JELLYFIN_URL();
  const apiKey = JELLYFIN_API_KEY();

  return `${baseUrl}/Videos/${itemId}/stream?api_key=${apiKey}&static=true`;
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
