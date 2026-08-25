'use client';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { mediaFormatLabel } from '../lib/media-format';
import { shouldShowReleasingBadge } from '../lib/media-status';
import ScrollRow from '../components/ScrollRow';
import { AnimeCard, ContinueWatchingCard } from '../components/AnimeCard';
import { PlayIcon, StarIcon, FlameIcon, FilmIcon } from '../components/Icons';
import MobileDiscoveryRows from '../components/MobileDiscoveryRows';
import { ErrorState, useToast } from '../components/Feedback';
import { fetchJson } from '../lib/client-api';

function SidebarPoster({ anime }) {
  if (!anime.cover_image) {
    return (
      <span className="sidebar-poster-placeholder" aria-hidden="true">
        <FilmIcon />
      </span>
    );
  }

  return <Image src={anime.cover_image} alt={anime.title} width={40} height={56} sizes="40px" />;
}

// Owns the rotating featured slide so the 6.5s carousel tick only re-renders
// the hero, not the full anime grid below it.
function HeroCarousel({ heroAnime, history }) {
  const [featuredIndex, setFeaturedIndex] = useState(() => (
    heroAnime.length > 0 ? Math.floor(Math.random() * heroAnime.length) : 0
  ));
  const heroSwipeRef = useRef({ active: false, startX: 0, startY: 0 });

  useEffect(() => {
    if (heroAnime.length === 0) {
      setFeaturedIndex(0);
      return;
    }

    setFeaturedIndex(current => current % heroAnime.length);
  }, [heroAnime.length]);

  useEffect(() => {
    if (heroAnime.length <= 1) return;

    const intervalId = setInterval(() => {
      setFeaturedIndex(current => (current + 1) % heroAnime.length);
    }, 6500);

    return () => clearInterval(intervalId);
  }, [heroAnime.length]);

  const featured = heroAnime[featuredIndex] || heroAnime[0] || null;
  const featuredFormatLabel = featured ? mediaFormatLabel(featured.format) : '';
  const featuredHistory = featured ? history.find(h => h.anime_id === featured.id) : null;
  const featuredWatchHref = featured
    ? `/watch/${featured.id}/${featuredHistory?.episode_number || 1}`
    : null;
  const canSwipeHero = heroAnime.length > 1;

  function goToHero(index) {
    if (heroAnime.length === 0) return;
    setFeaturedIndex(((index % heroAnime.length) + heroAnime.length) % heroAnime.length);
  }

  function goToPreviousHero() {
    setFeaturedIndex(current => (current - 1 + heroAnime.length) % heroAnime.length);
  }

  function goToNextHero() {
    setFeaturedIndex(current => (current + 1) % heroAnime.length);
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

  if (!featured) return null;

  return (
    <div
      className="hero"
      onPointerDown={handleHeroPointerDown}
      onPointerUp={handleHeroPointerUp}
      onPointerCancel={handleHeroPointerCancel}
      onPointerLeave={handleHeroPointerCancel}
    >
      <div key={`hero-bg-${featured.id}`} className="hero-bg">
        <Image
          className="hero-bg-image"
          src={featured.banner_image || featured.cover_image}
          alt=""
          fill
          priority
          sizes="100vw"
        />
      </div>
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
      {canSwipeHero && heroAnime.length <= 12 && (
        <div className="hero-carousel-dots" aria-label="Featured anime slides">
          {heroAnime.map((item, index) => (
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
    </div>
  );
}

function getHeroAnime(anime, history) {
  const airingAnime = anime.filter(shouldShowReleasingBadge);

  // When nothing is airing, retain the full-library fallback requested for
  // the hero instead of filtering it down to a user's watch history.
  if (airingAnime.length === 0) return anime;

  const animeById = new Map(anime.map(item => [String(item.id), item]));
  const watchedAnime = history
    .map(item => animeById.get(String(item.anime_id)))
    .filter(Boolean);
  const seenIds = new Set();

  return [...airingAnime, ...watchedAnime].filter(item => {
    const id = String(item.id);
    if (seenIds.has(id)) return false;
    seenIds.add(id);
    return true;
  });
}

export default function HomePage() {
  const notify = useToast();
  const [anime, setAnime] = useState([]);
  const [history, setHistory] = useState([]);
  const [watchlistIds, setWatchlistIds] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [removingEpisodeIds, setRemovingEpisodeIds] = useState({});
  const removingEpisodeIdsRef = useRef(new Set());

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [animeData, historyData, watchlistData] = await Promise.all([
          fetchJson('/api/anime?sort=created_at&order=DESC&limit=100', { signal: controller.signal }),
          fetchJson('/api/history', { signal: controller.signal }),
          fetchJson('/api/watchlist', { signal: controller.signal }),
        ]);
        setAnime(animeData.anime || []);
        setHistory(historyData.history || []);
        setWatchlistIds(new Set(
          (watchlistData.watchlist || [])
            .filter(item => !item.episode_id)
            .map(item => String(item.anime_id))
        ));
      } catch (loadError) {
        if (loadError.name !== 'AbortError') setError(loadError.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [reloadKey]);

  const heroAnime = useMemo(() => getHeroAnime(anime, history), [anime, history]);
  const popular = useMemo(
    () => [...anime].sort((a, b) => (b.rating || 0) - (a.rating || 0)),
    [anime]
  );
  const topAnime = useMemo(() => popular.slice(0, 10), [popular]);
  const recentlyAdded = useMemo(() => anime.slice(0, 3), [anime]);

  const removeContinueWatching = useCallback(async (episodeId) => {
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
      notify(error.message, 'error');
    } finally {
      removingEpisodeIdsRef.current.delete(episodeId);
      setRemovingEpisodeIds(current => {
        const { [episodeId]: _removed, ...remaining } = current;
        return remaining;
      });
    }
  }, [notify]);

  const updateWatchlist = useCallback(async (animeId, shouldAdd) => {
    await fetchJson('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anime_id: animeId, action: shouldAdd ? 'add' : 'remove' }),
    });
    setWatchlistIds(current => {
      const next = new Set(current);
      if (shouldAdd) {
        next.add(String(animeId));
      } else {
        next.delete(String(animeId));
      }
      return next;
    });
    notify(shouldAdd ? 'Added to Watchlist.' : 'Removed from Watchlist.', 'success');
  }, [notify]);

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

  if (error) {
    return <ErrorState title="Could not load your library" message={error} onRetry={() => setReloadKey(key => key + 1)} />;
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
      {heroAnime.length > 0 && (
        <HeroCarousel heroAnime={heroAnime} history={history} />
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
                    onRemove={removeContinueWatching}
                  />
                ))}
              </ScrollRow>
            </section>
          )}

          <MobileDiscoveryRows
            recentlyAdded={recentlyAdded}
            popular={topAnime}
          />

          <section className="section">
            <div className="section-header">
              <h2>All Anime</h2>
              <Link href="/browse">Browse &amp; Filter →</Link>
            </div>
            <div className="anime-grid home-anime-grid">
              {anime.map(a => (
                <AnimeCard
                  key={a.id}
                  anime={a}
                  inWatchlist={watchlistIds.has(String(a.id))}
                  onWatchlistChange={updateWatchlist}
                />
              ))}
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
            {topAnime.map((a, i) => (
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
