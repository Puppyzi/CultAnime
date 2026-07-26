'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { mediaFormatLabel } from '../lib/media-format';
import { mediaStatusBadgeLabel } from '../lib/media-status';
import { CloseIcon, PlayIcon, StarIcon } from './Icons';

// Plays the card flip-out animation before navigating.
// The destination route is prefetched on hover and at flip start so the
// page loads during the animation instead of after it.
function useFlipNavigation(href) {
  const router = useRouter();
  const [isFlipping, setIsFlipping] = useState(false);

  const handleMouseEnter = () => {
    router.prefetch(href);
  };

  const handleClick = (e) => {
    e.preventDefault();
    if (isFlipping) return;
    router.prefetch(href);
    setIsFlipping(true);
    setTimeout(() => {
      router.push(href);
    }, 500);
  };

  return { isFlipping, handleClick, handleMouseEnter };
}

export function AnimeCard({ anime }) {
  const href = `/anime/${anime.id}`;
  const { isFlipping, handleClick, handleMouseEnter } = useFlipNavigation(href);
  const formatLabel = mediaFormatLabel(anime.format);
  const statusLabel = mediaStatusBadgeLabel(anime);

  return (
    <a href={href} onClick={handleClick} onMouseEnter={handleMouseEnter} className={`anime-card ${isFlipping ? 'card-flip-out' : ''}`}>
      <div className="anime-card-image-wrap">
        <img className="anime-card-image" src={anime.cover_image || '/placeholder.png'} alt={anime.title} />
        <div className="anime-card-badge">
          {formatLabel && <span className="badge-format">{formatLabel}</span>}
          {anime.episode_count > 0 && <span className="badge-eps">{anime.episode_count} EP</span>}
          {statusLabel && <span className="badge-status">{statusLabel}</span>}
        </div>
        <div className="anime-card-overlay">
          <span className="btn btn-primary btn-sm"><PlayIcon /> Watch</span>
        </div>
      </div>
      <div className="anime-card-info">
        <div className="anime-card-title">{anime.title}</div>
        <div className="anime-card-meta">
          {anime.rating && <span className="anime-card-rating"><StarIcon /> {anime.rating}%</span>}
        </div>
      </div>
    </a>
  );
}

export function ContinueWatchingCard({ item, onRemove, removing = false }) {
  const href = `/watch/${item.anime_id}/${item.episode_number}`;
  const { isFlipping, handleClick, handleMouseEnter } = useFlipNavigation(href);
  const formatLabel = mediaFormatLabel(item.format);
  const progressPercent = item.duration > 0
    ? Math.min(100, Math.max(0, (item.progress / item.duration) * 100))
    : 0;

  function handleRemove(event) {
    event.preventDefault();
    event.stopPropagation();
    onRemove?.();
  }

  return (
    <div className={`anime-card continue-watching-card ${isFlipping ? 'card-flip-out' : ''}`}>
      <a href={href} onClick={handleClick} onMouseEnter={handleMouseEnter} className="continue-watching-card-link">
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
            <span className="btn btn-primary btn-sm"><PlayIcon /> Continue</span>
          </div>
        </div>
        <div className="anime-card-info">
          <div className="anime-card-title">{item.title}</div>
          <div className="anime-card-meta"><span>EP {item.episode_number}</span></div>
        </div>
      </a>
      {onRemove && (
        <button
          className="card-remove-button"
          type="button"
          onClick={handleRemove}
          disabled={removing}
          aria-label={`Remove ${item.title} from Continue Watching`}
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
}
