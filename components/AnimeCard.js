'use client';
import { memo, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { mediaFormatLabel } from '../lib/media-format';
import { mediaStatusBadgeLabel } from '../lib/media-status';
import { BookmarkIcon, CloseIcon, PlayIcon, StarIcon } from './Icons';

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

const CARD_IMAGE_SIZES = '(max-width: 1024px) 40vw, 180px';

export const AnimeCard = memo(function AnimeCard({ anime, inWatchlist = false, onWatchlistChange }) {
  const href = `/anime/${anime.id}`;
  const watchHref = `/watch/${anime.id}/1`;
  const router = useRouter();
  const { isFlipping, handleClick, handleMouseEnter } = useFlipNavigation(href);
  const formatLabel = mediaFormatLabel(anime.format);
  const statusLabel = mediaStatusBadgeLabel(anime);
  const [watchlistBusy, setWatchlistBusy] = useState(false);
  const watchlistActionRef = useRef(false);

  async function handleWatchlistClick(event) {
    event.preventDefault();
    event.stopPropagation();

    if (!onWatchlistChange || watchlistActionRef.current) return;

    watchlistActionRef.current = true;
    setWatchlistBusy(true);

    try {
      await onWatchlistChange(anime.id, !inWatchlist);
    } catch (error) {
      console.error('Watchlist update failed:', error);
    } finally {
      watchlistActionRef.current = false;
      setWatchlistBusy(false);
    }
  }

  return (
    <div className={`anime-card ${isFlipping ? 'card-flip-out' : ''}`}>
      <div className="anime-card-surface">
        <div className="anime-card-image-wrap">
          <Image
            className="anime-card-image"
            src={anime.cover_image || '/placeholder.png'}
            alt=""
            fill
            sizes={CARD_IMAGE_SIZES}
          />
          <a href={href} onClick={handleClick} onMouseEnter={handleMouseEnter} className="anime-card-image-link" aria-label={anime.title} />
          <div className="anime-card-badge">
            {formatLabel && <span className="badge-format">{formatLabel}</span>}
            {anime.episode_count > 0 && <span className="badge-eps">{anime.episode_count} EP</span>}
            {statusLabel && <span className="badge-status">{statusLabel}</span>}
          </div>
          <div className="anime-card-overlay">
            <div className="anime-card-action-row">
              {onWatchlistChange && (
                <button
                  className={`watchlist-icon-button anime-card-watchlist-button${inWatchlist ? ' active' : ''}`}
                  type="button"
                  onClick={handleWatchlistClick}
                  disabled={watchlistBusy}
                  aria-label={inWatchlist ? `Remove ${anime.title} from Watchlist` : `Add ${anime.title} to Watchlist`}
                  aria-pressed={inWatchlist}
                  title={inWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
                >
                  <BookmarkIcon />
                </button>
              )}
              <a
                href={watchHref}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  router.push(watchHref);
                }}
                onMouseEnter={() => router.prefetch(watchHref)}
                className="btn btn-primary btn-sm anime-card-watch-action"
              >
                <PlayIcon /> Watch
              </a>
            </div>
          </div>
        </div>
        <a href={href} onClick={handleClick} onMouseEnter={handleMouseEnter} className="anime-card-link">
          <div className="anime-card-info">
            <div className="anime-card-title">{anime.title}</div>
            <div className="anime-card-meta">
              {anime.rating && <span className="anime-card-rating"><StarIcon /> {anime.rating}%</span>}
            </div>
          </div>
        </a>
      </div>
    </div>
  );
});

export const ContinueWatchingCard = memo(function ContinueWatchingCard({ item, onRemove, removing = false }) {
  const href = `/watch/${item.anime_id}/${item.episode_number}`;
  const { isFlipping, handleClick, handleMouseEnter } = useFlipNavigation(href);
  const formatLabel = mediaFormatLabel(item.format);
  const progressPercent = item.duration > 0
    ? Math.min(100, Math.max(0, (item.progress / item.duration) * 100))
    : 0;

  function handleRemove(event) {
    event.preventDefault();
    event.stopPropagation();
    onRemove?.(item.episode_id);
  }

  return (
    <div className={`anime-card continue-watching-card ${isFlipping ? 'card-flip-out' : ''}`}>
      <div className="anime-card-surface">
        <a href={href} onClick={handleClick} onMouseEnter={handleMouseEnter} className="continue-watching-card-link">
          <div className="anime-card-image-wrap">
            <Image
              className="anime-card-image"
              src={item.cover_image || '/placeholder.png'}
              alt={item.title}
              fill
              sizes={CARD_IMAGE_SIZES}
            />
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
    </div>
  );
});
