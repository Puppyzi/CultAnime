'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AIRING_SORT_OPTIONS,
  normalizeAiringSort,
  sortAnime,
  titleForAnime,
} from '../../lib/airingSort';

const SEASON_NAMES = {
  WINTER: 'Winter',
  SPRING: 'Spring',
  SUMMER: 'Summer',
  FALL: 'Fall',
};
function titleFor(anime) {
  return titleForAnime(anime);
}

function requestTitleFor(anime) {
  return anime.request_title || anime.title_romaji || titleFor(anime);
}

function metaFor(anime) {
  return [
    anime.format?.replace(/_/g, ' '),
    anime.episodes_total ? `${anime.episodes_total} EP` : null,
    anime.rating ? `${anime.rating}%` : null,
  ].filter(Boolean).join(' / ');
}

function formatAiringDate(airingAt) {
  if (!airingAt) return null;

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(Number(airingAt) * 1000));
}

function releaseStatusText(anime) {
  const next = anime.next_airing_episode;
  if (!next?.episode) {
    if (anime.format === 'MOVIE') return anime.status === 'NOT_YET_RELEASED' ? 'Upcoming' : 'Movie';
    if (anime.status === 'NOT_YET_RELEASED') return 'Upcoming';
    if (anime.status === 'FINISHED') return 'Released';
    return 'Airing now';
  }

  const airDate = formatAiringDate(next.airingAt);
  return airDate ? `EP ${next.episode} airs ${airDate}` : `EP ${next.episode} next`;
}

function sortHrefFor(sortKey) {
  return sortKey === 'popularity' ? '/airing' : `/airing?sort=${encodeURIComponent(sortKey)}`;
}

