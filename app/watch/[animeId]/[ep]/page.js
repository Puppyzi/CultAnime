'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import Hls from 'hls.js';

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

function mediaText(track) {
  return `${track?.language || ''} ${track?.title || ''}`.toLowerCase();
}

function isJapaneseAudioTrack(track) {
  const text = mediaText(track);
  return text.includes('jpn') || text.includes('japanese') || text.includes('ja ');
}

function isEnglishSubtitle(subtitle) {
  const text = mediaText(subtitle);
  return text.includes('eng') || text.includes('english') || text.includes(' en ');
}

function isSignsOnlySubtitle(subtitle) {
  const text = mediaText(subtitle);
  return subtitle?.isForced
    || text.includes('forced')
    || text.includes('signs')
    || text.includes('songs');
}

function isFullSubtitle(subtitle) {
  const text = mediaText(subtitle);
  return text.includes('full') || text.includes('dialog') || text.includes('dialogue');
}

function chooseInitialAudioTrack(audioTracks, animeId) {
  if (!audioTracks.length) return 'default';

  const saved = readMediaPreference(AUDIO_PREF_KEY, animeId);
  if (saved && audioTracks.some(track => getAudioTrackId(track) === saved)) return saved;

  const japaneseTrack = audioTracks.find(isJapaneseAudioTrack);
  return japaneseTrack ? getAudioTrackId(japaneseTrack) : 'default';
}

function requiresBurnedInSubtitle(subtitle) {
  const codec = (subtitle?.codec || '').toLowerCase();
  return codec === 'ass' || codec === 'ssa';
}

