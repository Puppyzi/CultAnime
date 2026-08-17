'use client';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { mediaFormatLabel } from '../../lib/media-format';
import { mediaStatusBadgeLabel } from '../../lib/media-status';
import { StarIcon, CloseIcon, BookmarkIcon } from '../../components/Icons';
import { ContinueWatchingCard } from '../../components/AnimeCard';

function isMovieItem(item) {
  return String(item.format || '').toUpperCase() === 'MOVIE';
}

function WatchlistTitleCard({ item, onRemove }) {
  const formatLabel = mediaFormatLabel(item.format);
  const statusLabel = mediaStatusBadgeLabel(item);

  return (
    <div className="anime-card">
      <div className="anime-card-surface">
        <Link href={`/anime/${item.anime_id}`} className="anime-card-link">
          <div className="anime-card-image-wrap">
            <Image
              className="anime-card-image"
              src={item.cover_image || '/placeholder.png'}
              alt={item.title}
              fill
              sizes="(max-width: 1024px) 40vw, 180px"
            />
            {(formatLabel || item.episode_count > 0 || statusLabel) && (
              <div className="anime-card-badge">
                {formatLabel && <span className="badge-format">{formatLabel}</span>}
                {item.episode_count > 0 && !isMovieItem(item) && (
                  <span className="badge-eps">{item.episode_count} EP</span>
                )}
                {statusLabel && <span className="badge-status">{statusLabel}</span>}
              </div>
            )}
          </div>
          <div className="anime-card-info">
            <div className="anime-card-title">{item.title}</div>
            <div className="anime-card-meta">
              {item.rating && <span className="anime-card-rating"><StarIcon /> {item.rating}%</span>}
              {item.year && <span>{item.year}</span>}
            </div>
          </div>
        </Link>
        <button
          className="card-remove-button"
          type="button"
          onClick={() => onRemove(item)}
          aria-label={`Remove ${item.title} from Watchlist`}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

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

  async function remove(item) {
    await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anime_id: item.anime_id,
        episode_id: item.episode_id || undefined,
        action: 'remove',
      }),
    });
    setWatchlist(prev => prev.filter(entry => entry.id !== item.id));
  }

  const titleItems = watchlist.filter(item => !item.episode_id);
  const seriesItems = titleItems.filter(item => !isMovieItem(item));
  const movieItems = titleItems.filter(isMovieItem);
  const episodeItems = watchlist.filter(item => item.episode_id);

  return (
    <div className="watchlist-page">
      <h1>My Watchlist</h1>
      <p className="subtitle">Series, movies, and episodes you saved</p>

      {loading ? (
        <div className="anime-grid">
          {Array(6).fill(0).map((_, i) => (
            <div key={i} className="anime-card">
              <div className="anime-card-surface">
                <div className="anime-card-image-wrap skeleton" />
                <div className="anime-card-info">
                  <div className="skeleton anime-card-skeleton-title" />
                  <div className="skeleton anime-card-skeleton-meta" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : watchlist.length === 0 ? (
        <div className="empty-state">
          <div className="icon"><BookmarkIcon /></div>
          <h3>Your watchlist is empty</h3>
          <p>Browse anime and add them to your watchlist</p>
          <Link href="/browse" className="btn btn-primary" style={{ marginTop: '1rem' }}>Browse Anime</Link>
        </div>
      ) : (
        <>
          {seriesItems.length > 0 && (
            <section className="watchlist-section">
              <h2>Series</h2>
              <div className="anime-grid">
                {seriesItems.map(item => (
                  <WatchlistTitleCard key={item.id} item={item} onRemove={remove} />
                ))}
              </div>
            </section>
          )}

          {episodeItems.length > 0 && (
            <section className="watchlist-section">
              <h2>Episodes</h2>
              <div className="anime-grid">
                {episodeItems.map(w => (
                  <ContinueWatchingCard
                    key={w.id}
                    item={{
                      id: w.id,
                      anime_id: w.anime_id,
                      episode_id: w.episode_id,
                      episode_number: w.episode_number,
                      cover_image: w.cover_image,
                      title: w.title,
                      format: w.format,
                      duration: 0,
                      progress: 0,
                    }}
                    onRemove={() => remove(w)}
                  />
                ))}
              </div>
            </section>
          )}

          {movieItems.length > 0 && (
            <section className="watchlist-section">
              <h2>Movies</h2>
              <div className="anime-grid">
                {movieItems.map(item => (
                  <WatchlistTitleCard key={item.id} item={item} onRemove={remove} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
