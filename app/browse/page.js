'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';

const ALL_GENRES = ['Action','Adventure','Comedy','Drama','Fantasy','Horror','Mecha','Music','Mystery','Psychological','Romance','Sci-Fi','Slice of Life','Sports','Supernatural','Thriller'];

export default function BrowsePage() {
  const searchParams = useSearchParams();
  const [anime, setAnime] = useState([]);
  const [search, setSearch] = useState('');
  const [genre, setGenre] = useState(searchParams.get('genre') || '');
  const [sort, setSort] = useState(searchParams.get('sort') || 'created_at');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        let url = `/api/anime?sort=${sort}&order=DESC&limit=50`;
        if (genre) url += `&genre=${encodeURIComponent(genre)}`;
        const res = await fetch(url);
        const data = await res.json();
        let list = data.anime || [];
        if (search) {
          const q = search.toLowerCase();
          list = list.filter(a =>
            a.title?.toLowerCase().includes(q) ||
            a.title_romaji?.toLowerCase().includes(q) ||
            a.title_english?.toLowerCase().includes(q)
          );
        }
        setAnime(list);
      } catch (e) { console.error(e); }
      setLoading(false);
    }
    load();
  }, [genre, sort, search]);

  return (
    <div className="browse-page">
      <div className="browse-header">
        <h1>Browse Anime</h1>
        <input
          className="browse-search" type="text"
          placeholder="Search by title..."
          value={search} onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="genre-filters">
        <button className={`genre-filter-btn ${genre === '' ? 'active' : ''}`} onClick={() => setGenre('')}>All</button>
        {ALL_GENRES.map(g => (
          <button key={g} className={`genre-filter-btn ${genre === g ? 'active' : ''}`} onClick={() => setGenre(genre === g ? '' : g)}>{g}</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {['created_at', 'rating', 'title', 'year'].map(s => (
          <button key={s} className={`genre-filter-btn ${sort === s ? 'active' : ''}`} onClick={() => setSort(s)}>
            {s === 'created_at' ? '🕐 Recent' : s === 'rating' ? '⭐ Rating' : s === 'title' ? '🔤 Title' : '📅 Year'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="anime-grid">
          {Array(12).fill(0).map((_, i) => (
            <div key={i} className="anime-card">
              <div className="skeleton" style={{ width: '100%', aspectRatio: '2/3' }} />
              <div className="anime-card-info">
                <div className="skeleton" style={{ width: '80%', height: '16px', marginBottom: '0.3rem' }} />
                <div className="skeleton" style={{ width: '50%', height: '12px' }} />
              </div>
            </div>
          ))}
        </div>
      ) : anime.length === 0 ? (
        <div className="empty-state">
          <div className="icon">🔍</div>
          <h3>No anime found</h3>
          <p>Try a different search or filter</p>
        </div>
      ) : (
        <div className="anime-grid">
          {anime.map(a => <BrowseAnimeCard key={a.id} a={a} />)}
        </div>
      )}
    </div>
  );
}

function BrowseAnimeCard({ a }) {
  const router = useRouter();
  const [isFlipping, setIsFlipping] = useState(false);

  const handleClick = (e) => {
    e.preventDefault();
    if (isFlipping) return;
    setIsFlipping(true);
    setTimeout(() => {
      router.push(`/anime/${a.id}`);
    }, 500);
  };

  return (
    <a href={`/anime/${a.id}`} onClick={handleClick} className={`anime-card ${isFlipping ? 'card-flip-out' : ''}`}>
      <img className="anime-card-image" src={a.cover_image || '/placeholder.png'} alt={a.title} />
      <div className="anime-card-overlay">
        <span className="btn btn-primary btn-sm">▶ Watch</span>
      </div>
      <div className="anime-card-info">
        <div className="anime-card-title">{a.title}</div>
        <div className="anime-card-meta">
          {a.rating && <span className="anime-card-rating">⭐ {a.rating}%</span>}
          {a.episode_count > 0 && <span>{a.episode_count} eps</span>}
        </div>
      </div>
    </a>
  );
}
