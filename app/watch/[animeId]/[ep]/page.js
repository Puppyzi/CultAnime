'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { PlayIcon } from '../../../../components/Icons';
import {
  chooseSubtitle,
  isJapaneseAudioTrack,
  requiresBurnedInSubtitle,
} from '../../../../lib/track-selection';

const SUBTITLE_PREF_KEY = 'cultanime.subtitleTrack';
const AUDIO_PREF_KEY = 'cultanime.audioTrack';
const NEXT_AIRING_HIDDEN_KEY = 'cultanime.nextAiringHidden';
const STALL_RECOVERY_DELAY_MS = 12000;
const PLAYBACK_WATCHDOG_INTERVAL_MS = 4000;
const PLAYBACK_WATCHDOG_PAUSED_MS = 8000;
const PLAYBACK_WATCHDOG_STUCK_MS = 18000;
const PLAYBACK_RELOAD_RESET_MS = 60000;
const USER_PLAYBACK_ACTION_GRACE_MS = 2000;
const MAX_AUTOMATIC_STREAM_RELOADS = 4;
const PENDING_PLAYER_EVENTS_KEY = 'cultanime.pendingPlayerEvents';
const MAX_PENDING_PLAYER_EVENTS = 20;
const PLAYBACK_KEEPALIVE_INTERVAL_MS = 10000;

// hls.js is ~0.5 MB of script, so it is loaded on demand instead of being
// bundled into the route chunk. The page shell (episode list, metadata,
// controls) renders without waiting for it, and the module is cached after
// the first load.
let hlsModulePromise = null;
function loadHls() {
  if (!hlsModulePromise) {
    hlsModulePromise = import('hls.js').then(module => module.default);
  }
  return hlsModulePromise;
}

function mediaPreferenceKey(baseKey, animeId) {
  return animeId ? `${baseKey}.${animeId}` : baseKey;
}

function readMediaPreference(baseKey, animeId) {
  try {
    const key = mediaPreferenceKey(baseKey, animeId);
    const scoped = window.localStorage.getItem(key);
    if (scoped !== null) return scoped;

    const legacy = window.localStorage.getItem(baseKey);
    if (legacy !== null && animeId) {
      window.localStorage.setItem(key, legacy);
      window.localStorage.removeItem(baseKey);
      return legacy;
    }

    return null;
  } catch {
    return null;
  }
}

function writeMediaPreference(baseKey, animeId, value) {
  try {
    window.localStorage.setItem(mediaPreferenceKey(baseKey, animeId), value);
  } catch {
    // Preference persistence is optional.
  }
}

function removeMediaPreference(baseKey, animeId) {
  try {
    window.localStorage.removeItem(mediaPreferenceKey(baseKey, animeId));
  } catch {
    // Preference persistence is optional.
  }
}

function readNextAiringHidden() {
  try {
    return window.sessionStorage.getItem(NEXT_AIRING_HIDDEN_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeNextAiringHidden(hidden) {
  try {
    if (hidden) {
      window.sessionStorage.setItem(NEXT_AIRING_HIDDEN_KEY, 'true');
    } else {
      window.sessionStorage.removeItem(NEXT_AIRING_HIDDEN_KEY);
    }
  } catch {
    // Temporary preference persistence is optional.
  }
}

function resumeSecondsFromHistory(entry) {
  const progress = Number(entry?.progress);
  if (!Number.isFinite(progress) || progress < 5) return 0;
  return progress;
}

function persistWatchProgress({ episodeId, animeId, currentTime, duration, useBeacon = false }) {
  if (!episodeId || !Number.isFinite(currentTime) || currentTime < 5) return;

  const payload = {
    episode_id: episodeId,
    anime_id: Number.parseInt(animeId, 10),
    progress: currentTime,
    duration: duration || 0,
    completed: duration > 0 && currentTime / duration > 0.9,
  };

  try {
    const body = JSON.stringify(payload);

    if (useBeacon && navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon('/api/history', blob)) return;
    }

    fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: useBeacon,
    }).catch(() => {});
  } catch {
    // Progress persistence must never interrupt playback.
  }
}

function episodeThumbnailUrl(ep, width = 320, height = 180) {
  return `/api/thumbnail/${ep.id}?width=${width}&height=${height}`;
}

function formatEpisodeDate(value) {
  if (!value) return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.valueOf())) return null;

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatEpisodeRuntime(seconds) {
  if (!seconds || !Number.isFinite(Number(seconds))) return null;
  return `${Math.max(1, Math.round(Number(seconds) / 60))}m`;
}

function episodeMetaText(ep) {
  return [formatEpisodeDate(ep.air_date), formatEpisodeRuntime(ep.duration)].filter(Boolean).join(' | ');
}

function episodeTotalFor(anime) {
  const metadataTotal = Number(anime?.episodes_total) || 0;
  const maxEpisodeNumber = Math.max(
    0,
    ...(anime?.episodes || []).map(episode => Number(episode.episode_number) || 0)
  );
  const availableCount = anime?.episodes?.length || 0;
  const total = Math.max(metadataTotal, maxEpisodeNumber, availableCount);

  return total > 0 ? total : null;
}

function formatNextAiringDate(airingAt) {
  const date = new Date(Number(airingAt) * 1000);
  if (Number.isNaN(date.valueOf())) return null;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).formatToParts(date);
  const part = type => parts.find(item => item.type === type)?.value || '';
  const year = part('year');
  const month = part('month');
  const day = part('day');
  const hour = part('hour');
  const minute = part('minute');
  const dayPeriod = part('dayPeriod');
  const timeZoneName = part('timeZoneName');

  return `${year}/${month}/${day} ${hour}:${minute} ${dayPeriod} ${timeZoneName}`.trim();
}

function pluralUnit(value, unit) {
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `(${[
    pluralUnit(days, 'day'),
    pluralUnit(hours, 'hour'),
    pluralUnit(minutes, 'minute'),
    pluralUnit(seconds, 'second'),
  ].join(', ')})`;
}

function NextAiringCountdown({ nextAiringEpisode, onDismiss }) {
  const airingAt = Number(nextAiringEpisode?.airingAt);
  const episode = Number(nextAiringEpisode?.episode);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!Number.isFinite(airingAt)) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [airingAt]);

  if (!Number.isFinite(airingAt) || airingAt <= 0) return null;

  const releaseMs = airingAt * 1000;
  const remainingMs = releaseMs - now;
  const dateText = formatNextAiringDate(airingAt);

  return (
    <div className="next-airing-strip" aria-live="polite">
      <span className="next-airing-kicker">Next Episode</span>
      {remainingMs <= 0 ? (
        <span className="next-airing-main">Episode will be released soon.</span>
      ) : (
        <>
          <span className="next-airing-main">
            {episode ? `EP ${episode}` : 'Episode'} expected{dateText ? ` ${dateText}` : ''}
          </span>
          <span className="next-airing-countdown">{formatCountdown(remainingMs)}</span>
        </>
      )}
      <button
        type="button"
        className="next-airing-dismiss"
        onClick={onDismiss}
        aria-label="Hide next episode countdown"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M6 6l8 8M14 6l-8 8" />
        </svg>
      </button>
    </div>
  );
}

function getSubtitleId(subtitle) {
  return String(subtitle.index);
}

function getSubtitleById(subtitles, subtitleId) {
  return subtitles.find(sub => getSubtitleId(sub) === subtitleId);
}

function getAudioTrackId(audioTrack) {
  return String(audioTrack.index);
}

function chooseInitialAudioTrack(audioTracks, animeId) {
  if (!audioTracks.length) return 'default';

  const saved = readMediaPreference(AUDIO_PREF_KEY, animeId);
  if (saved && audioTracks.some(track => getAudioTrackId(track) === saved)) return saved;

  const japaneseTrack = audioTracks.find(isJapaneseAudioTrack);
  return japaneseTrack ? getAudioTrackId(japaneseTrack) : 'default';
}

