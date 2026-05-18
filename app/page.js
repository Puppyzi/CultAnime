'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
export default function HomePage() {
  const [anime, setAnime] = useState([]);
  const [history, setHistory] = useState([]);
  const [featured, setFeatured] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [animeRes, historyRes] = await Promise.all([
          fetch('/api/anime?sort=created_at&order=DESC&limit=30'),
          fetch('/api/history'),
        ]);
        const animeData = await animeRes.json();
        const historyData = await historyRes.json();
        const list = animeData.anime || [];
        setAnime(list);
        setHistory(historyData.history || []);
        if (list.length > 0) {
          setFeatured(list[Math.floor(Math.random() * Math.min(list.length, 5))]);
        }
      } catch (e) { console.error(e); }
      setLoading(false);
    }
    load();
  }, []);

  const popular = [...anime].sort((a, b) => (b.rating || 0) - (a.rating || 0));

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
        <div className="hero">
          <div className="hero-bg" style={{ backgroundImage: `url(${featured.banner_image || featured.cover_image})` }} />
          <div className="hero-overlay" />
          <div className="hero-content">
            <h1>{featured.title}</h1>
            <div className="hero-meta">
              {featured.rating && <span>⭐ {featured.rating}%</span>}
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
          {anime.episode_count > 0 && <span className="badge-eps">{anime.episode_count} EP</span>}
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