export default function AiringClient({ initialGroups, initialSeason, initialYear, initialSort, initialError }) {
  const [groups, setGroups] = useState(initialGroups || []);
  const [season, setSeason] = useState(initialSeason || '');
  const [year, setYear] = useState(initialYear || '');
  const [query, setQuery] = useState('');
  const [loadingMoreKey, setLoadingMoreKey] = useState(null);
  const [error, setError] = useState(initialError || '');
  const [pendingRequestIds, setPendingRequestIds] = useState({});
  const sortRef = useRef(null);
  const sortToggleRef = useRef(null);
  const sortKey = normalizeAiringSort(initialSort);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key !== 'Escape' || !sortToggleRef.current?.checked) return;
      sortToggleRef.current.checked = false;
      if (sortRef.current?.contains(document.activeElement)) document.activeElement.blur();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  async function loadMore(group) {
    if (!group?.pageInfo?.hasNextPage || loadingMoreKey) return;

    setLoadingMoreKey(group.key);
    setError('');

    try {
      const nextPage = Number(group.pageInfo.currentPage || 1) + 1;
      const res = await fetch(`/api/airing?category=${encodeURIComponent(group.key)}&page=${nextPage}`, { cache: 'no-store' });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Could not load more airing anime.');
      }

      setSeason(data.season || season);
      setYear(data.year || year);
      setGroups(current => current.map(currentGroup => (
        currentGroup.key === group.key
          ? {
            ...currentGroup,
            pageInfo: data.category?.pageInfo || data.pageInfo || null,
            anime: [...currentGroup.anime, ...(data.category?.anime || data.anime || [])],
          }
          : currentGroup
      )));
    } catch (loadError) {
      console.error(loadError);
      setError(loadError.message || 'Could not load more airing anime.');
    } finally {
      setLoadingMoreKey(null);
    }
  }

  function beginRequest(animeId) {
    setPendingRequestIds(current => ({ ...current, [animeId]: true }));
  }

  function undoRequest(animeId) {
    setPendingRequestIds(current => {
      const { [animeId]: _removed, ...remaining } = current;
      return remaining;
    });
  }

  const filteredGroups = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return groups;

    return groups.map(group => ({
      ...group,
      anime: group.anime.filter(item => [
        item.title,
        item.title_romaji,
        item.title_english,
        item.title_native,
        ...(item.genres || []),
        ...(item.studios || []),
      ].filter(Boolean).some(value => String(value).toLowerCase().includes(trimmed))),
    }));
  }, [groups, query]);

  const sortedGroups = useMemo(() => filteredGroups.map(group => ({
    ...group,
    anime: sortAnime(group.anime, sortKey),
  })), [filteredGroups, sortKey]);

  const shownCount = sortedGroups.reduce((total, group) => total + group.anime.length, 0);
  const activeSort = AIRING_SORT_OPTIONS.find(option => option.key === sortKey) || AIRING_SORT_OPTIONS[0];

  const heading = season && year
    ? `${SEASON_NAMES[season] || season} ${year} Airing`
    : 'Airing Anime';

  return (
    <div className="airing-page">
      <div className="airing-header">
        <div>
          <p className="airing-kicker">Airing</p>
          <h1>{heading}</h1>
        </div>
        <div className="airing-header-actions">
          <div className="airing-count">
            {`${shownCount} shown`}
          </div>
          <div className="airing-sort" ref={sortRef}>
            <input
              ref={sortToggleRef}
              className="airing-sort-toggle"
              id="airing-sort-toggle"
              type="checkbox"
              aria-label={`Sort airing anime. Current sort: ${activeSort.label}`}
            />
            <label
              className="airing-sort-button"
              htmlFor="airing-sort-toggle"
              title="Sort"
              role="button"
              aria-haspopup="menu"
              aria-controls="airing-sort-menu"
            >
              <span className="airing-sort-icon" aria-hidden="true" />
              <span>{activeSort.label}</span>
              <span className="airing-sort-caret" aria-hidden="true" />
            </label>
            <label
              className="airing-sort-backdrop"
              htmlFor="airing-sort-toggle"
              aria-hidden="true"
            />
            <div id="airing-sort-menu" className="airing-sort-menu" role="menu">
              {AIRING_SORT_OPTIONS.map(option => (
                <Link
                  key={option.key}
                  className={option.key === sortKey ? 'active' : ''}
                  href={sortHrefFor(option.key)}
                  aria-current={option.key === sortKey ? 'true' : undefined}
                  role="menuitemradio"
                  aria-checked={option.key === sortKey}
                >
                  {option.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="airing-toolbar">
        <input
          className="airing-search"
          type="text"
          placeholder="Filter by title, genre, or studio..."
          value={query}
          onChange={event => {
            setQuery(event.target.value);
            setPendingRequestIds({});
          }}
        />
      </div>

      {error && (
        <div className="request-alert error">{error}</div>
      )}

      {shownCount === 0 && !error ? (
        <div className="empty-state">
          <div className="icon">A-Z</div>
          <h3>No airing anime found</h3>
          <p>Try a different filter.</p>
        </div>
      ) : (
        <div className="airing-sections">
          {sortedGroups.map(group => (
            <section key={group.key} className="airing-section">
              <div className="airing-section-header">
                <h2>{group.label}</h2>
                <span>{group.anime.length}</span>
              </div>

              {group.anime.length === 0 ? (
                <div className="airing-empty-section">No titles found</div>
              ) : (
                <>
                  <div className="airing-grid">
                    {group.anime.map(item => (
                      <article key={item.anilist_id} className="airing-card">
                        <img
                          className="airing-card-poster"
                          src={item.cover_image || '/placeholder.png'}
                          alt={titleFor(item)}
                          loading="lazy"
                          decoding="async"
                        />
                        <div className="airing-card-copy">
                          <div className="airing-title-row">
                            <h2>{titleFor(item)}</h2>
                            <span>{releaseStatusText(item)}</span>
                          </div>
                          {item.title_romaji && item.title_romaji !== titleFor(item) && (
                            <p className="airing-romaji">{item.title_romaji}</p>
                          )}
                          <div className="airing-meta">
                            {metaFor(item) && <span>{metaFor(item)}</span>}
                            {item.studios?.[0] && <span>{item.studios[0]}</span>}
                          </div>
                          {item.description && <p className="airing-description">{item.description}</p>}
                          {item.genres?.length > 0 && (
                            <div className="airing-genres">
                              {item.genres.slice(0, 4).map(genre => (
                                <span key={genre}>{genre}</span>
                              ))}
                            </div>
                          )}
                          <div className="airing-actions">
                            {pendingRequestIds[item.anilist_id] ? (
                              <>
                                <Link
                                  className="btn btn-primary btn-sm"
                                  href={`/request?q=${encodeURIComponent(requestTitleFor(item))}`}
                                >
                                  Confirm
                                </Link>
                                <button
                                  className="btn btn-secondary btn-sm"
                                  type="button"
                                  onClick={() => undoRequest(item.anilist_id)}
                                >
                                  Undo
                                </button>
                              </>
                            ) : (
                              <button
                                className="btn btn-primary btn-sm"
                                type="button"
                                onClick={() => beginRequest(item.anilist_id)}
                              >
                                Request
                              </button>
                            )}
                            <a
                              className="btn btn-secondary btn-sm"
                              href={`https://anilist.co/anime/${item.anilist_id}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              AniList
                            </a>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>

                  {group.pageInfo?.hasNextPage && !query.trim() && (
                    <div className="airing-load-more">
                      <button
                        className="btn btn-secondary"
                        type="button"
                        disabled={Boolean(loadingMoreKey)}
                        onClick={() => loadMore(group)}
                      >
                        {loadingMoreKey === group.key ? 'Loading...' : `Load More ${group.label}`}
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