function chooseInitialSubtitle(subtitles, animeId) {
  if (!subtitles.length) return 'off';

  const saved = readMediaPreference(SUBTITLE_PREF_KEY, animeId);
  if (saved === 'off') return 'off';

  const savedSubtitle = subtitles.find(sub => getSubtitleId(sub) === saved);
  if (savedSubtitle) return saved;

  return getSubtitleId(chooseSubtitle(subtitles, null));
}

function applySubtitleSelection(video, selectedSubtitle) {
  if (!video) return;

  video.querySelectorAll('track[data-cultanime-subtitle]').forEach(trackEl => {
    const shouldShow = selectedSubtitle !== 'off' && trackEl.dataset.subtitleId === selectedSubtitle;
    trackEl.default = shouldShow;
    if (trackEl.track) {
      trackEl.track.mode = shouldShow ? 'showing' : 'disabled';
    }
  });
}

function clearSubtitleTracks(video) {
  if (!video) return;
  video.querySelectorAll('track[data-cultanime-subtitle]').forEach(trackEl => trackEl.remove());
  Array.from(video.textTracks || []).forEach(track => {
    track.mode = 'disabled';
  });
}

function installSubtitleTracks(video, subtitles, selectedSubtitle) {
  clearSubtitleTracks(video);

  subtitles.forEach(sub => {
    if (requiresBurnedInSubtitle(sub)) return;

    const track = document.createElement('track');
    const subtitleId = getSubtitleId(sub);

    track.kind = 'subtitles';
    track.label = sub.title || sub.language || `Subtitle ${sub.index}`;
    track.srclang = sub.language || 'und';
    track.src = sub.url;
    track.default = subtitleId === selectedSubtitle;
    track.dataset.cultanimeSubtitle = 'true';
    track.dataset.subtitleId = subtitleId;
    video.appendChild(track);
  });

  applySubtitleSelection(video, selectedSubtitle);
}

function bufferedSecondsAhead(video) {
  const currentTime = Number(video?.currentTime);
  const buffered = video?.buffered;

  if (!buffered || !Number.isFinite(currentTime)) return 0;

  for (let index = 0; index < buffered.length; index += 1) {
    const start = buffered.start(index);
    const end = buffered.end(index);

    if (currentTime >= start - 0.1 && currentTime <= end + 0.1) {
      return Math.max(0, end - currentTime);
    }
  }

  return 0;
}

function postPlayerEvent(payload) {
  try {
    const body = JSON.stringify(payload);

    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon('/api/player-events', blob)) {
        return;
      }
    }

    fetch('/api/player-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Playback logging must never interrupt playback.
  }
}

function postPlaybackSessionAction(payload, { useBeacon = false } = {}) {
  try {
    const body = JSON.stringify(payload);

    if (useBeacon && navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon('/api/playback-session', blob)) {
        return;
      }
    }

    fetch('/api/playback-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: useBeacon,
    }).catch(() => {});
  } catch {
    // Session keep-alive must never interrupt playback.
  }
}

// Jellyfin kills an idle HLS transcode (and deletes its segments) roughly a
// minute after the last playlist/segment request, which is what used to break
// the player after a pause longer than the buffered runway. Pinging the play
// session on an interval keeps the transcode alive, including while paused;
// the stop action ends the transcode as soon as the stream is torn down.
function startPlaybackKeepAlive({ playSessionId, deviceId }) {
  if (!playSessionId || !deviceId) return () => {};

  let stopped = false;

  const sendPing = () => {
    postPlaybackSessionAction({ action: 'ping', playSessionId, deviceId });
  };
  const intervalId = window.setInterval(sendPing, PLAYBACK_KEEPALIVE_INTERVAL_MS);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(intervalId);
    window.removeEventListener('pagehide', stop);
    postPlaybackSessionAction({ action: 'stop', playSessionId, deviceId }, { useBeacon: true });
  };

  window.addEventListener('pagehide', stop);
  sendPing();

  return stop;
}

function queuePlayerEvent(payload) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;

    const saved = window.localStorage.getItem(PENDING_PLAYER_EVENTS_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    const pending = Array.isArray(parsed) ? parsed : [];

    pending.push({
      ...payload,
      queuedAt: new Date().toISOString(),
    });

    window.localStorage.setItem(
      PENDING_PLAYER_EVENTS_KEY,
      JSON.stringify(pending.slice(-MAX_PENDING_PLAYER_EVENTS))
    );
  } catch {
    // Cached diagnostics must never affect playback.
  }
}

function flushQueuedPlayerEvents() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;

    const saved = window.localStorage.getItem(PENDING_PLAYER_EVENTS_KEY);
    if (!saved) return;

    const pending = JSON.parse(saved);
    window.localStorage.removeItem(PENDING_PLAYER_EVENTS_KEY);

    if (!Array.isArray(pending)) return;

    pending.forEach(event => {
      postPlayerEvent({
        ...event,
        replayed: true,
      });
    });
  } catch {
    // Best-effort diagnostic replay.
  }
}

function resetVideoElement(video) {
  if (!video) return;

  try {
    video.pause();
  } catch {
    // Best-effort cleanup.
  }

  clearSubtitleTracks(video);
  video.querySelectorAll('source').forEach(source => source.remove());
  video.removeAttribute('src');

  if ('srcObject' in video && video.srcObject) {
    video.srcObject = null;
  }

  try {
    video.load();
  } catch {
    // Some browsers throw if the media element is already detached.
  }
}

function destroyHlsInstance(hls) {
  if (!hls) return;

  try {
    hls.stopLoad();
  } catch {
    // Best-effort cleanup.
  }

  try {
    hls.detachMedia();
  } catch {
    // Best-effort cleanup.
  }

  try {
    hls.destroy();
  } catch {
    // Best-effort cleanup.
  }
}

