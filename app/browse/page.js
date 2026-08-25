'use client';

import { Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AnimeCard } from '../../components/AnimeCard';
import { ErrorState, useToast } from '../../components/Feedback';
import { SearchIcon } from '../../components/Icons';
import { fetchJson } from '../../lib/client-api';

const ALL_GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Mecha', 'Music', 'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'];
const SORTS = ['created_at', 'rating', 'title', 'year'];
const PAGE_SIZE = 24;

function BrowseContent() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const notify = useToast();
  const [anime, setAnime] = useState([]);
  const [watchlistIds, setWatchlistIds] = useState(() => new Set());
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(searchParams.get('q') || '');
  const [genre, setGenre] = useState(searchParams.get('genre') || '');
  const [sort, setSort] = useState(SORTS.includes(searchParams.get('sort')) ? searchParams.get('sort') : 'created_at');
  const [page, setPage] = useState(Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1));
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set('q', debouncedSearch);
    if (genre) params.set('genre', genre);
    if (sort !== 'created_at') params.set('sort', sort);
    if (page > 1) params.set('page', String(page));
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [debouncedSearch, genre, page, pathname, router, sort]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError('');
      const params = new URLSearchParams({
        sort,
        order: sort === 'title' ? 'ASC' : 'DESC',
        limit: String(PAGE_SIZE),
        page: String(page),
      });
      if (genre) params.set('genre', genre);
      if (debouncedSearch) params.set('q', debouncedSearch);

      try {
        const data = await fetchJson(`/api/anime?${params}`, { signal: controller.signal });
        setAnime(data.anime || []);
        setTotal(Number(data.total) || 0);
        setTotalPages(Math.max(1, Number(data.totalPages) || 1));
      } catch (loadError) {
        if (loadError.name !== 'AbortError') setError(loadError.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [debouncedSearch, genre, page, reloadKey, sort]);

  useEffect(() => {
    const controller = new AbortController();
    fetchJson('/api/watchlist', { signal: controller.signal })
      .then(data => setWatchlistIds(new Set((data.watchlist || []).filter(item => !item.episode_id).map(item => String(item.anime_id)))))
      .catch(loadError => {
        if (loadError.name !== 'AbortError') notify('Watchlist status could not be loaded.', 'error');
      });
    return () => controller.abort();
  }, [notify]);

  async function updateWatchlist(animeId, shouldAdd) {
    await fetchJson('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anime_id: animeId, action: shouldAdd ? 'add' : 'remove' }),
    });
    setWatchlistIds(current => {
      const next = new Set(current);
      if (shouldAdd) next.add(String(animeId)); else next.delete(String(animeId));
      return next;
    });
    notify(shouldAdd ? 'Added to Watchlist.' : 'Removed from Watchlist.', 'success');
  }

  function changeSearch(value) { setSearch(value); setPage(1); }
  function changeGenre(value) { setGenre(value); setPage(1); }
  function changeSort(value) { setSort(value); setPage(1); }

  return (
    <div className="browse-page">
      <div className="browse-header">
        <div><h1>Browse Anime</h1>{!loading && !error && <p className="muted">{total} title{total === 1 ? '' : 's'}</p>}</div>
        <label className="browse-search-wrap">
          <span className="sr-only">Search the full anime library</span>
          <input className="browse-search" type="search" placeholder="Search by title..." value={search} onChange={event => changeSearch(event.target.value)} />
        </label>
      </div>

      <div className="genre-filters" aria-label="Filter by genre">
        <button className={`genre-filter-btn ${genre === '' ? 'active' : ''}`} onClick={() => changeGenre('')}>All</button>
        {ALL_GENRES.map(item => <button key={item} className={`genre-filter-btn ${genre === item ? 'active' : ''}`} onClick={() => changeGenre(genre === item ? '' : item)}>{item}</button>)}
      </div>

      <div className="browse-sort" aria-label="Sort anime">
        {SORTS.map(item => (
          <button key={item} className={`genre-filter-btn ${sort === item ? 'active' : ''}`} onClick={() => changeSort(item)}>
            {item === 'created_at' ? 'Recent' : item === 'rating' ? 'Rating' : item === 'title' ? 'Title' : 'Year'}
          </button>
        ))}
      </div>

      {error ? <ErrorState title="Could not load the library" message={error} onRetry={() => setReloadKey(key => key + 1)} /> : loading ? (
        <div className="anime-grid" aria-label="Loading anime">
          {Array.from({ length: 12 }, (_, index) => <div key={index} className="anime-card"><div className="anime-card-surface"><div className="anime-card-image-wrap skeleton" /><div className="anime-card-info"><div className="skeleton anime-card-skeleton-title" /><div className="skeleton anime-card-skeleton-meta" /></div></div></div>)}
        </div>
      ) : anime.length === 0 ? (
        <div className="empty-state"><div className="icon"><SearchIcon /></div><h3>No anime found</h3><p>Try a different title or filter</p></div>
      ) : (
        <>
          <div className="anime-grid">{anime.map(item => <AnimeCard key={item.id} anime={item} inWatchlist={watchlistIds.has(String(item.id))} onWatchlistChange={updateWatchlist} />)}</div>
          {totalPages > 1 && (
            <nav className="pagination" aria-label="Browse pages">
              <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(current => Math.max(1, current - 1))}>Previous</button>
              <span>Page {page} of {totalPages}</span>
              <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(current => Math.min(totalPages, current + 1))}>Next</button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

export default function BrowsePage() {
  return <Suspense fallback={<div className="browse-page">Loading...</div>}><BrowseContent /></Suspense>;
}
