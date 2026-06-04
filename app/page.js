'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { mediaFormatLabel } from '../lib/media-format';
import { mediaStatusBadgeLabel } from '../lib/media-status';
export default function HomePage() {
  const [anime, setAnime] = useState([]);
  const [history, setHistory] = useState([]);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const heroSwipeRef = useRef({ active: false, startX: 0, startY: 0 });

  useEffect(() => {
    async function load() {
      try {
        const [animeRes, historyRes] = await Promise.all([
          fetch('/api/anime?sort=created_at&order=DESC&limit=500'),
          fetch('/api/history'),
        ]);
        const animeData = await animeRes.json();
        const historyData = await historyRes.json();
        const list = animeData.anime || [];
        setAnime(list);
        setHistory(historyData.history || []);
        if (list.length > 0) {
          setFeaturedIndex(Math.floor(Math.random() * list.length));
        }
      } catch (e) { console.error(e); }
      setLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    if (anime.length <= 1) return;

    const intervalId = setInterval(() => {
      goToNextHero();
    }, 6500);

    return () => clearInterval(intervalId);
  }, [anime.length]);

  const popular = [...anime].sort((a, b) => (b.rating || 0) - (a.rating || 0));
  const featured = anime[featuredIndex] || anime[0] || null;
  const featuredFormatLabel = featured ? mediaFormatLabel(featured.format) : '';
  const canSwipeHero = anime.length > 1;

  function goToHero(index) {
    if (anime.length === 0) return;
    setFeaturedIndex(((index % anime.length) + anime.length) % anime.length);
  }

  function goToPreviousHero() {
    setFeaturedIndex(current => (current - 1 + anime.length) % anime.length);
  }

  function goToNextHero() {
    setFeaturedIndex(current => (current + 1) % anime.length);
  }

  function handleHeroPointerDown(e) {
    if (!canSwipeHero || e.target.closest('a, button')) return;
    heroSwipeRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
    };
  }

  function handleHeroPointerUp(e) {
    const swipe = heroSwipeRef.current;
    heroSwipeRef.current = { active: false, startX: 0, startY: 0 };
    if (!swipe.active || !canSwipeHero) return;

    const deltaX = e.clientX - swipe.startX;
    const deltaY = e.clientY - swipe.startY;
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.4) return;

    if (deltaX < 0) {
      goToNextHero();
    } else {
      goToPreviousHero();
    }
  }

  function handleHeroPointerCancel() {
    heroSwipeRef.current = { active: false, startX: 0, startY: 0 };
  }

  if (loading) {
    return (
      <div>
        <div className="hero" style={{ background: 'var(--bg-secondary)' }}>
          <div className="hero-content">
            <div className="skeleton" style={{ width: '250px', height: '32px', marginBottom: '0.75rem' }} />
            <div className="skeleton" style={{ width: '100%', height: '40px', marginBottom: '0.75rem' }} />
            <div className="skeleton" style={{ width: '120px', height: '36px' }} />
          </div>
        </div>
      </div>
    );
  }

  if (anime.length === 0) {
    return (
      <div className="empty-state" style={{ paddingTop: '8rem' }}>
        <div className="icon">🎬</div>
        <h3>No anime yet</h3>
        <p>Head to the <Link href="/admin" style={{ color: 'var(--accent)' }}>Admin Panel</Link> to add your first anime!</p>
      </div>
    );
  }

  return (
    <>
      {featured && (
        <div
          className="hero"
          onPointerDown={handleHeroPointerDown}
          onPointerUp={handleHeroPointerUp}
          onPointerCancel={handleHeroPointerCancel}
          onPointerLeave={handleHeroPointerCancel}
        >
          <div key={`hero-bg-${featured.id}`} className="hero-bg" style={{ backgroundImage: `url(${featured.banner_image || featured.cover_image})` }} />
          <div className="hero-overlay" />
          <div key={`hero-content-${featured.id}`} className="hero-content">
            <h1>{featured.title}</h1>
            <div className="hero-meta">
              {featured.rating && <span>⭐ {featured.rating}%</span>}
              {featuredFormatLabel && <span>{featuredFormatLabel}</span>}
              {featured.year && <span>{featured.year}</span>}
              {featured.episodes_total && <span>{featured.episodes_total} EP</span>}
              {featured.genres?.slice(0, 3).map(g => <span key={g}>{g}</span>)}
            </div>
            <p className="hero-description">{featured.description}</p>
            <div className="hero-actions">
              <Link href={`/anime/${featured.id}`} className="btn btn-primary">▶ Watch Now</Link>
              <Link href={`/anime/${featured.id}`} className="btn btn-secondary">Detail</Link>
            </div>
          </div>
          {canSwipeHero && (
            <>
              {anime.length <= 12 && (
                <div className="hero-carousel-dots" aria-label="Featured anime slides">
                  {anime.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`hero-carousel-dot ${index === featuredIndex ? 'active' : ''}`}
                      onClick={() => goToHero(index)}
                      aria-label={`Show ${item.title}`}
                      aria-current={index === featuredIndex ? 'true' : undefined}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="home-layout">
        <div className="home-main">
          {history.length > 0 && (
            <section className="section">
              <div className="section-header">
                <h2>Continue Watching</h2>
              </div>
              <div className="anime-row">
                {history.map(h => (
                  <ContinueWatchingCard key={h.id} item={h} />
                ))}
              </div>
            </section>
          )}

          <section className="section">
            <div className="section-header">
              <h2>Recently Added</h2>
              <Link href="/browse">View All →</Link>
            </div>
            <div className="anime-row">
              {anime.slice(0, 15).map(a => <AnimeCard key={a.id} anime={a} />)}
            </div>
          </section>

          {popular.length > 0 && (
            <section className="section">
              <div className="section-header">
                <h2>Top Rated</h2>
                <Link href="/browse?sort=rating">View All →</Link>
              </div>
              <div className="anime-row">
                {popular.slice(0, 15).map(a => <AnimeCard key={a.id} anime={a} />)}
              </div>
            </section>
          )}
        </div>

        {/* AnimeKai-style sidebar */}
        <aside className="home-sidebar">
          <div className="sidebar-title">🔥 Top Anime</div>
          {popular.slice(0, 10).map((a, i) => (
            <Link key={a.id} href={`/anime/${a.id}`} className="sidebar-item">
              <span className={`sidebar-rank ${i < 3 ? 'top' : ''}`}>{String(i + 1).padStart(2, '0')}</span>
              <img src={a.cover_image} alt={a.title} />
              <div className="sidebar-info">
                <h4>{a.title}</h4>
                <p>{a.episodes_total ? `${a.episodes_total} EP` : ''}{a.rating ? ` • ${a.rating}%` : ''}</p>
              </div>
            </Link>
          ))}
        </aside>
      </div>
    </>
  );
}

function ContinueWatchingCard({ item }) {
  const router = useRouter();
  const [isFlipping, setIsFlipping] = useState(false);
  const href = `/watch/${item.anime_id}/${item.episode_number}`;
  const formatLabel = mediaFormatLabel(item.format);
  const progressPercent = item.duration > 0
    ? Math.min(100, Math.max(0, (item.progress / item.duration) * 100))
    : 0;

  const handleClick = (e) => {
    e.preventDefault();
    if (isFlipping) return;
    setIsFlipping(true);
    setTimeout(() => {
      router.push(href);
    }, 500);
  };

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

function AnimeCard({ anime }) {
  const router = useRouter();
  const [isFlipping, setIsFlipping] = useState(false);
  const formatLabel = mediaFormatLabel(anime.format);
  const statusLabel = mediaStatusBadgeLabel(anime);

  const handleClick = (e) => {
    e.preventDefault();
    if (isFlipping) return;
    setIsFlipping(true);
    setTimeout(() => {
      router.push(`/anime/${anime.id}`);
    }, 500);
  };

  return (
    <a href={`/anime/${anime.id}`} onClick={handleClick} className={`anime-card ${isFlipping ? 'card-flip-out' : ''}`}>
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
