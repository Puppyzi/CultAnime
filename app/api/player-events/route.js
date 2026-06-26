import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const MAX_STRING_LENGTH = 160;

function cleanText(value, maxLength = MAX_STRING_LENGTH) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function cleanNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 1000) / 1000;
}

function cleanBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}

function cleanLevels(levels) {
  if (!Array.isArray(levels)) return null;

  return levels.slice(0, 8).map(level => ({
    index: cleanNumber(level?.index),
    height: cleanNumber(level?.height),
    bitrate: cleanNumber(level?.bitrate),
  }));
}

function cleanPayload(payload, request) {
  return {
    at: new Date().toISOString(),
    event: cleanText(payload?.event, 80) || 'unknown',
    animeId: cleanText(payload?.animeId, 40),
    episodeId: cleanText(payload?.episodeId, 40),
    episodeNumber: cleanNumber(payload?.episodeNumber),
    streamSessionId: cleanText(payload?.streamSessionId, 120),
    delivery: cleanText(payload?.delivery, 40),
    reason: cleanText(payload?.reason, 80),
    trigger: cleanText(payload?.trigger, 80),
    currentTime: cleanNumber(payload?.currentTime),
    duration: cleanNumber(payload?.duration),
    bufferAhead: cleanNumber(payload?.bufferAhead),
    readyState: cleanNumber(payload?.readyState),
    networkState: cleanNumber(payload?.networkState),
    paused: cleanBoolean(payload?.paused),
    ended: cleanBoolean(payload?.ended),
    reloadCount: cleanNumber(payload?.reloadCount),
    attempt: cleanNumber(payload?.attempt),
    stalledMs: cleanNumber(payload?.stalledMs),
    videoBitrate: cleanNumber(payload?.videoBitrate),
    audioStreamIndex: cleanNumber(payload?.audioStreamIndex),
    subtitleMode: cleanText(payload?.subtitleMode, 40),
    burnedInSubtitleIndex: cleanNumber(payload?.burnedInSubtitleIndex),
    audioTrackCount: cleanNumber(payload?.audioTrackCount),
    subtitleCount: cleanNumber(payload?.subtitleCount),
    directAvailable: cleanBoolean(payload?.directAvailable),
    hlsType: cleanText(payload?.hlsType, 80),
    hlsDetails: cleanText(payload?.hlsDetails, 100),
    hlsFatal: cleanBoolean(payload?.hlsFatal),
    hlsLevel: cleanNumber(payload?.hlsLevel),
    hlsAutoLevelEnabled: cleanBoolean(payload?.hlsAutoLevelEnabled),
    hlsLevels: cleanLevels(payload?.hlsLevels),
    responseCode: cleanNumber(payload?.responseCode),
    mediaErrorCode: cleanNumber(payload?.mediaErrorCode),
    cloudflare: request.headers.has('cf-ray') || request.headers.has('cf-connecting-ip'),
  };
}

export async function POST(request) {
  if (process.env.PLAYER_EVENT_LOGGING_ENABLED === 'false') {
    return new NextResponse(null, { status: 204 });
  }

  try {
    const payload = await request.json();
    const event = cleanPayload(payload, request);
    console.info(`[player:${event.event}] ${JSON.stringify(event)}`);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.warn('[player:event-log-failed]', error.message);
    return NextResponse.json({ error: 'Invalid player event' }, { status: 400 });
  }
}
