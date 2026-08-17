'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AnimeCard } from '../../components/AnimeCard';
import { SearchIcon } from '../../components/Icons';

const ALL_GENRES = ['Action','Adventure','Comedy','Drama','Fantasy','Horror','Mecha','Music','Mystery','Psychological','Romance','Sci-Fi','Slice of Life','Sports','Supernatural','Thriller'];

function BrowseContent() {
  const searchParams = useSearchParams();
  const [anime, setAnime] = useState([]);
  const [watchlistIds, setWatchlistIds] = useState(() => new Set());
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

  useEffect(() => {
    async function loadWatchlist() {
      try {
        const res = await fetch('/api/watchlist');
        const data = await res.json();
        setWatchlistIds(new Set(
          (data.watchlist || [])
            .filter(item => !item.episode_id)
            .map(item => String(item.anime_id))
        ));
      } catch (error) {
        console.error('Watchlist state failed:', error);
      }
    }

    loadWatchlist();
  }, []);

  async function updateWatchlist(animeId, shouldAdd) {
    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anime_id: animeId, action: shouldAdd ? 'add' : 'remove' }),
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Could not update the watchlist.');
    }

    setWatchlistIds(current => {
      const next = new Set(current);
      if (shouldAdd) {
        next.add(String(animeId));
      } else {
        next.delete(String(animeId));
      }
      return next;
    });
  }

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
            {s === 'created_at' ? 'Recent' : s === 'rating' ? 'Rating' : s === 'title' ? 'Title' : 'Year'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="anime-grid">
          {Array(12).fill(0).map((_, i) => (
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
      ) : anime.length === 0 ? (
        <div className="empty-state">
          <div className="icon"><SearchIcon /></div>
          <h3>No anime found</h3>
          <p>Try a different search or filter</p>
        </div>
      ) : (
        <div className="anime-grid">
          {anime.map(a => (
            <AnimeCard
              key={a.id}
              anime={a}
              inWatchlist={watchlistIds.has(String(a.id))}
              onWatchlistChange={updateWatchlist}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function BrowsePage() {
  return (
    <Suspense fallback={<div className="browse-page">Loading...</div>}>
      <BrowseContent />
    </Suspense>
  );
}
