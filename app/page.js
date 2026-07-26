'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { mediaFormatLabel } from '../lib/media-format';
import ScrollRow from '../components/ScrollRow';
import { AnimeCard, ContinueWatchingCard } from '../components/AnimeCard';
import { PlayIcon, StarIcon, FlameIcon, FilmIcon } from '../components/Icons';

function SidebarPoster({ anime }) {
  if (!anime.cover_image) {
    return (
      <span className="sidebar-poster-placeholder" aria-hidden="true">
        <FilmIcon />
      </span>
    );
  }

  return <img src={anime.cover_image} alt={anime.title} />;
}

export default function HomePage() {
  const [anime, setAnime] = useState([]);
  const [history, setHistory] = useState([]);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [removingEpisodeIds, setRemovingEpisodeIds] = useState({});
  const heroSwipeRef = useRef({ active: false, startX: 0, startY: 0 });
  const removingEpisodeIdsRef = useRef(new Set());

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
  const recentlyAdded = anime.slice(0, 3);
  const featured = anime[featuredIndex] || anime[0] || null;
  const featuredFormatLabel = featured ? mediaFormatLabel(featured.format) : '';
  const featuredHistory = featured ? history.find(h => h.anime_id === featured.id) : null;
  const featuredWatchHref = featured
    ? `/watch/${featured.id}/${featuredHistory?.episode_number || 1}`
    : null;
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

  async function removeContinueWatching(episodeId) {
    if (removingEpisodeIdsRef.current.has(episodeId)) return;

    removingEpisodeIdsRef.current.add(episodeId);
    setRemovingEpisodeIds(current => ({ ...current, [episodeId]: true }));

    try {
      const res = await fetch('/api/history', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episode_id: episodeId }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Could not remove this item from Continue Watching.');
      }

      setHistory(current => current.filter(item => item.episode_id !== episodeId));
    } catch (error) {
      console.error(error);
    } finally {
      removingEpisodeIdsRef.current.delete(episodeId);
      setRemovingEpisodeIds(current => {
        const { [episodeId]: _removed, ...remaining } = current;
        return remaining;
      });
    }
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
        <div className="icon"><FilmIcon /></div>
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
              {featured.rating && <span><StarIcon style={{ color: 'var(--yellow)' }} /> {featured.rating}%</span>}
              {featuredFormatLabel && <span>{featuredFormatLabel}</span>}
              {featured.year && <span>{featured.year}</span>}
              {featured.episodes_total && <span>{featured.episodes_total} EP</span>}
              {featured.genres?.slice(0, 3).map(g => <span key={g}>{g}</span>)}
            </div>
            <p className="hero-description">{featured.description}</p>
            <div className="hero-actions">
              <Link href={featuredWatchHref} className="btn btn-primary">
                <PlayIcon /> {featuredHistory ? `Continue EP ${featuredHistory.episode_number}` : 'Watch Now'}
              </Link>
              <Link href={`/anime/${featured.id}`} className="btn btn-secondary">Details</Link>
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
              <ScrollRow>
                {history.map(h => (
                  <ContinueWatchingCard
                    key={h.id}
                    item={h}
                    removing={Boolean(removingEpisodeIds[h.episode_id])}
                    onRemove={() => removeContinueWatching(h.episode_id)}
                  />
                ))}
              </ScrollRow>
            </section>
          )}

          <section className="section">
            <div className="section-header">
              <h2>All Anime</h2>
              <Link href="/browse">Browse &amp; Filter →</Link>
            </div>
            <div className="anime-grid home-anime-grid">
              {anime.map(a => <AnimeCard key={a.id} anime={a} />)}
            </div>
          </section>

        </div>

        {/* AnimeKai-style sidebar */}
        <aside className="home-sidebar">
          <section className="sidebar-section">
            <div className="sidebar-title"><FilmIcon style={{ color: 'var(--accent)' }} /> Recently Added</div>
            {recentlyAdded.map(a => (
              <Link key={a.id} href={`/anime/${a.id}`} className="sidebar-item">
                <SidebarPoster anime={a} />
                <div className="sidebar-info">
                  <h4>{a.title}</h4>
                  <p>{a.episodes_total ? `${a.episodes_total} EP` : ''}{a.year ? ` / ${a.year}` : ''}{a.rating ? ` • ${a.rating}%` : ''}</p>
                </div>
              </Link>
            ))}
          </section>

          <section className="sidebar-section">
            <div className="sidebar-title"><FlameIcon style={{ color: '#fb923c' }} /> Top Anime</div>
            {popular.slice(0, 10).map((a, i) => (
              <Link key={a.id} href={`/anime/${a.id}`} className="sidebar-item">
                <span className={`sidebar-rank ${i < 3 ? 'top' : ''}`}>{String(i + 1).padStart(2, '0')}</span>
                <SidebarPoster anime={a} />
                <div className="sidebar-info">
                  <h4>{a.title}</h4>
                  <p>{a.episodes_total ? `${a.episodes_total} EP` : ''}{a.year ? ` / ${a.year}` : ''}{a.rating ? ` • ${a.rating}%` : ''}</p>
                </div>
              </Link>
            ))}
          </section>
        </aside>
      </div>
    </>
  );
}
