'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

const SUBTITLE_PREF_KEY = 'cultanime.subtitleTrack';
const AUDIO_PREF_KEY = 'cultanime.audioTrack';

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

export default function WatchPage() {
  const { animeId, ep } = useParams();
  const router = useRouter();
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const saveInterval = useRef(null);
  const streamRunRef = useRef(0);
  const [anime, setAnime] = useState(null);
  const [currentEp, setCurrentEp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [streamError, setStreamError] = useState(null);
  const [streamLoading, setStreamLoading] = useState(false);
  const [audioTracks, setAudioTracks] = useState([]);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState('default');
  const [subtitles, setSubtitles] = useState([]);
  const [selectedSubtitle, setSelectedSubtitle] = useState('auto');
  const [subtitleMode, setSubtitleMode] = useState('soft');
  const [mpvStatus, setMpvStatus] = useState('');
  const [inWatchlist, setInWatchlist] = useState(false);
  const [watchlistBusy, setWatchlistBusy] = useState(false);

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

  // Load anime data
  useEffect(() => {
    let active = true;

    setLoading(true);
    setCurrentEp(null);
    setStreamError(null);
    setAudioTracks([]);
    setSubtitles([]);

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
          setStreamError(data.error || 'Failed to load stream');
          return;
        }

        const video = videoRef.current;
        if (!video) return;

        const hlsUrl = data.streamSessionId
          ? `${data.hlsUrl}${data.hlsUrl.includes('?') ? '&' : '?'}cultanimeSession=${encodeURIComponent(data.streamSessionId)}`
          : data.hlsUrl;
        const audioTrackOptions = Array.isArray(data.audioTracks) ? data.audioTracks : [];
        const subtitleTracks = Array.isArray(data.subtitles) ? data.subtitles : [];
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

        const loadScript = (src, id) => new Promise((resolve, reject) => {
          if (window[id]) return resolve();
          const existing = document.querySelector(`script[data-${id.toLowerCase()}]`);
          if (existing) {
            existing.addEventListener('load', resolve, { once: true });
            existing.addEventListener('error', reject, { once: true });
            return;
          }
          const script = document.createElement('script');
          script.src = src;
          script.setAttribute(`data-${id.toLowerCase()}`, 'true');
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });

        await loadScript('https://cdn.jsdelivr.net/npm/hls.js@latest', 'Hls');

        if (!isActive()) return;

        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = hlsUrl;
          applySubtitleSelection(video, isBurnedInStream ? 'off' : initialSubtitle);
          if (isActive()) {
            video.play().catch(() => {});
          }
          return;
        }

        if (window.Hls && window.Hls.isSupported()) {
          const hls = new window.Hls({
            enableWorker: false,
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
            startLevel: -1,
            renderTextTracksNatively: true,
          });

          hlsRef.current = hls;

          hls.on(window.Hls.Events.MANIFEST_PARSED, (event, manifestData) => {
            if (!isActive()) return;

            if (manifestData.levels && manifestData.levels.length > 0) {
              hls.currentLevel = manifestData.levels.length - 1;
            }
            video.play().catch(() => {});
          });

          hls.on(window.Hls.Events.ERROR, (event, errorData) => {
            if (!isActive() || !errorData.fatal) return;

            console.error('HLS fatal error:', errorData);
            switch (errorData.type) {
              case window.Hls.ErrorTypes.NETWORK_ERROR:
                hls.startLoad();
                break;
              case window.Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                teardownPlayer();
                setStreamError('Playback error. The video could not be loaded.');
                break;
            }
          });

          hls.loadSource(hlsUrl);
          hls.attachMedia(video);
          applySubtitleSelection(video, isBurnedInStream ? 'off' : initialSubtitle);
        } else if (data.directUrl) {
          video.src = data.directUrl;
          applySubtitleSelection(video, isBurnedInStream ? 'off' : initialSubtitle);
          if (isActive()) {
            video.play().catch(() => {});
          }
        } else {
          setStreamError('This browser cannot play the selected stream.');
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        if (!isActive()) return;

        console.error('Stream init error:', err);
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
      teardownPlayer(ownedVideo);
    };
  }, [currentEp, selectedAudioTrack, subtitleMode, burnedSubtitleKey, teardownPlayer, animeId]);

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
                Make sure Jellyfin is running and the episode has been scanned into the library.
              </p>
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
                <span className="episode-label">Episode {currentEp.episode_number}{anime.episodes_total ? ` of ${anime.episodes_total}` : ''}</span>
              </div>
            </div>
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
                <p>{anime.description}</p>
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
              <a
                href={`/api/download/${currentEp.id}`}
                className="btn btn-secondary btn-sm"
                title="Be sure to select the correct subtitle before downloading"
              >
                Download episode
              </a>
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
