'use client';
import { useEffect, useMemo, useState } from 'react';

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

function formatBytes(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return null;

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const decimals = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
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

export default function RequestPage() {
  const [configured, setConfigured] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [requestingId, setRequestingId] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [requestedIds, setRequestedIds] = useState({});
  const [expandedIds, setExpandedIds] = useState({});
  const [detailsById, setDetailsById] = useState({});
  const [selectedSeasonsById, setSelectedSeasonsById] = useState({});

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
    setExpandedIds(current => ({ ...current, [result.id]: !current[result.id] }));

    if (detailsById[result.id]?.loaded || detailsById[result.id]?.loading) return;

    setDetailsById(current => ({
      ...current,
      [result.id]: { loading: true, error: '', loaded: false, seasons: [] },
    }));

    try {
      const res = await fetch(`/api/request/details?mediaId=${encodeURIComponent(result.id)}`, { cache: 'no-store' });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Could not load seasons.');
      }

      const seasons = data.seasons || [];

      setDetailsById(current => ({
        ...current,
        [result.id]: { loading: false, error: '', loaded: true, seasons },
      }));
      setSelectedSeasonsById(current => ({
        ...current,
        [result.id]: current[result.id] || initialSeasonSelection(seasons),
      }));
    } catch (detailsError) {
      console.error(detailsError);
      setDetailsById(current => ({
        ...current,
        [result.id]: { loading: false, error: detailsError.message || 'Could not load seasons.', loaded: false, seasons: [] },
      }));
    }
  }

  function toggleSeason(resultId, seasonNumber) {
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
    setSelectedSeasonsById(current => ({
      ...current,
      [resultId]: seasons
        .filter(canRequestSeason)
        .filter(season => includeSpecials || season.seasonNumber > 0)
        .map(season => season.seasonNumber),
    }));
  }

  async function submitRequest(result, seasons = 'all') {
    if (requestingId || !canRequest(result)) return;

    if (Array.isArray(seasons) && seasons.length === 0) {
      setError('Choose at least one season to request.');
      return;
    }

    setRequestingId(result.id);
    setError('');
    setMessage('');

    try {
      const res = await fetch('/api/request/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaId: result.id, seasons }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Request failed.');
      }

      setRequestedIds(current => ({ ...current, [result.id]: true }));
      setMessage(`${result.title} was sent to Seerr.`);
    } catch (requestError) {
      console.error(requestError);
      setError(requestError.message || 'Request failed.');
    } finally {
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
            const label = statusLabel(result.status);
            const alreadySent = requestedIds[result.id];
            const baseDisabled = requestingId === result.id || alreadySent || !canRequest(result);
            const expanded = Boolean(expandedIds[result.id]);
            const details = detailsById[result.id];
            const selectedSeasons = selectedSeasonsById[result.id] || [];
            const selectedDisabled = baseDisabled || selectedSeasons.length === 0;

            return (
              <article key={result.id} className="request-result-card">
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
                    {label && <span>{label}</span>}
                    {result.voteAverage && <span>{Math.round(result.voteAverage * 10)}%</span>}
                  </div>
                  {result.overview && <p>{result.overview}</p>}
                  <button
                    className="btn btn-secondary btn-sm request-result-button"
                    type="button"
                    disabled={requestingId === result.id}
                    onClick={() => loadDetails(result)}
                  >
                    {expanded ? 'Hide Seasons' : 'Choose Seasons'}
                  </button>
                </div>
                {expanded && (
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
                            onClick={() => selectRequestableSeasons(result.id, details.seasons, false)}
                          >
                            Numbered Seasons
                          </button>
                          <button
                            type="button"
                            className="genre-filter-btn"
                            onClick={() => selectRequestableSeasons(result.id, details.seasons, true)}
                          >
                            Include Specials
                          </button>
                          <button
                            type="button"
                            className="genre-filter-btn"
                            onClick={() => setSelectedSeasonsById(current => ({ ...current, [result.id]: [] }))}
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
                                  onChange={() => toggleSeason(result.id, season.seasonNumber)}
                                />
                                <span className="request-season-number">
                                  {season.seasonNumber === 0 ? 'SP' : season.seasonNumber}
                                </span>
                                <span className="request-season-copy">
                                  <strong>{season.name}</strong>
                                  <small>{seasonMeta(season) || 'Season details unavailable'}</small>
                                </span>
                                {season.estimatedSizeBytes && (
                                  <span className="request-season-size">
                                    Est. {formatBytes(season.estimatedSizeBytes)}
                                  </span>
                                )}
                              </label>
                            );
                          })}
                        </div>
                        <button
                          className="btn btn-primary btn-sm request-season-submit"
                          type="button"
                          disabled={selectedDisabled}
                          onClick={() => submitRequest(result, selectedSeasons)}
                        >
                          {requestingId === result.id
                            ? 'Requesting...'
                            : alreadySent
                              ? 'Requested'
                              : requestButtonLabel(details.seasons, selectedSeasons)}
                        </button>
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