function chooseInitialSubtitle(subtitles, animeId) {
  if (!subtitles.length) return 'off';

  const saved = readMediaPreference(SUBTITLE_PREF_KEY, animeId);
  if (saved === 'off') return 'off';

  const savedSubtitle = subtitles.find(sub => getSubtitleId(sub) === saved);
  if (savedSubtitle) return saved;

  const preferredSubtitle = subtitles.find(sub => isEnglishSubtitle(sub) && isFullSubtitle(sub) && !isSignsOnlySubtitle(sub))
    || subtitles.find(sub => isEnglishSubtitle(sub) && !isSignsOnlySubtitle(sub))
    || subtitles.find(sub => isFullSubtitle(sub) && !isSignsOnlySubtitle(sub))
    || subtitles.find(sub => isEnglishSubtitle(sub));

  const defaultSubtitle = preferredSubtitle
    || subtitles.find(sub => sub.isDefault)
    || subtitles[0];

  return getSubtitleId(defaultSubtitle);
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
      navigator.sendBeacon('/api/player-events', blob);
      return;
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

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event) {
      if (!dropdownRef.current?.contains(event.target)) {
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
  }, [open]);

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

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event) {
      if (!menuRef.current?.contains(event.target)) {
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
  }, [open]);

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

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event) {
      if (!confirmRef.current?.contains(event.target)) {
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
  }, [open]);

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

  const retryPlayback = useCallback(() => {
    const currentTime = Number(videoRef.current?.currentTime);
    if (Number.isFinite(currentTime) && currentTime > 0) {
      playbackResumeTimeRef.current = currentTime;
    }
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
  }, [animeId, currentEp]);

  const reportPlayerEvent = useCallback((event, details = {}) => {
    const video = videoRef.current;

    postPlayerEvent({
      event,
      animeId,
      episodeId: currentEp?.id ?? null,
      episodeNumber: currentEp?.episode_number ?? null,
      currentTime: video?.currentTime ?? null,
      duration: video?.duration ?? null,
      bufferAhead: video ? bufferedSecondsAhead(video) : null,
      readyState: video?.readyState ?? null,
      networkState: video?.networkState ?? null,
      paused: video?.paused ?? null,
      ended: video?.ended ?? null,
      ...details,
    });
  }, [animeId, currentEp]);

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
        const episode = data.episodes?.find(e => e.episode_number === episodeNum);
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

        setInWatchlist(Boolean(data.watchlist?.some(item => item.anime_id === animeIdNumber)));
      } catch (error) {
        console.error('Watchlist state failed:', error);
      }
    }

    if (Number.isFinite(animeIdNumber)) {
      loadWatchlistState();
    }

    return () => {
      active = false;
    };
  }, [animeIdNumber]);

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
    const isActive = () => active
      && streamRunRef.current === streamRunId
      && !abortController.signal.aborted;

    teardownPlayer(ownedVideo);
    setStreamError(null);
    setStreamLoading(true);

    async function initStream() {
      try {
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
        const data = await res.json();

        if (!isActive()) return;

        if (!res.ok) {
          reportPlayerEvent('stream-request-failed', {
            responseCode: res.status,
            reason: data.error || 'Failed to load stream',
          });
          setStreamError(data.error || 'Failed to load stream');
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
        removeVideoRecoveryListeners = () => {
          video.removeEventListener('loadedmetadata', restorePlaybackPosition);
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

        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = hlsUrl;
          applySubtitleSelection(video, isBurnedInStream ? 'off' : initialSubtitle);
          reportPlayerEvent('native-hls-start', streamLogContext);
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
          let stallRecoveryAttempts = 0;
          let stallTimer = null;
          let playbackWatchdogTimer = null;
          let reloadBudgetResetTimer = null;
          let sourceReloadRequested = false;
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

          const clearPlaybackWatchdog = () => {
            if (playbackWatchdogTimer) {
              window.clearInterval(playbackWatchdogTimer);
              playbackWatchdogTimer = null;
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
            sourceReloadRequested = true;

            rememberPlaybackPosition();

            if (automaticStreamReloadsRef.current >= MAX_AUTOMATIC_STREAM_RELOADS) {
              reportPlayerEvent('stream-reload-limit', {
                ...streamLogContext,
                reason,
                reloadCount: automaticStreamReloadsRef.current,
                ...extra,
              });
              setStreamError('Playback lost its connection. Retry to continue from the same place.');
              teardownPlayer(video);
              return;
            }

            automaticStreamReloadsRef.current += 1;
            reportPlayerEvent('stream-reload', {
              ...streamLogContext,
              reason,
              reloadCount: automaticStreamReloadsRef.current,
              ...extra,
            });
            setStreamLoading(true);
            setStreamReloadKey(value => value + 1);
          };

          const scheduleStallRecovery = (trigger = 'stall') => {
            clearStallTimer();
            if (video.ended || userPaused) return;

            stallTimer = window.setTimeout(() => {
              if (!isActive() || video.ended || userPaused) {
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
              });
              if (stallRecoveryAttempts <= 2) {
                hls.startLoad(Math.max(0, video.currentTime - 0.25));
                scheduleStallRecovery(trigger);
              } else {
                requestSourceReload('stall-timeout', { trigger, attempt: stallRecoveryAttempts });
              }
            }, STALL_RECOVERY_DELAY_MS);
          };

          const markUserPlaybackAction = () => {
            lastUserPlaybackActionAt = Date.now();
          };

          const handleStallEvent = event => {
            reportPlayerEvent('video-stall-event', {
              ...streamLogContext,
              reason: event.type,
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

          const handleTimeUpdate = () => {
            markPlaybackProgress();
          };

          const handleVideoPause = () => {
            if (!isActive() || video.ended) return;

            clearStallTimer();

            if (Date.now() - lastUserPlaybackActionAt <= USER_PLAYBACK_ACTION_GRACE_MS) {
              userPaused = true;
              reportPlayerEvent('video-paused-by-user', streamLogContext);
              return;
            }

            if (!hasPlayed || document.hidden) return;

            stallTimer = window.setTimeout(() => {
              if (isActive() && video.paused && !video.ended && !userPaused && !document.hidden) {
                reportPlayerEvent('unexpected-video-pause', streamLogContext);
                requestSourceReload('unexpected-pause');
              }
            }, 3000);
          };

          const handleVideoError = () => {
            if (!isActive() || video.ended) return;
            reportPlayerEvent('media-error', {
              ...streamLogContext,
              mediaErrorCode: video.error?.code ?? null,
              reason: video.error?.message || 'video-element-error',
            });
            requestSourceReload('media-error', {
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
                requestSourceReload('watchdog-paused', {
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
              requestSourceReload('watchdog-stuck', {
                stalledMs: Date.now() - lastPlaybackMovementAt,
              });
            }
          };

          playbackWatchdogTimer = window.setInterval(checkPlaybackHealth, PLAYBACK_WATCHDOG_INTERVAL_MS);

          video.addEventListener('waiting', handleStallEvent);
          video.addEventListener('stalled', handleStallEvent);
          video.addEventListener('pointerdown', markUserPlaybackAction, true);
          video.addEventListener('keydown', markUserPlaybackAction, true);
          video.addEventListener('play', handleVideoPlay);
          video.addEventListener('pause', handleVideoPause);
          video.addEventListener('playing', handlePlaybackHealthy);
          video.addEventListener('canplay', handleBufferHealthy);
          video.addEventListener('timeupdate', handleTimeUpdate);
          video.addEventListener('seeked', markPlaybackProgress);
          video.addEventListener('error', handleVideoError);
          removeVideoRecoveryListeners = () => {
            clearStallTimer();
            clearPlaybackWatchdog();
            clearReloadBudgetResetTimer();
            video.removeEventListener('loadedmetadata', restorePlaybackPosition);
            video.removeEventListener('waiting', handleStallEvent);
            video.removeEventListener('stalled', handleStallEvent);
            video.removeEventListener('pointerdown', markUserPlaybackAction, true);
            video.removeEventListener('keydown', markUserPlaybackAction, true);
            video.removeEventListener('play', handleVideoPlay);
            video.removeEventListener('pause', handleVideoPause);
            video.removeEventListener('playing', handlePlaybackHealthy);
            video.removeEventListener('canplay', handleBufferHealthy);
            video.removeEventListener('timeupdate', handleTimeUpdate);
            video.removeEventListener('seeked', markPlaybackProgress);
            video.removeEventListener('error', handleVideoError);
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
            video.play().catch(() => {});
          });

          hls.on(Hls.Events.FRAG_LOADED, () => {
            networkRecoveryAttempts = 0;
            scheduleReloadBudgetReset();
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
                scheduleStallRecovery();
                return;
              }

              if (recoverableNetworkError) {
                networkRecoveryAttempts += 1;
                if (networkRecoveryAttempts <= 3) {
                  window.setTimeout(() => {
                    if (isActive()) hls.startLoad(Math.max(0, video.currentTime - 0.25));
                  }, networkRecoveryAttempts * 1000);
                } else {
                  requestSourceReload('hls-network-error', hlsErrorContext);
                }
                return;
              }

              if (recoverableMediaError) {
                hls.recoverMediaError();
                scheduleStallRecovery();
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
                  requestSourceReload('hls-fatal-network-error', hlsErrorContext);
                }
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
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
        reportPlayerEvent('stream-init-error', {
          reason: err.message || 'stream-init-error',
        });
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
      removeVideoRecoveryListeners();
      teardownPlayer(ownedVideo);
    };
  }, [currentEp, selectedAudioTrack, subtitleMode, burnedSubtitleKey, teardownPlayer, animeId, streamReloadKey, reportPlayerEvent]);

  useEffect(() => {
    const softSubtitle = subtitleMode === 'burned' ? 'off' : selectedSubtitle;
    applySubtitleSelection(videoRef.current, softSubtitle);
  }, [selectedSubtitle, subtitleMode]);

  function handleSubtitleChange(nextSubtitle) {
    if (streamLoading) return;

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

    setSelectedAudioTrack(nextAudioTrack);

    if (nextAudioTrack === 'default') {
      removeMediaPreference(AUDIO_PREF_KEY, animeId);
    } else {
      writeMediaPreference(AUDIO_PREF_KEY, animeId, nextAudioTrack);
    }
  }

  const saveProgress = useCallback(async () => {
    if (!videoRef.current || !currentEp) return;
    const v = videoRef.current;
    if (v.currentTime < 5) return;
    try {
      await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episode_id: currentEp.id,
          anime_id: parseInt(animeId),
          progress: v.currentTime,
          duration: v.duration || 0,
          completed: v.duration > 0 && v.currentTime / v.duration > 0.9,
        }),
      });
    } catch (e) { /* ignore to avoid Next.js unhandled rejection overlay */ }
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
    if (!Number.isFinite(animeIdNumber) || watchlistBusy) return;

    const nextWatchlistState = !inWatchlist;
    setWatchlistBusy(true);

    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          anime_id: animeIdNumber,
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
    saveInterval.current = setInterval(saveProgress, 15000);
    return () => clearInterval(saveInterval.current);
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
                  aria-label={inWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 4.75C6 3.78 6.78 3 7.75 3h8.5C17.22 3 18 3.78 18 4.75v15.5l-6-3.6-6 3.6V4.75Z" />
                  </svg>
                  <span className="watchlist-tooltip">
                    {inWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
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
              {e.episode_number === episodeNum && <span style={{ color: 'var(--accent)' }}>▶</span>}
            </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
