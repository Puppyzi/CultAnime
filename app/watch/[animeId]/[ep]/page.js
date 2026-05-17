'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

export default function WatchPage() {
  const { animeId, ep } = useParams();
  const router = useRouter();
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const plyrRef = useRef(null);
  const saveInterval = useRef(null);
  const [anime, setAnime] = useState(null);
  const [currentEp, setCurrentEp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [streamError, setStreamError] = useState(null);
  const [subtitles, setSubtitles] = useState([]);

  const episodeNum = parseInt(ep);

  // Load anime data
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/anime/${animeId}`);
        const data = await res.json();
        setAnime(data);
        const episode = data.episodes?.find(e => e.episode_number === episodeNum);
        setCurrentEp(episode);
      } catch (e) { console.error(e); }
      setLoading(false);
    }
    load();
  }, [animeId, episodeNum]);

  // Set up HLS streaming via Jellyfin
  useEffect(() => {
    if (!currentEp) return;

    let destroyed = false;

    async function initStream() {
      try {
        setStreamError(null);

        // Fetch the Jellyfin stream URL from our API
        const res = await fetch(`/api/stream/${currentEp.id}`);
        const data = await res.json();

        if (!res.ok) {
          setStreamError(data.error || 'Failed to load stream');
          return;
        }

        if (destroyed) return;

        const video = videoRef.current;
        if (!video) return;

        const hlsUrl = data.hlsUrl;
        if (data.subtitles) setSubtitles(data.subtitles);

        // Load HLS and Plyr dynamically
        const loadScript = (src, id) => new Promise((resolve, reject) => {
          if (window[id]) return resolve();
          const existing = document.querySelector(`script[data-${id.toLowerCase()}]`);
          if (existing) {
            existing.addEventListener('load', resolve);
            existing.addEventListener('error', reject);
            return;
          }
          const script = document.createElement('script');
          script.src = src;
          script.setAttribute(`data-${id.toLowerCase()}`, 'true');
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });

        await Promise.all([
          loadScript('https://cdn.jsdelivr.net/npm/hls.js@latest', 'Hls'),
          loadScript('https://cdn.plyr.io/3.7.8/plyr.polyfilled.js', 'Plyr')
        ]);

        if (destroyed) return;

        const initPlyr = () => {
          if (window.Plyr && !plyrRef.current) {
            plyrRef.current = new window.Plyr(video, {
              controls: ['play-large', 'rewind', 'play', 'fast-forward', 'progress', 'current-time', 'mute', 'volume', 'captions', 'settings', 'pip', 'airplay', 'fullscreen'],
              seekTime: 5,
              keyboard: { focused: true, global: true },
              captions: { active: true, update: true, language: 'en' },
            });
          }
        };

        // Check if browser natively supports HLS (Safari does)
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = hlsUrl;
          video.play().catch(() => {});
          initPlyr();
          return;
        }

        if (window.Hls && window.Hls.isSupported()) {
          // Destroy any previous HLS instance
          if (hlsRef.current) {
            hlsRef.current.destroy();
          }

          const hls = new window.Hls({
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
            startLevel: -1, // auto quality selection
            renderTextTracksNatively: false, // Let Plyr handle subtitles
          });

          hls.loadSource(hlsUrl);
          hls.attachMedia(video);

          hls.on(window.Hls.Events.MANIFEST_PARSED, (event, data) => {
            // Force the highest available quality (Jellyfin puts highest bitrate at the end of the levels array)
            if (data.levels && data.levels.length > 0) {
              hls.currentLevel = data.levels.length - 1;
            }
            if (!destroyed) {
              video.play().catch(() => {});
            }
          });

          hls.on(window.Hls.Events.ERROR, (event, errorData) => {
            if (errorData.fatal) {
              console.error('HLS fatal error:', errorData);
              switch (errorData.type) {
                case window.Hls.ErrorTypes.NETWORK_ERROR:
                  hls.startLoad();
                  break;
                case window.Hls.ErrorTypes.MEDIA_ERROR:
                  hls.recoverMediaError();
                  break;
                default:
                  setStreamError('Playback error. The video could not be loaded.');
                  hls.destroy();
                  break;
              }
            }
          });

          hlsRef.current = hls;
          initPlyr();
        } else {
          // Fallback: try direct stream URL for browsers that might support the codec
          video.src = data.directUrl;
          video.play().catch(() => {});
          initPlyr();
        }
      } catch (err) {
        console.error('Stream init error:', err);
        setStreamError('Failed to connect to streaming server.');
      }
    }

    initStream();

    return () => {
      destroyed = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (plyrRef.current) {
        plyrRef.current.destroy();
        plyrRef.current = null;
      }
    };
  }, [currentEp]);

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

  useEffect(() => {
    saveInterval.current = setInterval(saveProgress, 15000);
    return () => clearInterval(saveInterval.current);
  }, [saveProgress]);



  const nextEp = anime?.episodes?.find(e => e.episode_number === episodeNum + 1);
  const prevEp = anime?.episodes?.find(e => e.episode_number === episodeNum - 1);

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
              <link rel="stylesheet" href="https://cdn.plyr.io/3.7.8/plyr.css" />
              <style>{`:root { --plyr-color-main: var(--accent); } .plyr { width: 100%; height: 100%; border-radius: var(--radius); }`}</style>
              <video
                ref={videoRef}
                autoPlay
                onEnded={() => { saveProgress(); if (nextEp) router.push(`/watch/${animeId}/${nextEp.episode_number}`); }}
                onPause={saveProgress}
                crossOrigin="anonymous"
              >
                {subtitles.map((sub, idx) => (
                  <track 
                    key={idx}
                    kind="captions" 
                    label={sub.title} 
                    srcLang={sub.language} 
                    src={sub.url} 
                    default={sub.isDefault}
                  />
                ))}
              </video>
            </>
          )}
        </div>
        <div className="player-info">
          <Link href={`/anime/${animeId}`} style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            ← {anime.title}
          </Link>
          <h1>{currentEp.title || `Episode ${currentEp.episode_number}`}</h1>
          <span className="episode-label">Episode {currentEp.episode_number}{anime.episodes_total ? ` of ${anime.episodes_total}` : ''}</span>
          <div className="player-nav" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }} />
            {prevEp && (
              <Link href={`/watch/${animeId}/${prevEp.episode_number}`} className="btn btn-secondary btn-sm">← Previous</Link>
            )}
            {nextEp && (
              <Link href={`/watch/${animeId}/${nextEp.episode_number}`} className="btn btn-primary btn-sm">Next →</Link>
            )}
          </div>
        </div>
      </div>

      <div className="player-sidebar">
        <h3>Episodes</h3>
        <div className="episode-grid" style={{ padding: '0' }}>
          {anime.episodes.map(e => (
            <Link key={e.id} href={`/watch/${animeId}/${e.episode_number}`}
              className={`episode-item ${e.episode_number === episodeNum ? 'active' : ''}`}>
              <span className="episode-number">{e.episode_number}</span>
              <span className="episode-title">{e.title || `Episode ${e.episode_number}`}</span>
              {e.episode_number === episodeNum && <span style={{ color: 'var(--accent)' }}>▶</span>}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
