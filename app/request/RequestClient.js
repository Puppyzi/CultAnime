'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

const STATUS_LABELS = {
  1: 'Unknown',
  2: 'Pending',
  3: 'Processing',
  4: 'Partially Available',
  5: 'Available',
};

function statusLabel(status) {
  return STATUS_LABELS[status] || null;
}

function canRequest(result) {
  const label = statusLabel(result.status);
  return !['Pending', 'Processing', 'Available'].includes(label);
}

function resultKey(result) {
  return `${result.mediaType || 'tv'}:${result.id}`;
}

function isMovieResult(result) {
  return result.mediaType === 'movie';
}

function mediaTypeLabel(result) {
  return isMovieResult(result) ? 'Movie' : 'TV Series';
}

function canRequestSeason(season) {
  const label = statusLabel(season.status);
  return !['Pending', 'Processing', 'Available'].includes(label);
}

function seasonMeta(season) {
  return [
    season.year,
    season.episodeCount ? `${season.episodeCount} EP` : null,
    statusLabel(season.status),
  ].filter(Boolean).join(' / ');
}

function requestButtonLabel(seasons, selectedSeasons) {
  const selected = seasons.filter(season => selectedSeasons.includes(season.seasonNumber));
  const requestableNormal = seasons.filter(season => season.seasonNumber > 0 && canRequestSeason(season));

  if (selected.length === 0) return 'Choose Seasons';
  if (
    requestableNormal.length > 0 &&
    selected.length === requestableNormal.length &&
    selected.every(season => season.seasonNumber > 0)
  ) {
    return 'Request All Numbered Seasons';
  }
  if (selected.length === 1) {
    return `Request ${selected[0].name}`;
  }

  return `Request ${selected.length} Seasons`;
}

