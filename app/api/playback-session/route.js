import { NextResponse } from 'next/server';
import { fetchJellyfinResource } from '../../../lib/jellyfin';

export const dynamic = 'force-dynamic';

const PLAY_SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEVICE_ID_PATTERN = /^cultanime-[A-Za-z0-9_.-]+$/;

/**
 * POST /api/playback-session
 *
 * Forwards playback session keep-alives to Jellyfin. Jellyfin kills an idle
 * HLS transcode job (and deletes its generated segments) roughly a minute
 * after the last playlist/segment request, so a paused player loses its
 * stream. Official Jellyfin clients avoid this by pinging the play session
 * while the player is open, including while paused; this endpoint lets the
 * browser do the same through the same-origin API.
 *
 * Actions:
 *   - "ping": resets the transcode kill timer for the play session.
 *   - "stop": stops the transcode immediately so ffmpeg is not left running
 *     after the player goes away.
 */
export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid playback session payload' }, { status: 400 });
  }

  const action = payload?.action;
  const playSessionId = String(payload?.playSessionId || '');
  const deviceId = String(payload?.deviceId || '');

  if (!['ping', 'stop'].includes(action) || !PLAY_SESSION_ID_PATTERN.test(playSessionId)) {
    return NextResponse.json({ error: 'Invalid playback session payload' }, { status: 400 });
  }

  if (action === 'stop' && !DEVICE_ID_PATTERN.test(deviceId)) {
    return NextResponse.json({ error: 'Invalid playback session payload' }, { status: 400 });
  }

  try {
    if (action === 'ping') {
      await fetchJellyfinResource(
        `/Sessions/Playing/Ping?playSessionId=${encodeURIComponent(playSessionId)}`,
        { method: 'POST' }
      );
    } else {
      await fetchJellyfinResource(
        `/Videos/ActiveEncodings?deviceId=${encodeURIComponent(deviceId)}&playSessionId=${encodeURIComponent(playSessionId)}`,
        { method: 'DELETE' }
      );
    }
  } catch (error) {
    // The session may already be gone on Jellyfin's side; keep-alive failures
    // must never surface as player errors.
    console.warn(`[playback-session:${action}-failed]`, error.message);
  }

  return new NextResponse(null, { status: 204 });
}
