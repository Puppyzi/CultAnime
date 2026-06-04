'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { mediaFormatLabel } from '../../lib/media-format';
import { mediaStatusBadgeLabel } from '../../lib/media-status';

export default function WatchlistPage() {
  const [watchlist, setWatchlist] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/watchlist');
        const data = await res.json();
        setWatchlist(data.watchlist || []);
      } catch (e) { console.error(e); }
      setLoading(false);
    }
    load();
  }, []);

  async function remove(animeId) {
    await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anime_id: animeId, action: 'remove' }),
    });
    setWatchlist(prev => prev.filter(w => w.anime_id !== animeId));
  }

  return (
    <div className="watchlist-page">
      <h1>My Watchlist</h1>
      <p className="subtitle">Your saved anime collection</p>

      {loading ? (
        <div className="anime-grid">
          {Array(6).fill(0).map((_, i) => (
            <div key={i} className="anime-card">
              <div className="skeleton" style={{ width: '100%', aspectRatio: '2/3' }} />
            </div>
          ))}
        </div>
      ) : watchlist.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📋</div>
          <h3>Your watchlist is empty</h3>
          <p>Browse anime and add them to your watchlist</p>
          <Link href="/browse" className="btn btn-primary" style={{ marginTop: '1rem' }}>Browse Anime</Link>
        </div>
      ) : (
        <div className="anime-grid">
          {watchlist.map(w => {
            const formatLabel = mediaFormatLabel(w.format);
            const statusLabel = mediaStatusBadgeLabel(w);

            return (
              <div key={w.anime_id} className="anime-card" style={{ position: 'relative' }}>
                <Link href={`/anime/${w.anime_id}`}>
                  <div className="anime-card-image-wrap">
                    <img className="anime-card-image" src={w.cover_image} alt={w.title} />
                    {(formatLabel || w.episode_count > 0 || statusLabel) && (
                      <div className="anime-card-badge">
                        {formatLabel && <span className="badge-format">{formatLabel}</span>}
                        {w.episode_count > 0 && <span className="badge-eps">{w.episode_count} EP</span>}
                        {statusLabel && <span className="badge-status">{statusLabel}</span>}
                      </div>
                    )}
                  </div>
                  <div className="anime-card-info">
                    <div className="anime-card-title">{w.title}</div>
                    <div className="anime-card-meta">
                      {w.rating && <span className="anime-card-rating">⭐ {w.rating}%</span>}
                      {w.year && <span>{w.year}</span>}
                    </div>
                  </div>
                </Link>
                <button onClick={() => remove(w.anime_id)}
                  style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', background: 'rgba(0,0,0,0.7)', borderRadius: '50%', width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', border: '1px solid var(--border)' }}>
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