export default function RequestClient({ initialQuery = '' }) {
  const [configured, setConfigured] = useState(null);
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [requestingId, setRequestingId] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [requestedIds, setRequestedIds] = useState({});
  const [pendingRequestsById, setPendingRequestsById] = useState({});
  const [expandedIds, setExpandedIds] = useState({});
  const [detailsById, setDetailsById] = useState({});
  const [selectedSeasonsById, setSelectedSeasonsById] = useState({});
  const requestInFlightRef = useRef(false);

  useEffect(() => {
    const incomingQuery = new URLSearchParams(window.location.search).get('q');
    if (incomingQuery?.trim()) {
      setQuery(incomingQuery.trim());
    }
  }, []);

  useEffect(() => {
    async function loadStatus() {
      try {
        const res = await fetch('/api/request/status', { cache: 'no-store' });
        const data = await res.json();
        setConfigured(Boolean(data.configured));
      } catch (statusError) {
        console.error(statusError);
        setConfigured(false);
      }
    }

    loadStatus();
  }, []);

  const trimmedQuery = useMemo(() => query.trim(), [query]);

  async function search(event) {
    event?.preventDefault();
    if (trimmedQuery.length < 2 || loading) return;

    setLoading(true);
    setSearched(true);
    setError('');
    setMessage('');
    setPendingRequestsById({});

    try {
      const res = await fetch(`/api/request/search?q=${encodeURIComponent(trimmedQuery)}`, { cache: 'no-store' });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Search failed.');
      }

      setResults(data.results || []);
      setExpandedIds({});
      setDetailsById({});
      setSelectedSeasonsById({});
    } catch (searchError) {
      console.error(searchError);
      setResults([]);
      setError(searchError.message || 'Search failed.');
    } finally {
      setLoading(false);
    }
  }

  function initialSeasonSelection(seasons) {
    const requestable = seasons.filter(canRequestSeason);
    const normalSeasons = requestable.filter(season => season.seasonNumber > 0);
    const selected = normalSeasons.length > 0 ? normalSeasons : requestable;

    return selected.map(season => season.seasonNumber);
  }

  async function loadDetails(result) {
    if (isMovieResult(result)) return;

    const key = resultKey(result);
    const wasExpanded = Boolean(expandedIds[key]);
    setExpandedIds(current => ({ ...current, [key]: !current[key] }));

    if (wasExpanded) {
      clearPendingRequest(key);
    }

    if (detailsById[key]?.loaded || detailsById[key]?.loading) return;

    setDetailsById(current => ({
      ...current,
      [key]: { loading: true, error: '', loaded: false, seasons: [] },
    }));

    try {
      const params = new URLSearchParams({
        mediaId: String(result.id),
        mediaType: result.mediaType || 'tv',
      });
      const res = await fetch(`/api/request/details?${params}`, { cache: 'no-store' });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Could not load seasons.');
      }

      const seasons = data.seasons || [];

      setDetailsById(current => ({
        ...current,
        [key]: { loading: false, error: '', loaded: true, seasons },
      }));
      setSelectedSeasonsById(current => ({
        ...current,
        [key]: current[key] || initialSeasonSelection(seasons),
      }));
    } catch (detailsError) {
      console.error(detailsError);
      setDetailsById(current => ({
        ...current,
        [key]: { loading: false, error: detailsError.message || 'Could not load seasons.', loaded: false, seasons: [] },
      }));
    }
  }

  function toggleSeason(resultId, seasonNumber) {
    clearPendingRequest(resultId);
    setSelectedSeasonsById(current => {
      const selected = new Set(current[resultId] || []);

      if (selected.has(seasonNumber)) {
        selected.delete(seasonNumber);
      } else {
        selected.add(seasonNumber);
      }

      return {
        ...current,
        [resultId]: Array.from(selected).sort((a, b) => a - b),
      };
    });
  }

  function selectRequestableSeasons(resultId, seasons, includeSpecials = false) {
    clearPendingRequest(resultId);
    setSelectedSeasonsById(current => ({
      ...current,
      [resultId]: seasons
        .filter(canRequestSeason)
        .filter(season => includeSpecials || season.seasonNumber > 0)
        .map(season => season.seasonNumber),
    }));
  }

  function clearPendingRequest(key) {
    setPendingRequestsById(current => {
      if (!current[key]) return current;

      const { [key]: _removed, ...remaining } = current;
      return remaining;
    });
  }

  function beginRequest(result, seasons = 'all') {
    const key = resultKey(result);

    if (requestInFlightRef.current || requestingId || requestedIds[key] || !canRequest(result)) return;

    if (!isMovieResult(result) && Array.isArray(seasons) && seasons.length === 0) {
      setError('Choose at least one season to request.');
      return;
    }

    const seasonSnapshot = Array.isArray(seasons) ? [...seasons] : seasons;

    setError('');
    setMessage('');
    setPendingRequestsById(current => ({
      ...current,
      [key]: { seasons: seasonSnapshot },
    }));
  }

  function confirmRequest(result) {
    const key = resultKey(result);
    const pendingRequest = pendingRequestsById[key];

    if (!pendingRequest || requestInFlightRef.current || requestingId || requestedIds[key]) return;

    clearPendingRequest(key);
    submitRequest(result, pendingRequest.seasons);
  }

  async function submitRequest(result, seasons = 'all') {
    const key = resultKey(result);

    if (requestInFlightRef.current || requestingId || requestedIds[key] || !canRequest(result)) return;

    if (!isMovieResult(result) && Array.isArray(seasons) && seasons.length === 0) {
      setError('Choose at least one season to request.');
      return;
    }

    requestInFlightRef.current = true;
    setRequestingId(key);
    setError('');
    setMessage('');

    try {
      const res = await fetch('/api/request/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaId: result.id,
          mediaType: result.mediaType || 'tv',
          seasons: isMovieResult(result) ? undefined : seasons,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Request failed.');
      }

      setRequestedIds(current => ({ ...current, [key]: true }));
      setMessage(`${result.title} was sent to Seerr${isMovieResult(result) ? ' as an anime movie' : ''}.`);
    } catch (requestError) {
      console.error(requestError);
      setError(requestError.message || 'Request failed.');
    } finally {
      requestInFlightRef.current = false;
      setRequestingId(null);
    }
  }

  if (configured === false) {
    return (
      <div className="request-page">
        <div className="request-card">
          <p className="request-kicker">Requests</p>
          <h1>Seerr is not configured</h1>
          <p>Add these values to the server env, then rebuild/restart CultAnime.</p>
          <pre className="request-env">SEERR_URL=http://your-seerr-ip:5055{'\n'}SEERR_API_KEY=your_seerr_api_key</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="request-page request-page-shell">
      <div className="request-header">
        <div>
          <p className="request-kicker">Requests</p>
          <h1>Request Anime</h1>
        </div>
      </div>

      <form className="request-search-form" onSubmit={search}>
        <input
          className="request-search-input"
          type="text"
          placeholder="Search anime title..."
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
        <button className="btn btn-primary" type="submit" disabled={loading || trimmedQuery.length < 2}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {error && <div className="request-alert error">{error}</div>}
      {message && <div className="request-alert success">{message}</div>}

      {configured === null ? (
        <div className="request-loading-grid">
          {Array(6).fill(0).map((_, index) => (
            <div key={index} className="request-result-card">
              <div className="skeleton request-result-poster" />
              <div className="request-result-copy">
                <div className="skeleton request-title-skeleton" />
                <div className="skeleton request-meta-skeleton" />
              </div>
            </div>
          ))}
        </div>
      ) : searched && !loading && results.length === 0 && !error ? (
        <div className="empty-state">
          <div className="icon">A-Z</div>
          <h3>No matches found</h3>
          <p>Try another anime title.</p>
        </div>
      ) : (
        <div className="request-results-grid">
          {results.map(result => {
            const key = resultKey(result);
            const movie = isMovieResult(result);
            const label = statusLabel(result.status);
            const alreadySent = requestedIds[key];
            const pendingRequest = pendingRequestsById[key];
            const baseDisabled = requestingId === key || alreadySent || !canRequest(result);
            const requestStartDisabled = Boolean(requestingId) || alreadySent || !canRequest(result);
            const confirmDisabled = Boolean(requestingId) || alreadySent || !canRequest(result);
            const expanded = Boolean(expandedIds[key]);
            const details = detailsById[key];
            const selectedSeasons = selectedSeasonsById[key] || [];
            const selectedDisabled = requestStartDisabled || selectedSeasons.length === 0;

            return (
              <article key={key} className="request-result-card">
                <img
                  className="request-result-poster"
                  src={result.poster || '/placeholder.png'}
                  alt={result.title}
                />
                <div className="request-result-copy">
                  <div className="request-result-title-row">
                    <h2>{result.title}</h2>
                    {result.year && <span>{result.year}</span>}
                  </div>
                  <div className="request-result-meta">
                    <span>{mediaTypeLabel(result)}</span>
                    {label && <span>{label}</span>}
                    {result.voteAverage && <span>{Math.round(result.voteAverage * 10)}%</span>}
                  </div>
                  {result.overview && <p>{result.overview}</p>}
                  {movie && pendingRequest ? (
                    <div className="request-confirm-actions request-result-confirm-actions">
                      <button
                        className="btn btn-secondary btn-sm"
                        type="button"
                        disabled={confirmDisabled}
                        onClick={() => confirmRequest(result)}
                      >
                        Confirm
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        type="button"
                        disabled={Boolean(requestingId)}
                        onClick={() => clearPendingRequest(key)}
                      >
                        Undo
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn btn-secondary btn-sm request-result-button"
                      type="button"
                      disabled={movie ? requestStartDisabled : requestingId === key}
                      onClick={() => (movie ? beginRequest(result) : loadDetails(result))}
                    >
                      {movie
                        ? requestingId === key
                          ? 'Requesting...'
                          : alreadySent
                            ? 'Requested'
                            : 'Request Movie'
                        : expanded ? 'Hide Seasons' : 'Choose Seasons'}
                    </button>
                  )}
                </div>
                {!movie && expanded && (
                  <div className="request-season-panel">
                    {details?.loading ? (
                      <div className="request-season-loading">
                        <div className="skeleton request-title-skeleton" />
                        <div className="skeleton request-meta-skeleton" />
                      </div>
                    ) : details?.error ? (
                      <div className="request-season-error">{details.error}</div>
                    ) : details?.seasons?.length > 0 ? (
                      <>
                        <div className="request-season-actions">
                          <button
                            type="button"
                            className="genre-filter-btn"
                            onClick={() => selectRequestableSeasons(key, details.seasons, false)}
                          >
                            Numbered Seasons
                          </button>
                          <button
                            type="button"
                            className="genre-filter-btn"
                            onClick={() => selectRequestableSeasons(key, details.seasons, true)}
                          >
                            Include Specials
                          </button>
                          <button
                            type="button"
                            className="genre-filter-btn"
                            onClick={() => {
                              clearPendingRequest(key);
                              setSelectedSeasonsById(current => ({ ...current, [key]: [] }));
                            }}
                          >
                            Clear
                          </button>
                        </div>
                        <div className="request-season-list">
                          {details.seasons.map(season => {
                            const seasonDisabled = !canRequestSeason(season) || baseDisabled;
                            const checked = selectedSeasons.includes(season.seasonNumber);

                            return (
                              <label key={season.seasonNumber} className={`request-season-row${seasonDisabled ? ' disabled' : ''}`}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={seasonDisabled}
                                  onChange={() => toggleSeason(key, season.seasonNumber)}
                                />
                                <span className="request-season-number">
                                  {season.seasonNumber === 0 ? 'SP' : season.seasonNumber}
                                </span>
                                <span className="request-season-copy">
                                  <strong>{season.name}</strong>
                                  <small>{seasonMeta(season) || 'Season details unavailable'}</small>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                        {pendingRequest ? (
                          <div className="request-confirm-actions request-season-confirm-actions">
                            <button
                              className="btn btn-primary btn-sm"
                              type="button"
                              disabled={confirmDisabled}
                              onClick={() => confirmRequest(result)}
                            >
                              Confirm
                            </button>
                            <button
                              className="btn btn-secondary btn-sm"
                              type="button"
                              disabled={Boolean(requestingId)}
                              onClick={() => clearPendingRequest(key)}
                            >
                              Undo
                            </button>
                          </div>
                        ) : (
                          <button
                            className="btn btn-primary btn-sm request-season-submit"
                            type="button"
                            disabled={selectedDisabled}
                            onClick={() => beginRequest(result, selectedSeasons)}
                          >
                            {requestingId === key
                              ? 'Requesting...'
                              : alreadySent
                                ? 'Requested'
                                : requestButtonLabel(details.seasons, selectedSeasons)}
                          </button>
                        )}
                      </>
                    ) : (
                      <div className="request-season-error">No seasons were returned by Seerr for this title.</div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