// Shared stall/watchdog recovery engine for both playback paths (native HLS
// and hls.js). Owns the stall timers, the health watchdog, the reload budget,
// and the related telemetry. The only per-player differences are the event
// context tag, the reason prefix, and an optional in-place stall recovery
// (hls.js restarts its loader before falling back to a full stream reload).
function createPlaybackRecovery({
  video,
  isActive,
  reportPlayerEvent,
  streamLogContext,
  playerContext = {},
  reasonPrefix = '',
  automaticStreamReloadsRef,
  playbackResumeTimeRef,
  onReload,
  onReloadLimit,
  recoverStallInPlace = null,
}) {
  let stallTimer = null;
  let watchdogTimer = null;
  let reloadBudgetResetTimer = null;
  let sourceReloadRequested = false;
  let deferredReloadRequest = null;
  let stallRecoveryAttempts = 0;
  let hasPlayed = false;
  let userPaused = false;
  let lastUserPlaybackActionAt = 0;
  let lastObservedTime = Number(video.currentTime) || 0;
  let lastPlaybackMovementAt = Date.now();

  const clearStallTimer = () => {
    if (stallTimer) {
      window.clearTimeout(stallTimer);
      stallTimer = null;
    }
  };

  const clearWatchdog = () => {
    if (watchdogTimer) {
      window.clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
  };

  const clearReloadBudgetResetTimer = () => {
    if (reloadBudgetResetTimer) {
      window.clearTimeout(reloadBudgetResetTimer);
      reloadBudgetResetTimer = null;
    }
  };

  const rememberPlaybackPosition = () => {
    const currentTime = Number(video.currentTime);
    if (Number.isFinite(currentTime) && currentTime > 0) {
      playbackResumeTimeRef.current = currentTime;
    }
  };

  const markPlaybackProgress = () => {
    const currentTime = Number(video.currentTime);
    if (!Number.isFinite(currentTime)) return;

    lastObservedTime = currentTime;
    lastPlaybackMovementAt = Date.now();
  };

  const scheduleReloadBudgetReset = () => {
    clearReloadBudgetResetTimer();
    reloadBudgetResetTimer = window.setTimeout(() => {
      if (isActive()) {
        automaticStreamReloadsRef.current = 0;
      }
    }, PLAYBACK_RELOAD_RESET_MS);
  };

  const requestSourceReload = (reason = 'unknown', extra = {}) => {
    if (!isActive() || sourceReloadRequested) return;

    rememberPlaybackPosition();

    if (document.hidden) {
      if (!deferredReloadRequest) {
        reportPlayerEvent('stream-reload-deferred', {
          ...streamLogContext,
          reason,
          ...playerContext,
          ...extra,
        });
      }
      deferredReloadRequest = { reason, extra };
      clearStallTimer();
      return;
    }

    sourceReloadRequested = true;

    if (automaticStreamReloadsRef.current >= MAX_AUTOMATIC_STREAM_RELOADS) {
      reportPlayerEvent('stream-reload-limit', {
        ...streamLogContext,
        reason,
        reloadCount: automaticStreamReloadsRef.current,
        ...playerContext,
        ...extra,
      });
      onReloadLimit();
      return;
    }

    automaticStreamReloadsRef.current += 1;
    reportPlayerEvent('stream-reload', {
      ...streamLogContext,
      reason,
      reloadCount: automaticStreamReloadsRef.current,
      ...playerContext,
      ...extra,
    });
    onReload();
  };

  const scheduleStallRecovery = (trigger = 'stall') => {
    clearStallTimer();
    if (video.ended || video.paused || userPaused || document.hidden) return;

    stallTimer = window.setTimeout(() => {
      if (!isActive() || video.ended || video.paused || userPaused || document.hidden) {
        return;
      }

      if (!video.paused && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA && bufferedSecondsAhead(video) > 0.5) {
        return;
      }

      stallRecoveryAttempts += 1;
      reportPlayerEvent('stall-recovery', {
        ...streamLogContext,
        reason: trigger,
        attempt: stallRecoveryAttempts,
        ...playerContext,
      });
      if (recoverStallInPlace && recoverStallInPlace(stallRecoveryAttempts)) {
        scheduleStallRecovery(trigger);
      } else {
        requestSourceReload(`${reasonPrefix}stall-timeout`, { trigger, attempt: stallRecoveryAttempts });
      }
    }, STALL_RECOVERY_DELAY_MS);
  };

  const markUserPlaybackAction = () => {
    lastUserPlaybackActionAt = Date.now();
  };

  const handleStallEvent = event => {
    if (video.paused || document.hidden) {
      clearStallTimer();
      return;
    }

    if (
      !video.paused
      && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
      && bufferedSecondsAhead(video) > 0.5
    ) {
      return;
    }

    reportPlayerEvent('video-stall-event', {
      ...streamLogContext,
      reason: event.type,
      ...playerContext,
    });
    scheduleStallRecovery(event.type);
  };

  const handleVideoPlay = () => {
    userPaused = false;
  };

  const handleBufferHealthy = () => {
    clearStallTimer();
    markPlaybackProgress();
    scheduleReloadBudgetReset();
    stallRecoveryAttempts = 0;
  };

  const handlePlaybackHealthy = () => {
    hasPlayed = true;
    userPaused = false;
    handleBufferHealthy();
  };

  const handleVisibilityChange = () => {
    if (document.hidden) {
      clearStallTimer();
      rememberPlaybackPosition();
      return;
    }

    markPlaybackProgress();

    if (deferredReloadRequest) {
      const pendingReload = deferredReloadRequest;
      deferredReloadRequest = null;
      requestSourceReload(pendingReload.reason, {
        ...pendingReload.extra,
        trigger: pendingReload.extra?.trigger || 'visibilitychange',
      });
    }
  };

  const handleVideoPause = () => {
    if (!isActive() || video.ended) return;

    clearStallTimer();

    if (Date.now() - lastUserPlaybackActionAt <= USER_PLAYBACK_ACTION_GRACE_MS) {
      userPaused = true;
      reportPlayerEvent('video-paused-by-user', {
        ...streamLogContext,
        ...playerContext,
      });
      return;
    }

    if (!hasPlayed || document.hidden) return;

    stallTimer = window.setTimeout(() => {
      if (isActive() && video.paused && !video.ended && !userPaused && !document.hidden) {
        reportPlayerEvent('unexpected-video-pause', {
          ...streamLogContext,
          ...playerContext,
        });
        requestSourceReload(`${reasonPrefix}unexpected-pause`);
      }
    }, 3000);
  };

  const handleVideoError = () => {
    if (!isActive() || video.ended) return;
    reportPlayerEvent('media-error', {
      ...streamLogContext,
      mediaErrorCode: video.error?.code ?? null,
      reason: video.error?.message || `${reasonPrefix}video-element-error`,
      ...playerContext,
    });
    requestSourceReload(`${reasonPrefix}media-error`, {
      mediaErrorCode: video.error?.code ?? null,
    });
  };

  const checkPlaybackHealth = () => {
    if (!isActive() || !hasPlayed || userPaused || video.ended || video.seeking || document.hidden) {
      markPlaybackProgress();
      return;
    }

    if (video.paused) {
      if (Date.now() - lastPlaybackMovementAt >= PLAYBACK_WATCHDOG_PAUSED_MS) {
        requestSourceReload(`${reasonPrefix}watchdog-paused`, {
          stalledMs: Date.now() - lastPlaybackMovementAt,
        });
      }
      return;
    }

    const currentTime = Number(video.currentTime);
    if (!Number.isFinite(currentTime)) return;

    if (Math.abs(currentTime - lastObservedTime) > 0.2) {
      markPlaybackProgress();
      return;
    }

    if (Date.now() - lastPlaybackMovementAt >= PLAYBACK_WATCHDOG_STUCK_MS) {
      requestSourceReload(`${reasonPrefix}watchdog-stuck`, {
        stalledMs: Date.now() - lastPlaybackMovementAt,
      });
    }
  };

  watchdogTimer = window.setInterval(checkPlaybackHealth, PLAYBACK_WATCHDOG_INTERVAL_MS);

  video.addEventListener('waiting', handleStallEvent);
  video.addEventListener('stalled', handleStallEvent);
  video.addEventListener('pointerdown', markUserPlaybackAction, true);
  video.addEventListener('keydown', markUserPlaybackAction, true);
  video.addEventListener('play', handleVideoPlay);
  video.addEventListener('pause', handleVideoPause);
  video.addEventListener('playing', handlePlaybackHealthy);
  video.addEventListener('canplay', handleBufferHealthy);
  video.addEventListener('timeupdate', markPlaybackProgress);
  video.addEventListener('seeked', markPlaybackProgress);
  video.addEventListener('error', handleVideoError);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  const dispose = () => {
    clearStallTimer();
    clearWatchdog();
    clearReloadBudgetResetTimer();
    video.removeEventListener('waiting', handleStallEvent);
    video.removeEventListener('stalled', handleStallEvent);
    video.removeEventListener('pointerdown', markUserPlaybackAction, true);
    video.removeEventListener('keydown', markUserPlaybackAction, true);
    video.removeEventListener('play', handleVideoPlay);
    video.removeEventListener('pause', handleVideoPause);
    video.removeEventListener('playing', handlePlaybackHealthy);
    video.removeEventListener('canplay', handleBufferHealthy);
    video.removeEventListener('timeupdate', markPlaybackProgress);
    video.removeEventListener('seeked', markPlaybackProgress);
    video.removeEventListener('error', handleVideoError);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };

  return { requestSourceReload, scheduleStallRecovery, scheduleReloadBudgetReset, dispose };
}

// Closes a popover when the user clicks outside of it or presses Escape.
function useDismissable(containerRef, open, setOpen) {
  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event) {
      if (!containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, containerRef, setOpen]);
}

