'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { mediaFormatLabel } from '../lib/media-format';
import { mediaStatusBadgeLabel } from '../lib/media-status';

// Plays the card flip-out animation before navigating.
function useFlipNavigation(href) {
  const router = useRouter();
  const [isFlipping, setIsFlipping] = useState(false);

  const handleClick = (e) => {
    e.preventDefault();
    if (isFlipping) return;
    setIsFlipping(true);
    setTimeout(() => {
      router.push(href);
    }, 500);
  };

  return { isFlipping, handleClick };
}

export function AnimeCard({ anime }) {
  const href = `/anime/${anime.id}`;
  const { isFlipping, handleClick } = useFlipNavigation(href);
  const formatLabel = mediaFormatLabel(anime.format);
  const statusLabel = mediaStatusBadgeLabel(anime);

  return (
    <a href={href} onClick={handleClick} className={`anime-card ${isFlipping ? 'card-flip-out' : ''}`}>
      <div className="anime-card-image-wrap">
        <img className="anime-card-image" src={anime.cover_image || '/placeholder.png'} alt={anime.title} />
        <div className="anime-card-badge">
          {formatLabel && <span className="badge-format">{formatLabel}</span>}
          {anime.episode_count > 0 && <span className="badge-eps">{anime.episode_count} EP</span>}
          {statusLabel && <span className="badge-status">{statusLabel}</span>}
        </div>
        <div className="anime-card-overlay">
          <span className="btn btn-primary btn-sm">▶ Watch</span>
        </div>
      </div>
      <div className="anime-card-info">
        <div className="anime-card-title">{anime.title}</div>
        <div className="anime-card-meta">
          {anime.rating && <span className="anime-card-rating">⭐ {anime.rating}%</span>}
        </div>
      </div>
    </a>
  );
}

export function ContinueWatchingCard({ item }) {
  const href = `/watch/${item.anime_id}/${item.episode_number}`;
  const { isFlipping, handleClick } = useFlipNavigation(href);
  const formatLabel = mediaFormatLabel(item.format);
  const progressPercent = item.duration > 0
    ? Math.min(100, Math.max(0, (item.progress / item.duration) * 100))
    : 0;

  return (
    <a href={href} onClick={handleClick} className={`anime-card ${isFlipping ? 'card-flip-out' : ''}`}>
      <div className="anime-card-image-wrap">
        <img className="anime-card-image" src={item.cover_image || '/placeholder.png'} alt={item.title} />
        {formatLabel && (
          <div className="anime-card-badge">
            <span className="badge-format">{formatLabel}</span>
          </div>
        )}
        {item.duration > 0 && (
          <div className="card-progress">
            <div className="card-progress-bar" style={{ width: `${progressPercent}%` }} />
          </div>
        )}
        <div className="anime-card-overlay">
          <span className="btn btn-primary btn-sm">▶ Continue</span>
        </div>
      </div>
      <div className="anime-card-info">
        <div className="anime-card-title">{item.title}</div>
        <div className="anime-card-meta"><span>EP {item.episode_number}</span></div>
      </div>
    </a>
  );
}
