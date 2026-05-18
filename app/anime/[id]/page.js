'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

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

export default function AnimeDetailPage() {
  const { id } = useParams();
  const [anime, setAnime] = useState(null);
  const [inWatchlist, setInWatchlist] = useState(false);
  const [loading, setLoading] = useState(true);

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

  async function toggleWatchlist() {
    const action = inWatchlist ? 'remove' : 'add';
    await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anime_id: parseInt(id), action }),
    });
    setInWatchlist(!inWatchlist);
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

  return (
    <div>
      <div className="anime-detail-banner">
        <div className="anime-detail-banner-bg" style={{ backgroundImage: `url(${anime.banner_image || anime.cover_image})` }} />
        <div className="anime-detail-banner-gradient" />
      </div>

      <div className="anime-detail-content">
        <div>
          <img className="anime-detail-cover" src={anime.cover_image} alt={anime.title} />
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexDirection: 'column' }}>
            {anime.episodes?.length > 0 && (
              <Link href={`/watch/${anime.id}/1`} className="btn btn-primary" style={{ justifyContent: 'center' }}>
                ▶ Start Watching
              </Link>
            )}
            <button onClick={toggleWatchlist} className="btn btn-secondary" style={{ justifyContent: 'center' }}>
              {inWatchlist ? '✓ In Watchlist' : '+ Add to Watchlist'}
            </button>
          </div>
        </div>

        <div className="anime-detail-info">
          <h1>{anime.title}</h1>
          {anime.title_romaji && anime.title_romaji !== anime.title && (
            <p className="romaji">{anime.title_romaji}</p>
          )}
          
          <div className="anime-detail-stats">
            {anime.rating && <span className="stat-badge rating">⭐ {anime.rating}%</span>}
            {anime.status && <span className="stat-badge">{anime.status}</span>}
            {anime.year && <span className="stat-badge">{anime.year}</span>}
            {anime.format && <span className="stat-badge">{anime.format}</span>}
            {anime.episodes_total && <span className="stat-badge">{anime.episodes_total} Episodes</span>}
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
                    <Link key={ep.id} href={`/watch/${anime.id}/${ep.episode_number}`} className="episode-item">
                      <span className="episode-number">{ep.episode_number}</span>
                      <span className="episode-copy">
                        <span className="episode-title">{ep.title || `Episode ${ep.episode_number}`}</span>
                        {meta && <span className="episode-meta">{meta}</span>}
                      </span>
                      <span style={{ color: 'var(--accent)', fontSize: '0.85rem' }}>▶</span>
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
