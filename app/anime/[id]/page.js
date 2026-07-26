'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PlayIcon, StarIcon } from '../../../components/Icons';

const TICKS_PER_SECOND = 10000000;

function formatAirDate(value) {
  if (!value) return null;

  const normalizedValue = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00`
    : value;
  const date = new Date(normalizedValue);
  if (Number.isNaN(date.valueOf())) return null;

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatRuntime(ep) {
  const seconds = ep.duration || (ep.runtime_ticks ? Math.round(Number(ep.runtime_ticks) / TICKS_PER_SECOND) : null);
  if (!seconds || !Number.isFinite(seconds)) return null;

  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes}m`;
}

function episodeMetaText(ep) {
  return [formatAirDate(ep.air_date), formatRuntime(ep)].filter(Boolean).join(' | ');
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

function episodeThumbnailUrl(ep, width = 320, height = 180) {
  return `/api/thumbnail/${ep.id}?width=${width}&height=${height}`;
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

function SeriesDownloadConfirm({ animeId }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [metadata, setMetadata] = useState(null);
  const [error, setError] = useState('');
  const confirmRef = useRef(null);
  const requestRunRef = useRef(0);
  const downloadHref = `/api/download-series/${animeId}`;
  const hasConfirmedSize = Number.isFinite(Number(metadata?.totalSizeBytes)) && Number(metadata.totalSizeBytes) > 0;

  useEffect(() => {
    requestRunRef.current += 1;
    setOpen(false);
    setLoading(false);
    setMetadata(null);
    setError('');
  }, [animeId]);

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

  async function loadSeriesMetadata() {
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

      if (String(data.animeId) !== String(animeId)) {
        throw new Error('The download size did not match this anime');
      }

      if (!Number.isFinite(Number(data.totalSizeBytes)) || Number(data.totalSizeBytes) <= 0) {
        throw new Error('Could not confirm this series file size');
      }

      setMetadata(data);
    } catch (loadError) {
      if (requestRunRef.current !== runId) return;

      console.error('Series download metadata failed:', loadError);
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

    if (nextOpen && (!metadata || String(metadata.animeId) !== String(animeId) || error)) {
      loadSeriesMetadata();
    }
  }

  return (
    <div className={`series-download-confirm${open ? ' open' : ''}`} ref={confirmRef}>
      <button
        type="button"
        className="btn btn-secondary series-download-button"
        onClick={handleToggle}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        Download All
      </button>
      {open && (
        <div className="series-download-popover" role="dialog" aria-label="Confirm series download">
          <div className="download-confirm-label">Total size</div>
          {loading ? (
            <div className="download-confirm-size muted">Checking...</div>
          ) : error ? (
            <div className="download-confirm-error">{error}</div>
          ) : (
            <>
              <div className="download-confirm-size">{formatBytes(metadata?.totalSizeBytes)}</div>
              <div className="series-download-meta">
                {metadata?.episodeCount || 0} episodes ZIP
              </div>
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
                onClick={loadSeriesMetadata}
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
                Download ZIP
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AnimeDetailPage() {
  const { id } = useParams();
  const [anime, setAnime] = useState(null);
  const [inWatchlist, setInWatchlist] = useState(false);
  const [loading, setLoading] = useState(true);
  const [watchlistBusy, setWatchlistBusy] = useState(false);
  const watchlistActionRef = useRef(false);
  const watchlistRequestIdRef = useRef(0);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/anime/${id}`);
        const data = await res.json();
        setAnime(data);

        const wlRes = await fetch('/api/watchlist');
        const wlData = await wlRes.json();
        setInWatchlist(wlData.watchlist?.some(w => w.anime_id === parseInt(id)));
      } catch (e) { console.error(e); }
      setLoading(false);
    }
    load();
  }, [id]);

  useEffect(() => {
    watchlistRequestIdRef.current += 1;
    watchlistActionRef.current = false;
    setWatchlistBusy(false);
  }, [id]);

  async function toggleWatchlist() {
    if (watchlistActionRef.current) return;

    const action = inWatchlist ? 'remove' : 'add';
    const animeId = parseInt(id);
    const requestId = watchlistRequestIdRef.current + 1;
    watchlistRequestIdRef.current = requestId;
    watchlistActionRef.current = true;
    setWatchlistBusy(true);

    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anime_id: animeId, action }),
      });
      const data = await res.json();

      if (watchlistRequestIdRef.current !== requestId) return;

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Could not update the watchlist.');
      }

      setInWatchlist(action === 'add');
    } catch (error) {
      if (watchlistRequestIdRef.current === requestId) {
        console.error(error);
      }
    } finally {
      if (watchlistRequestIdRef.current === requestId) {
        watchlistActionRef.current = false;
        setWatchlistBusy(false);
      }
    }
  }

  if (loading) {
    return (
      <div>
        <div className="anime-detail-banner"><div style={{ height: '400px', background: 'var(--bg-secondary)' }} /></div>
        <div className="anime-detail-content">
          <div className="skeleton" style={{ width: '250px', height: '375px' }} />
          <div><div className="skeleton" style={{ width: '300px', height: '40px', marginBottom: '1rem' }} /></div>
        </div>
      </div>
    );
  }

  if (!anime) return <div className="empty-state"><h3>Anime not found</h3></div>;

  const episodeTotal = episodeTotalFor(anime);

  return (
    <div>
      <div className="anime-detail-banner">
        <div className="anime-detail-banner-bg" style={{ backgroundImage: `url(${anime.banner_image || anime.cover_image})` }} />
        <div className="anime-detail-banner-gradient" />
      </div>

      <div className="anime-detail-content">
        <div>
          <img className="anime-detail-cover" src={anime.cover_image} alt={anime.title} />
          <div className="anime-detail-actions">
            {anime.episodes?.length > 0 && (
              <Link href={`/watch/${anime.id}/1`} className="btn btn-primary" style={{ justifyContent: 'center' }}>
                <PlayIcon /> Start Watching
              </Link>
            )}
            <button
              type="button"
              onClick={toggleWatchlist}
              className="btn btn-secondary watchlist-button"
              style={{ justifyContent: 'center' }}
              disabled={watchlistBusy}
              aria-busy={watchlistBusy}
            >
              {watchlistBusy ? 'Updating...' : inWatchlist ? '✓ In Watchlist' : '+ Add to Watchlist'}
            </button>
            {anime.episodes?.length > 0 && (
              <SeriesDownloadConfirm animeId={anime.id} />
            )}
          </div>
        </div>

        <div className="anime-detail-info">
          <h1>{anime.title}</h1>
          {anime.title_romaji && anime.title_romaji !== anime.title && (
            <p className="romaji">{anime.title_romaji}</p>
          )}
          
          <div className="anime-detail-stats">
            {anime.rating && <span className="stat-badge rating"><StarIcon /> {anime.rating}%</span>}
            {anime.status && <span className="stat-badge">{anime.status}</span>}
            {anime.year && <span className="stat-badge">{anime.year}</span>}
            {anime.format && <span className="stat-badge">{anime.format}</span>}
            {episodeTotal && <span className="stat-badge">{episodeTotal} Episodes</span>}
          </div>

          <div className="genre-tags">
            {anime.genres?.map(g => <span key={g} className="genre-tag">{g}</span>)}
          </div>

          <p className="anime-detail-description">{anime.description}</p>

          {anime.episodes?.length > 0 && (
            <div className="episode-list">
              <h2>Episodes ({anime.episodes.length})</h2>
              <div className="episode-grid">
                {anime.episodes.map(ep => {
                  const meta = episodeMetaText(ep);

                  return (
                    <Link key={ep.id} href={`/watch/${anime.id}/${ep.episode_number}`} className="episode-item episode-detail-item">
                      <img
                        className="episode-thumbnail"
                        src={episodeThumbnailUrl(ep)}
                        alt=""
                        loading="lazy"
                      />
                      <span className="episode-number">{ep.episode_number}</span>
                      <span className="episode-copy episode-detail-copy">
                        <span className="episode-title">{ep.title || `Episode ${ep.episode_number}`}</span>
                        {meta && <span className="episode-meta">{meta}</span>}
                        {ep.overview && <span className="episode-overview">{ep.overview}</span>}
                      </span>
                      <span style={{ color: 'var(--accent)', fontSize: '0.85rem' }}><PlayIcon /></span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {(!anime.episodes || anime.episodes.length === 0) && (
            <div className="empty-state">
              <h3>No episodes linked yet</h3>
              <p>Go to the <Link href="/admin" style={{ color: 'var(--accent)' }}>Admin Panel</Link> to add episodes.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