function formatBytes(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return 'Size unavailable';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const decimals = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

function MediaDropdown({ label, value, options, disabled, onChange }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);
  const selectedOption = options.find(option => option.value === value) || options[0];

  useDismissable(dropdownRef, open, setOpen);

  function handleToggle() {
    if (disabled) return;
    setOpen(current => !current);
  }

  function handleOptionSelect(nextValue) {
    onChange(nextValue);
    setOpen(false);
  }

  function handleButtonKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!disabled) setOpen(true);
    }
  }

  return (
    <div className="media-picker">
      <span>{label}</span>
      <div className={`media-dropdown${open ? ' open' : ''}`} ref={dropdownRef}>
        <button
          type="button"
          className="media-dropdown-button"
          onClick={handleToggle}
          onKeyDown={handleButtonKeyDown}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span>{selectedOption?.label || 'Default'}</span>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M5.5 7.5 10 12l4.5-4.5" />
          </svg>
        </button>
        {open && (
          <div className="media-dropdown-menu" role="listbox">
            {options.map(option => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`media-dropdown-option${option.value === value ? ' selected' : ''}`}
                onClick={() => handleOptionSelect(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PlayerMoreMenu({ episodeId, onCopyMpvCommand }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useDismissable(menuRef, open, setOpen);

  function handleCopyClick() {
    onCopyMpvCommand();
    setOpen(false);
  }

  return (
    <div className={`player-more-menu${open ? ' open' : ''}`} ref={menuRef}>
      <button
        type="button"
        className="btn btn-secondary btn-sm player-more-button"
        onClick={() => setOpen(current => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        More
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5.5 7.5 10 12l4.5-4.5" />
        </svg>
      </button>
      {open && (
        <div className="player-more-dropdown" role="menu">
          <a
            href={`/api/mpv/${episodeId}?format=playlist`}
            className="player-more-item"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            MPV playlist
          </a>
          <button
            type="button"
            className="player-more-item"
            role="menuitem"
            onClick={handleCopyClick}
          >
            Copy MPV command
          </button>
        </div>
      )}
    </div>
  );
}

function PlayerDownloadConfirm({ episodeId }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [metadata, setMetadata] = useState(null);
  const [error, setError] = useState('');
  const confirmRef = useRef(null);
  const requestRunRef = useRef(0);
  const downloadHref = `/api/download/${episodeId}`;
  const hasConfirmedSize = Number.isFinite(Number(metadata?.sizeBytes)) && Number(metadata.sizeBytes) > 0;

  useEffect(() => {
    requestRunRef.current += 1;
    setOpen(false);
    setLoading(false);
    setMetadata(null);
    setError('');
  }, [episodeId]);

  useDismissable(confirmRef, open, setOpen);

  async function loadDownloadMetadata() {
    const runId = requestRunRef.current + 1;
    requestRunRef.current = runId;
    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${downloadHref}?metadata=1`, { cache: 'no-store' });
      const data = await res.json();

      if (requestRunRef.current !== runId) return;

      if (!res.ok) {
        throw new Error(data.error || 'Could not check download size');
      }

      if (String(data.episodeId) !== String(episodeId)) {
        throw new Error('The download size did not match this episode');
      }

      if (!Number.isFinite(Number(data.sizeBytes)) || Number(data.sizeBytes) <= 0) {
        throw new Error('Could not confirm this episode file size');
      }

      setMetadata(data);
    } catch (loadError) {
      if (requestRunRef.current !== runId) return;

      console.error('Download metadata failed:', loadError);
      setMetadata(null);
      setError(loadError.message || 'Could not check download size');
    } finally {
      if (requestRunRef.current === runId) {
        setLoading(false);
      }
    }
  }

  function handleToggle() {
    const nextOpen = !open;
    setOpen(nextOpen);

    if (nextOpen && (!metadata || String(metadata.episodeId) !== String(episodeId) || error)) {
      loadDownloadMetadata();
    }
  }

  return (
    <div className={`download-confirm${open ? ' open' : ''}`} ref={confirmRef}>
      <button
        type="button"
        className="btn btn-secondary btn-sm download-confirm-button"
        onClick={handleToggle}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        Download
      </button>
      {open && (
        <div className="download-confirm-popover" role="dialog" aria-label="Confirm episode download">
          <div className="download-confirm-label">Download size</div>
          {loading ? (
            <div className="download-confirm-size muted">Checking...</div>
          ) : error ? (
            <div className="download-confirm-error">{error}</div>
          ) : (
            <>
              <div className="download-confirm-size">{formatBytes(metadata?.sizeBytes)}</div>
              {metadata?.filename && (
                <div className="download-confirm-filename" title={metadata.filename}>
                  {metadata.filename}
                </div>
              )}
            </>
          )}
          <div className="download-confirm-actions">
            {error ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={loadDownloadMetadata}
              >
                Retry
              </button>
            ) : (
              <a
                href={downloadHref}
                className={`btn btn-primary btn-sm${hasConfirmedSize ? '' : ' disabled'}`}
                aria-disabled={!hasConfirmedSize}
                onClick={(event) => {
                  if (!hasConfirmedSize) {
                    event.preventDefault();
                    return;
                  }
                  setOpen(false);
                }}
              >
                Download now
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function WatchPage() {
  const { animeId, ep } = useParams();
  const router = useRouter();
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const saveInterval = useRef(null);
  const streamRunRef = useRef(0);
  const playbackResumeTimeRef = useRef(0);
  const automaticStreamReloadsRef = useRef(0);
  const [anime, setAnime] = useState(null);
  const [currentEp, setCurrentEp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [streamError, setStreamError] = useState(null);
  const [streamLoading, setStreamLoading] = useState(false);
  const [streamReloadKey, setStreamReloadKey] = useState(0);
  const [audioTracks, setAudioTracks] = useState([]);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState('default');
  const [subtitles, setSubtitles] = useState([]);
  const [selectedSubtitle, setSelectedSubtitle] = useState('auto');
  const [subtitleMode, setSubtitleMode] = useState('soft');
  const [mpvStatus, setMpvStatus] = useState('');
  const [inWatchlist, setInWatchlist] = useState(false);
  const [watchlistBusy, setWatchlistBusy] = useState(false);
  const [nextAiringHidden, setNextAiringHidden] = useState(false);

  const animeIdNumber = Number.parseInt(animeId, 10);
  const episodeNum = parseInt(ep);
  const audioTrackKey = selectedAudioTrack === 'default' ? 'default-audio' : selectedAudioTrack;
  const burnedSubtitleKey = subtitleMode === 'burned' ? selectedSubtitle : 'soft';
  const playerDomKey = currentEp
    ? `${currentEp.id}-${audioTrackKey}-${subtitleMode}-${burnedSubtitleKey}`
    : 'empty-player';

  const teardownPlayer = useCallback((ownedVideo) => {
    const video = ownedVideo || videoRef.current;

    if (video) {
      try {
        video.pause();
      } catch {
        // Best-effort cleanup.
      }
    }
    destroyHlsInstance(hlsRef.current);
    hlsRef.current = null;
    resetVideoElement(video || videoRef.current);
  }, []);

  useEffect(() => {
    setSelectedAudioTrack(readMediaPreference(AUDIO_PREF_KEY, animeId) || 'default');
    setSelectedSubtitle(readMediaPreference(SUBTITLE_PREF_KEY, animeId) || 'auto');
    setSubtitleMode('soft');
  }, [animeId]);

  useEffect(() => {
    setNextAiringHidden(readNextAiringHidden());

    function clearHiddenPreference() {
      writeNextAiringHidden(false);
    }

    function handleDocumentClick(event) {
      const link = event.target.closest?.('a[href]');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href || href.startsWith('#')) return;

      let url;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }

      if (url.origin === window.location.origin && !url.pathname.startsWith('/watch/')) {
        clearHiddenPreference();
      }
    }

    window.addEventListener('beforeunload', clearHiddenPreference);
    document.addEventListener('click', handleDocumentClick, true);

    return () => {
      window.removeEventListener('beforeunload', clearHiddenPreference);
      document.removeEventListener('click', handleDocumentClick, true);
    };
  }, []);

  function handleNextAiringDismiss() {
    setNextAiringHidden(true);
    writeNextAiringHidden(true);
  }

  const rememberCurrentPlaybackPosition = useCallback(() => {
    const currentTime = Number(videoRef.current?.currentTime);
    if (Number.isFinite(currentTime) && currentTime > 0) {
      playbackResumeTimeRef.current = currentTime;
    }
  }, []);

  const retryPlayback = useCallback(() => {
    rememberCurrentPlaybackPosition();
    const currentTime = Number(videoRef.current?.currentTime);
    postPlayerEvent({
      event: 'manual-retry',
      animeId,
      episodeId: currentEp?.id ?? null,
      episodeNumber: currentEp?.episode_number ?? null,
      currentTime,
      bufferAhead: videoRef.current ? bufferedSecondsAhead(videoRef.current) : null,
      readyState: videoRef.current?.readyState ?? null,
      networkState: videoRef.current?.networkState ?? null,
      paused: videoRef.current?.paused ?? null,
      ended: videoRef.current?.ended ?? null,
    });
    automaticStreamReloadsRef.current = 0;
    setStreamError(null);
    setStreamReloadKey(value => value + 1);
  }, [animeId, currentEp, rememberCurrentPlaybackPosition]);

  const buildPlayerEventPayload = useCallback((event, details = {}) => {
    const video = videoRef.current;

    return {
      event,
      animeId,
      episodeId: currentEp?.id ?? null,
      episodeNumber: currentEp?.episode_number ?? null,
      clientAt: new Date().toISOString(),
      online: typeof navigator !== 'undefined' ? navigator.onLine : null,
      pageHidden: typeof document !== 'undefined' ? document.hidden : null,
      visibilityState: typeof document !== 'undefined' ? document.visibilityState : null,
      currentTime: video?.currentTime ?? null,
      duration: video?.duration ?? null,
      bufferAhead: video ? bufferedSecondsAhead(video) : null,
      readyState: video?.readyState ?? null,
      networkState: video?.networkState ?? null,
      paused: video?.paused ?? null,
      ended: video?.ended ?? null,
      ...details,
    };
  }, [animeId, currentEp]);

  const reportPlayerEvent = useCallback((event, details = {}) => {
    postPlayerEvent(buildPlayerEventPayload(event, details));
  }, [buildPlayerEventPayload]);

  // Load anime data
  useEffect(() => {
    let active = true;

    setLoading(true);
    setCurrentEp(null);
    setStreamError(null);
    setAudioTracks([]);
    setSubtitles([]);
    playbackResumeTimeRef.current = 0;
    automaticStreamReloadsRef.current = 0;

    async function load() {
      try {
        const res = await fetch(`/api/anime/${animeId}`);
        const data = await res.json();
        if (!active) return;
        setAnime(data);
        const episodes = data.episodes || [];
        const episode = episodes.find(e => e.episode_number === episodeNum);

        // Watch buttons always link to episode "1", but some libraries number
        // a season's files as a continuation (e.g. 13-25). Whatever this site
        // lists first for the entry is its episode 1, so play that instead.
        if (!episode && episodeNum === 1 && episodes.length > 0) {
          const firstEpisode = episodes.reduce((lowest, e) => (
            e.episode_number < lowest.episode_number ? e : lowest
          ));
          router.replace(`/watch/${animeId}/${firstEpisode.episode_number}`);
          return; // keep the loading skeleton up until the redirect lands
        }

        if (episode) {
          try {
            const historyRes = await fetch(`/api/history?episode_id=${episode.id}`, { cache: 'no-store' });
            const historyData = await historyRes.json();
            if (!active) return;
            const resumeAt = resumeSecondsFromHistory(historyData.history?.[0]);
            if (resumeAt > 0) {
              playbackResumeTimeRef.current = resumeAt;
            }
          } catch {
            // Resume is optional; playback can still start from the beginning.
          }
        }

        setCurrentEp(episode);
      } catch (e) { console.error(e); }
      if (active) {
        setLoading(false);
      }
    }
    load();

    return () => {
      active = false;
    };
  }, [animeId, episodeNum]);

  useEffect(() => {
    let active = true;

    async function loadWatchlistState() {
      try {
        const res = await fetch('/api/watchlist');
        const data = await res.json();
        if (!active || !res.ok) return;

        setInWatchlist(Boolean(data.watchlist?.some(item => item.episode_id === currentEp.id)));
      } catch (error) {
        console.error('Watchlist state failed:', error);
      }
    }

    if (Number.isFinite(animeIdNumber) && currentEp?.id) {
      loadWatchlistState();
    }

    return () => {
      active = false;
    };
  }, [animeIdNumber, currentEp?.id]);

  useEffect(() => {
    const handlePageExit = () => {
      teardownPlayer();
    };

    window.addEventListener('pagehide', handlePageExit);
    window.addEventListener('beforeunload', handlePageExit);

    return () => {
      window.removeEventListener('pagehide', handlePageExit);
      window.removeEventListener('beforeunload', handlePageExit);
    };
  }, [teardownPlayer]);

  // Set up HLS streaming via Jellyfin
  useEffect(() => {
    if (!currentEp) {
      teardownPlayer();
      setStreamLoading(false);
      return;
    }

    const streamRunId = streamRunRef.current + 1;
    streamRunRef.current = streamRunId;
    const abortController = new AbortController();
    const ownedVideo = videoRef.current;
    let active = true;
    let removeVideoRecoveryListeners = () => {};
    let stopPlaybackKeepAlive = () => {};
    const isActive = () => active
      && streamRunRef.current === streamRunId
      && !abortController.signal.aborted;

    teardownPlayer(ownedVideo);
    setStreamError(null);
    setStreamLoading(true);

    async function initStream() {
      try {
        // Fetch the hls.js chunk in parallel with the stream negotiation.
        const hlsLibraryPromise = loadHls();
        const streamParams = new URLSearchParams();
        if (selectedAudioTrack !== 'default') {
          streamParams.set('audioStreamIndex', selectedAudioTrack);
        }
        if (selectedSubtitle === 'off') {
          streamParams.set('subtitleMode', 'off');
        } else if (subtitleMode === 'burned' && selectedSubtitle !== 'off' && selectedSubtitle !== 'auto') {
          streamParams.set('subtitleMode', 'burned');
          streamParams.set('subtitleStreamIndex', selectedSubtitle);
        } else if (selectedSubtitle !== 'auto') {
          streamParams.set('subtitleMode', 'soft');
          streamParams.set('subtitleStreamIndex', selectedSubtitle);
        }
        const streamQuery = streamParams.toString();
        const res = await fetch(`/api/stream/${currentEp.id}${streamQuery ? `?${streamQuery}` : ''}`, {
          signal: abortController.signal,
        });
        let data = null;
        let responseParseError = null;

        try {
          data = await res.json();
        } catch (parseError) {
          responseParseError = parseError.message || 'stream-response-json-error';
        }

        if (!isActive()) return;

        if (!res.ok || !data) {
          const reason = data?.error || responseParseError || 'Failed to load stream';
          reportPlayerEvent('stream-request-failed', {
            responseCode: res.status,
            reason,
          });
          setStreamError(data?.error || 'Failed to load stream');
          return;
        }

        const video = videoRef.current;
        if (!video) return;

        const resumeAt = playbackResumeTimeRef.current;
        const restorePlaybackPosition = () => {
          if (!Number.isFinite(resumeAt) || resumeAt <= 0) return;
          const maxTime = Number.isFinite(video.duration) && video.duration > 0
            ? Math.max(0, video.duration - 0.25)
            : resumeAt;
          video.currentTime = Math.min(resumeAt, maxTime);
          playbackResumeTimeRef.current = 0;
        };
        video.addEventListener('loadedmetadata', restorePlaybackPosition, { once: true });
        video.addEventListener('canplay', restorePlaybackPosition, { once: true });
        removeVideoRecoveryListeners = () => {
          video.removeEventListener('loadedmetadata', restorePlaybackPosition);
          video.removeEventListener('canplay', restorePlaybackPosition);
        };

        const hlsUrl = data.hlsUrl;
        const audioTrackOptions = Array.isArray(data.audioTracks) ? data.audioTracks : [];
        const subtitleTracks = Array.isArray(data.subtitles) ? data.subtitles : [];
        const streamLogContext = {
          streamSessionId: data.streamSessionId,
          delivery: data.delivery,
          videoBitrate: data.videoBitrate,
          audioStreamIndex: data.audioStreamIndex,
          subtitleMode: data.subtitleMode,
        };
        const selectedAudioExists = selectedAudioTrack !== 'default'
          && audioTrackOptions.some(track => getAudioTrackId(track) === selectedAudioTrack);
        const initialAudioTrack = selectedAudioTrack === 'default'
          ? chooseInitialAudioTrack(audioTrackOptions, animeId)
          : selectedAudioExists
            ? selectedAudioTrack
            : 'default';
        const isBurnedInStream = data.subtitleMode === 'burned';
        const isSubtitleOffStream = data.subtitleMode === 'off';
        const selectedSubtitleExists = subtitleTracks.some(sub => getSubtitleId(sub) === selectedSubtitle);
        const initialSubtitle = data.burnedInSubtitleIndex !== null && data.burnedInSubtitleIndex !== undefined
          ? String(data.burnedInSubtitleIndex)
          : isSubtitleOffStream
            ? 'off'
          : selectedSubtitle !== 'auto' && selectedSubtitleExists
            ? selectedSubtitle
            : chooseInitialSubtitle(subtitleTracks, animeId);
        const initialSubtitleTrack = getSubtitleById(subtitleTracks, initialSubtitle);

        flushQueuedPlayerEvents();
        reportPlayerEvent('stream-ready', {
          ...streamLogContext,
          audioTrackCount: audioTrackOptions.length,
          subtitleCount: subtitleTracks.length,
          directAvailable: Boolean(data.directUrl),
          burnedInSubtitleIndex: data.burnedInSubtitleIndex,
        });

        setAudioTracks(audioTrackOptions);
        if (initialAudioTrack !== selectedAudioTrack) {
          setSelectedAudioTrack(initialAudioTrack);
          return;
        }

        setSubtitles(subtitleTracks);
        setSelectedSubtitle(initialSubtitle);
        if (!isBurnedInStream && requiresBurnedInSubtitle(initialSubtitleTrack)) {
          clearSubtitleTracks(video);
          setSubtitleMode('burned');
          return;
        }
        setSubtitleMode(isBurnedInStream ? 'burned' : 'soft');
        if (isBurnedInStream) {
          clearSubtitleTracks(video);
        } else {
          installSubtitleTracks(video, subtitleTracks, initialSubtitle);
        }

        stopPlaybackKeepAlive = startPlaybackKeepAlive({
          playSessionId: data.streamSessionId,
          deviceId: data.deviceId,
        });

        const handleStreamReload = () => {
          setStreamLoading(true);
          setStreamReloadKey(value => value + 1);
        };
        const handleStreamReloadLimit = () => {
          setStreamError('Playback lost its connection. Retry to continue from the same place.');
          stopPlaybackKeepAlive();
          teardownPlayer(video);
        };

        const Hls = await hlsLibraryPromise;
        if (!isActive()) return;

        // Prefer hls.js wherever MSE is available: Chromium's built-in HLS
        // demuxer rejects transcoded segments whose timestamps are slightly
        // out of order (CHUNK_DEMUXER_ERROR_APPEND_FAILED), while hls.js
        // remuxes and tolerates them. Native HLS remains the fallback for
        // browsers without MSE (iOS Safari).
        if (!Hls.isSupported() && video.canPlayType('application/vnd.apple.mpegurl')) {
          const recovery = createPlaybackRecovery({
            video,
            isActive,
            reportPlayerEvent,
            streamLogContext,
            playerContext: { player: 'native-hls' },
            reasonPrefix: 'native-',
            automaticStreamReloadsRef,
            playbackResumeTimeRef,
            onReload: handleStreamReload,
            onReloadLimit: handleStreamReloadLimit,
          });
          removeVideoRecoveryListeners = () => {
            video.removeEventListener('loadedmetadata', restorePlaybackPosition);
            video.removeEventListener('canplay', restorePlaybackPosition);
            recovery.dispose();
          };

          video.src = hlsUrl;
          applySubtitleSelection(video, isBurnedInStream ? 'off' : initialSubtitle);
          reportPlayerEvent('native-hls-start', {
            ...streamLogContext,
            player: 'native-hls',
          });
          if (isActive()) {
            video.play().catch(() => {});
          }
          return;
        }

        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: false,
            maxBufferLength: 60,
            maxMaxBufferLength: 120,
            backBufferLength: 30,
            startLevel: -1,
            detectStallWithCurrentTimeMs: 1000,
            highBufferWatchdogPeriod: 1,
            nudgeMaxRetry: 5,
            renderTextTracksNatively: true,
            manifestLoadingMaxRetry: 4,
            manifestLoadingRetryDelay: 1000,
            levelLoadingMaxRetry: 4,
            levelLoadingRetryDelay: 1000,
            fragLoadingMaxRetry: 6,
            fragLoadingRetryDelay: 1000,
            fragLoadingMaxRetryTimeout: 16000,
          });
          reportPlayerEvent('hls-created', streamLogContext);
          let networkRecoveryAttempts = 0;
          const recovery = createPlaybackRecovery({
            video,
            isActive,
            reportPlayerEvent,
            streamLogContext,
            automaticStreamReloadsRef,
            playbackResumeTimeRef,
            onReload: handleStreamReload,
            onReloadLimit: handleStreamReloadLimit,
            recoverStallInPlace: attempt => {
              if (attempt > 2) return false;
              hls.startLoad(Math.max(0, video.currentTime - 0.25));
              return true;
            },
          });
          removeVideoRecoveryListeners = () => {
            video.removeEventListener('loadedmetadata', restorePlaybackPosition);
            video.removeEventListener('canplay', restorePlaybackPosition);
            recovery.dispose();
          };

          hlsRef.current = hls;

          hls.on(Hls.Events.MEDIA_ATTACHED, () => {
            if (!isActive()) return;
            reportPlayerEvent('hls-media-attached', streamLogContext);
          });

          hls.on(Hls.Events.MANIFEST_PARSED, (event, manifestData) => {
            if (!isActive()) return;
            const hlsLevels = (manifestData.levels || []).map((level, index) => ({
              index,
              height: level.height,
              bitrate: level.bitrate,
            }));
            reportPlayerEvent('hls-manifest', {
              ...streamLogContext,
              hlsLevels,
              hlsLevel: hls.currentLevel,
              hlsAutoLevelEnabled: hls.autoLevelEnabled,
            });
            restorePlaybackPosition();
            video.play().catch(() => {});
          });

          hls.on(Hls.Events.FRAG_LOADED, () => {
            networkRecoveryAttempts = 0;
            recovery.scheduleReloadBudgetReset();
          });

          hls.on(Hls.Events.ERROR, (event, errorData) => {
            if (!isActive()) return;

            const hlsErrorContext = {
              ...streamLogContext,
              hlsType: errorData.type,
              hlsDetails: errorData.details,
              hlsFatal: Boolean(errorData.fatal),
              hlsLevel: errorData.level ?? errorData.frag?.level ?? hls.currentLevel,
              hlsAutoLevelEnabled: hls.autoLevelEnabled,
              responseCode: errorData.response?.code ?? null,
            };
            reportPlayerEvent(errorData.fatal ? 'hls-fatal-error' : 'hls-error', hlsErrorContext);

            const recoverableNetworkError = [
              Hls.ErrorDetails.FRAG_LOAD_ERROR,
              Hls.ErrorDetails.FRAG_LOAD_TIMEOUT,
              Hls.ErrorDetails.LEVEL_LOAD_ERROR,
              Hls.ErrorDetails.LEVEL_LOAD_TIMEOUT,
              Hls.ErrorDetails.KEY_LOAD_ERROR,
              Hls.ErrorDetails.KEY_LOAD_TIMEOUT,
              Hls.ErrorDetails.AUDIO_TRACK_LOAD_ERROR,
              Hls.ErrorDetails.AUDIO_TRACK_LOAD_TIMEOUT,
              Hls.ErrorDetails.SUBTITLE_LOAD_ERROR,
              Hls.ErrorDetails.SUBTITLE_TRACK_LOAD_TIMEOUT,
            ].includes(errorData.details);
            const recoverableStallError = [
              Hls.ErrorDetails.BUFFER_STALLED_ERROR,
              Hls.ErrorDetails.BUFFER_NUDGE_ON_STALL,
              Hls.ErrorDetails.BUFFER_SEEK_OVER_HOLE,
            ].includes(errorData.details);
            const recoverableMediaError = [
              Hls.ErrorDetails.BUFFER_APPEND_ERROR,
              Hls.ErrorDetails.BUFFER_APPENDING_ERROR,
              Hls.ErrorDetails.BUFFER_FULL_ERROR,
              Hls.ErrorDetails.FRAG_PARSING_ERROR,
            ].includes(errorData.details);

            if (!errorData.fatal) {
              if (recoverableStallError) {
                recovery.scheduleStallRecovery();
                return;
              }

              if (recoverableNetworkError) {
                networkRecoveryAttempts += 1;
                if (networkRecoveryAttempts <= 3) {
                  window.setTimeout(() => {
                    if (isActive()) hls.startLoad(Math.max(0, video.currentTime - 0.25));
                  }, networkRecoveryAttempts * 1000);
                } else {
                  recovery.requestSourceReload('hls-network-error', hlsErrorContext);
                }
                return;
              }

              if (recoverableMediaError) {
                hls.recoverMediaError();
                recovery.scheduleStallRecovery();
              }
              return;
            }

            console.error('HLS fatal error:', errorData);
            switch (errorData.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                networkRecoveryAttempts += 1;
                if (networkRecoveryAttempts <= 2) {
                  window.setTimeout(() => {
                    if (isActive()) hls.startLoad(Math.max(0, video.currentTime - 0.25));
                  }, networkRecoveryAttempts * 1000);
                } else {
                  recovery.requestSourceReload('hls-fatal-network-error', hlsErrorContext);
                }
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                stopPlaybackKeepAlive();
                teardownPlayer();
                setStreamError('Playback error. The video could not be loaded.');
                break;
            }
          });

          reportPlayerEvent('hls-load-source', streamLogContext);
          hls.loadSource(hlsUrl);
          hls.attachMedia(video);
          applySubtitleSelection(video, isBurnedInStream ? 'off' : initialSubtitle);
        } else if (data.directUrl) {
          video.src = data.directUrl;
          applySubtitleSelection(video, isBurnedInStream ? 'off' : initialSubtitle);
          reportPlayerEvent('direct-video-start', streamLogContext);
          if (isActive()) {
            video.play().catch(() => {});
          }
        } else {
          stopPlaybackKeepAlive();
          reportPlayerEvent('stream-unsupported', {
            streamSessionId: data.streamSessionId,
            delivery: data.delivery,
            subtitleMode: data.subtitleMode,
          });
          setStreamError('This browser cannot play the selected stream.');
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        if (!isActive()) return;

        console.error('Stream init error:', err);
        stopPlaybackKeepAlive();
        const failureEvent = buildPlayerEventPayload('stream-init-error', {
          reason: err.message || 'stream-init-error',
        });
        queuePlayerEvent(failureEvent);
        postPlayerEvent(failureEvent);
        setStreamError('Failed to connect to streaming server.');
      } finally {
        if (isActive()) {
          setStreamLoading(false);
        }
      }
    }

    initStream();

    return () => {
      active = false;
      abortController.abort();
      rememberCurrentPlaybackPosition();
      persistWatchProgress({
        episodeId: currentEp.id,
        animeId,
        currentTime: Number(ownedVideo?.currentTime),
        duration: ownedVideo?.duration || 0,
        useBeacon: true,
      });
      removeVideoRecoveryListeners();
      stopPlaybackKeepAlive();
      teardownPlayer(ownedVideo);
    };
  }, [currentEp, selectedAudioTrack, subtitleMode, burnedSubtitleKey, teardownPlayer, animeId, streamReloadKey, reportPlayerEvent, buildPlayerEventPayload, rememberCurrentPlaybackPosition]);

  useEffect(() => {
    const softSubtitle = subtitleMode === 'burned' ? 'off' : selectedSubtitle;
    applySubtitleSelection(videoRef.current, softSubtitle);
  }, [selectedSubtitle, subtitleMode]);

  function handleSubtitleChange(nextSubtitle) {
    if (streamLoading) return;

    rememberCurrentPlaybackPosition();

    const nextSubtitleTrack = getSubtitleById(subtitles, nextSubtitle);
    const nextMode = nextSubtitle === 'off'
      ? 'soft'
      : requiresBurnedInSubtitle(nextSubtitleTrack)
        ? 'burned'
        : 'soft';

    setSelectedSubtitle(nextSubtitle);
    if (nextSubtitle === 'off') {
      setSubtitleMode('soft');
      clearSubtitleTracks(videoRef.current);
    } else if (nextMode !== subtitleMode) {
      setSubtitleMode(nextMode);
    }
    applySubtitleSelection(videoRef.current, nextMode === 'burned' ? 'off' : nextSubtitle);

    writeMediaPreference(SUBTITLE_PREF_KEY, animeId, nextSubtitle);
  }

  function handleAudioTrackChange(nextAudioTrack) {
    if (streamLoading) return;

    rememberCurrentPlaybackPosition();
    setSelectedAudioTrack(nextAudioTrack);

    if (nextAudioTrack === 'default') {
      removeMediaPreference(AUDIO_PREF_KEY, animeId);
    } else {
      writeMediaPreference(AUDIO_PREF_KEY, animeId, nextAudioTrack);
    }
  }

  const saveProgress = useCallback(async (options) => {
    const video = videoRef.current;
    if (!video || !currentEp) return;
    persistWatchProgress({
      episodeId: currentEp.id,
      animeId,
      currentTime: Number(video.currentTime),
      duration: video.duration || 0,
      useBeacon: options?.useBeacon === true,
    });
  }, [currentEp, animeId]);

  async function handleCopyMpvCommand() {
    if (!currentEp) return;

    setMpvStatus('Preparing MPV command...');

    try {
      const res = await fetch(`/api/mpv/${currentEp.id}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Could not build MPV command');
      }

      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard access is unavailable in this browser');
      }

      await navigator.clipboard.writeText(data.command);
      setMpvStatus('MPV command copied');
      window.setTimeout(() => setMpvStatus(''), 3000);
    } catch (error) {
      console.error('MPV command copy failed:', error);
      setMpvStatus('Could not copy MPV command');
    }
  }

  async function handleWatchlistToggle() {
    if (!Number.isFinite(animeIdNumber) || !currentEp?.id || watchlistBusy) return;

    const nextWatchlistState = !inWatchlist;
    setWatchlistBusy(true);

    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          anime_id: animeIdNumber,
          episode_id: currentEp.id,
          action: nextWatchlistState ? 'add' : 'remove',
        }),
      });

      if (!res.ok) {
        throw new Error('Watchlist update failed');
      }

      setInWatchlist(nextWatchlistState);
    } catch (error) {
      console.error('Watchlist update failed:', error);
    } finally {
      setWatchlistBusy(false);
    }
  }

  useEffect(() => {
    const persist = () => saveProgress({ useBeacon: true });
    const handleVisibilityChange = () => {
      if (document.hidden) persist();
    };

    // Capture phase so the timestamp is saved before the player teardown
    // listener (registered earlier) resets the video element.
    window.addEventListener('pagehide', persist, true);
    window.addEventListener('beforeunload', persist, true);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    saveInterval.current = setInterval(() => saveProgress(), 15000);

    return () => {
      clearInterval(saveInterval.current);
      window.removeEventListener('pagehide', persist, true);
      window.removeEventListener('beforeunload', persist, true);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [saveProgress]);



  const nextEp = anime?.episodes?.find(e => e.episode_number === episodeNum + 1);
  const prevEp = anime?.episodes?.find(e => e.episode_number === episodeNum - 1);
  const currentEpMeta = currentEp ? episodeMetaText(currentEp) : '';
  const episodeTotal = episodeTotalFor(anime);

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
      <div className="skeleton" style={{ width: '100%', maxWidth: '900px', aspectRatio: '16/9' }} />
    </div>;
  }

  if (!anime || !currentEp) {
    return <div className="empty-state" style={{ paddingTop: '8rem' }}>
      <h3>Episode not found</h3>
      <Link href={`/anime/${animeId}`} className="btn btn-primary" style={{ marginTop: '1rem' }}>Back to Anime</Link>
    </div>;
  }

  return (
    <div className="player-page">
      <div className="player-main">
        <div className="video-container">
          {streamError ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              width: '100%', height: '100%', background: 'var(--bg-secondary)',
              color: 'var(--text-secondary)', gap: '1rem', padding: '2rem', textAlign: 'center',
              borderRadius: 'var(--radius)',
            }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p style={{ fontSize: '1.1rem', fontWeight: 500 }}>{streamError}</p>
              <p style={{ fontSize: '0.85rem', opacity: 0.7 }}>
                The player will resume from the same place after reconnecting.
              </p>
              <button type="button" className="btn btn-primary btn-sm" onClick={retryPlayback} disabled={streamLoading}>
                {streamLoading ? 'Reconnecting...' : 'Retry playback'}
              </button>
            </div>
          ) : (
            <>
              <video
                key={playerDomKey}
                ref={videoRef}
                autoPlay
                controls
                // Without this, iPhone Safari force-fullscreens the video on
                // play, and the stall watchdog's auto-recovery keeps pulling
                // the user back into the native player after they exit it.
                playsInline
                preload="none"
                onEnded={() => { saveProgress(); if (nextEp) router.push(`/watch/${animeId}/${nextEp.episode_number}`); }}
                onPause={saveProgress}
                crossOrigin="anonymous"
              />
            </>
          )}
        </div>
        <div className="player-info">
          <div className="player-info-header">
            <div className="player-title-block">
              <Link href={`/anime/${animeId}`} className="player-back-link">
            ← {anime.title}
              </Link>
              <div className="player-title-row">
                <h1>{currentEp.title || `Episode ${currentEp.episode_number}`}</h1>
                <span className="episode-label">Episode {currentEp.episode_number}{episodeTotal ? ` of ${episodeTotal}` : ''}</span>
              </div>
            </div>
            <div className="player-header-aside">
              {!nextAiringHidden && (
                <NextAiringCountdown
                  nextAiringEpisode={anime.next_airing_episode}
                  onDismiss={handleNextAiringDismiss}
                />
              )}
              {(audioTracks.length > 1 || subtitles.length > 0) && (
                <div className="media-controls">
                  {audioTracks.length > 1 && (
                    <MediaDropdown
                      label="Audio"
                      value={selectedAudioTrack}
                      disabled={streamLoading}
                      onChange={handleAudioTrackChange}
                      options={[
                        { value: 'default', label: 'Default' },
                        ...audioTracks.map(track => ({
                          value: getAudioTrackId(track),
                          label: track.title,
                        })),
                      ]}
                    />
                  )}
                  {subtitles.length > 0 && (
                    <MediaDropdown
                      label="Subtitles"
                      value={selectedSubtitle}
                      disabled={streamLoading}
                      onChange={handleSubtitleChange}
                      options={[
                        { value: 'off', label: 'Off' },
                        ...subtitles.map(sub => ({
                          value: getSubtitleId(sub),
                          label: sub.title,
                        })),
                      ]}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="player-episode-summary">
            <img
              className="player-episode-thumbnail"
              src={episodeThumbnailUrl(currentEp, 320, 180)}
              alt=""
            />
            <div className="player-episode-summary-copy">
              <div className="player-episode-summary-header">
                <div className="now-playing-badge">Now Playing</div>
                <button
                  type="button"
                  className={`watchlist-icon-button${inWatchlist ? ' active' : ''}`}
                  onClick={handleWatchlistToggle}
                  disabled={watchlistBusy}
                  aria-label={inWatchlist ? 'Remove this episode from Watchlist' : 'Save this episode to Watchlist'}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 4.75C6 3.78 6.78 3 7.75 3h8.5C17.22 3 18 3.78 18 4.75v15.5l-6-3.6-6 3.6V4.75Z" />
                  </svg>
                  <span className="watchlist-tooltip">
                    {inWatchlist ? 'Remove this episode' : 'Save this episode'}
                  </span>
                </button>
              </div>
              {currentEpMeta && <div className="player-episode-summary-meta">Released on {currentEpMeta}</div>}
              {currentEp.overview ? (
                <p>{currentEp.overview}</p>
              ) : (
                <p className="muted">No episode summary available yet.</p>
              )}
            </div>
          </div>
          <div className="player-nav" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="player-nav-buttons">
              {prevEp && (
              <Link href={`/watch/${animeId}/${prevEp.episode_number}`} className="btn btn-secondary btn-sm">← Previous</Link>
            )}
              {nextEp && (
              <Link href={`/watch/${animeId}/${nextEp.episode_number}`} className="btn btn-primary btn-sm">Next →</Link>
              )}
            </div>
            <div className="external-player-actions">
              <PlayerDownloadConfirm episodeId={currentEp.id} />
              <PlayerMoreMenu episodeId={currentEp.id} onCopyMpvCommand={handleCopyMpvCommand} />
              {mpvStatus && <span className="external-player-status">{mpvStatus}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="player-sidebar">
        <h3>Episodes</h3>
        <div className="episode-grid" style={{ padding: '0' }}>
          {anime.episodes.map(e => {
            const meta = episodeMetaText(e);

            return (
            <Link key={e.id} href={`/watch/${animeId}/${e.episode_number}`}
              className={`episode-item player-episode-item ${e.episode_number === episodeNum ? 'active' : ''}`}>
              <img
                className="episode-sidebar-thumbnail"
                src={episodeThumbnailUrl(e, 160, 90)}
                alt=""
                loading="lazy"
              />
              <span className="episode-number">{e.episode_number}</span>
                <span className="episode-copy player-episode-copy">
                  <span className="episode-title">{e.title || `Episode ${e.episode_number}`}</span>
                  {e.episode_number === episodeNum && <span className="now-playing-badge sidebar-now-playing">Now Playing</span>}
                  {meta && <span className="episode-meta">{meta}</span>}
                </span>
              {e.episode_number === episodeNum && <span style={{ color: 'var(--accent)' }}><PlayIcon /></span>}
            </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
