'use client';
import { useState, useEffect } from 'react';

const emptyEpisodeEditForm = {
  id: '',
  episode_number: '',
  title: '',
  file_path: '',
  air_date: '',
  runtime_minutes: '',
  overview: '',
};

function formatEpisodeDate(value) {
  if (!value) return 'No date';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function formatEpisodeRuntime(seconds) {
  if (!seconds) return 'No runtime';
  const minutes = Math.max(1, Math.round(Number(seconds) / 60));
  return `${minutes}m`;
}

function syncItemTypeLabel(item) {
  return item?.item_type === 'movie' ? 'Movie' : 'Series';
}

function syncUnit(count, itemType) {
  const value = Number(count) || 0;
  const unit = itemType === 'movie' ? 'movie file' : 'episode';
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

function syncResultText(result) {
  if (result.status === 'created') {
    return `Created - ${syncUnit(result.episodes_added, result.item_type)}`;
  }

  if (result.status === 'updated') {
    const parts = [
      `${syncUnit(result.episodes_added, result.item_type)} new`,
      `${result.episodes_updated || 0} refreshed`,
    ];

    if (result.episodes_removed) {
      parts.push(`${syncUnit(result.episodes_removed, result.item_type)} removed`);
    }

    return `Updated - ${parts.join(', ')}`;
  }

  if (result.status === 'error') {
    return `Error: ${result.error}`;
  }

  return result.status;
}

function episodeToEditForm(ep) {
  return {
    id: ep.id,
    episode_number: String(ep.episode_number || ''),
    title: ep.title || '',
    file_path: ep.file_path || '',
    air_date: ep.air_date || '',
    runtime_minutes: ep.duration ? String(Math.max(1, Math.round(Number(ep.duration) / 60))) : '',
    overview: ep.overview || '',
  };
}

export default function AdminPage() {
  const [tab, setTab] = useState('add');
  const [animeList, setAnimeList] = useState([]);
  const [selectedAnime, setSelectedAnime] = useState(null);
  const [anilistQuery, setAnilistQuery] = useState('');
  const [anilistResults, setAnilistResults] = useState([]);
  const [toast, setToast] = useState(null);

  // Sync state
  const [syncPreview, setSyncPreview] = useState(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResults, setSyncResults] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [rescanStatus, setRescanStatus] = useState(null);
  const [rescanLoading, setRescanLoading] = useState(false);
  const [rescanStarting, setRescanStarting] = useState(false);
  const [editingEpisodeId, setEditingEpisodeId] = useState(null);
  const [episodeEditForm, setEpisodeEditForm] = useState(emptyEpisodeEditForm);

  // Form state
  const [form, setForm] = useState({
    title: '', title_romaji: '', title_english: '', description: '',
    cover_image: '', banner_image: '', genres: '', status: '',
    episodes_total: '', rating: '', year: '', season: '', format: '', anilist_id: '',
  });

  // Episode form
  const [epForm, setEpForm] = useState({ anime_id: '', episode_number: '', title: '', file_path: '' });

  useEffect(() => {
    loadAnimeList();
    loadRescanStatus({ silent: true });
  }, []);

  useEffect(() => {
    if (tab !== 'sync') return undefined;

    loadRescanStatus({ silent: true });
    const interval = window.setInterval(() => loadRescanStatus({ silent: true }), 5000);
    return () => window.clearInterval(interval);
  }, [tab]);

  async function loadAnimeList() {
    const res = await fetch('/api/anime?limit=100');
    const data = await res.json();
    setAnimeList(data.anime || []);
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  function syncSummary(data) {
    const created = data.results?.filter(r => r.status === 'created').length || 0;
    const updated = data.results?.filter(r => r.status === 'updated').length || 0;
    const removed = data.removed_count || 0;
    const episodesRemoved = data.results?.reduce((total, r) => total + (r.episodes_removed || 0), 0) || 0;
    const parts = [`${created} new`, `${updated} updated`];

    if (removed > 0) parts.push(`${removed} removed`);
    if (episodesRemoved > 0) parts.push(`${episodesRemoved} episodes removed`);

    return parts.join(', ');
  }

  async function searchAnilist() {
    if (!anilistQuery.trim()) return;
    const res = await fetch(`/api/admin/anilist?q=${encodeURIComponent(anilistQuery)}`);
    const data = await res.json();
    setAnilistResults(data.results || []);
  }

  async function importFromAnilist(anilistId) {
    const res = await fetch('/api/admin/anilist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anilist_id: anilistId }),
    });
    const data = await res.json();
    if (data.anime) {
      setForm({
        ...data.anime,
        genres: Array.isArray(JSON.parse(data.anime.genres || '[]'))
          ? JSON.parse(data.anime.genres).join(', ') : data.anime.genres,
        episodes_total: data.anime.episodes_total || '',
        rating: data.anime.rating || '',
        year: data.anime.year || '',
      });
      setAnilistResults([]);
      showToast('Metadata imported from AniList!');
    }
  }

  async function saveAnime(e) {
    e.preventDefault();
    const body = {
      ...form,
      genres: JSON.stringify(form.genres.split(',').map(g => g.trim()).filter(Boolean)),
      episodes_total: form.episodes_total ? parseInt(form.episodes_total) : null,
      rating: form.rating ? parseInt(form.rating) : null,
      year: form.year ? parseInt(form.year) : null,
      anilist_id: form.anilist_id ? parseInt(form.anilist_id) : null,
    };

    const res = await fetch('/api/admin/anime', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.success) {
      showToast('Anime added successfully!');
      setForm({ title: '', title_romaji: '', title_english: '', description: '',
        cover_image: '', banner_image: '', genres: '', status: '',
        episodes_total: '', rating: '', year: '', season: '', format: '', anilist_id: '' });
      loadAnimeList();
    } else {
      showToast(data.error || 'Error adding anime', 'error');
    }
  }

  async function deleteAnime(id) {
    if (!confirm('Delete this anime and all its episodes?')) return;
    await fetch('/api/admin/anime', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    showToast('Anime deleted');
    loadAnimeList();
    if (selectedAnime?.id === id) setSelectedAnime(null);
  }

  async function addEpisode(e) {
    e.preventDefault();
    const res = await fetch('/api/admin/episodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anime_id: parseInt(epForm.anime_id),
        episode_number: parseInt(epForm.episode_number),
        title: epForm.title,
        file_path: epForm.file_path,
      }),
    });
    const data = await res.json();
    if (data.success) {
      showToast('Episode added!');
      setEpForm({ ...epForm, episode_number: String(parseInt(epForm.episode_number) + 1), title: '', file_path: '' });
      loadAnimeList();
      if (selectedAnime) {
        const r = await fetch(`/api/anime/${selectedAnime.id}`);
        setSelectedAnime(await r.json());
      }
    } else {
      showToast(data.error || 'Error', 'error');
    }
  }

  async function deleteEpisode(id) {
    await fetch('/api/admin/episodes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    showToast('Episode deleted');
    if (editingEpisodeId === id) cancelEditEpisode();
    if (selectedAnime) {
      const r = await fetch(`/api/anime/${selectedAnime.id}`);
      setSelectedAnime(await r.json());
    }
    loadAnimeList();
  }

  async function reloadSelectedAnime(id = selectedAnime?.id) {
    if (!id) return;
    const r = await fetch(`/api/anime/${id}`);
    setSelectedAnime(await r.json());
  }

  function startEditEpisode(ep) {
    setEditingEpisodeId(ep.id);
    setEpisodeEditForm(episodeToEditForm(ep));
  }

  function cancelEditEpisode() {
    setEditingEpisodeId(null);
    setEpisodeEditForm(emptyEpisodeEditForm);
  }

  async function saveEpisode(e) {
    e.preventDefault();

    const body = {
      id: episodeEditForm.id,
      episode_number: parseInt(episodeEditForm.episode_number),
      title: episodeEditForm.title,
      file_path: episodeEditForm.file_path,
      air_date: episodeEditForm.air_date || null,
      duration: episodeEditForm.runtime_minutes ? Math.round(Number(episodeEditForm.runtime_minutes) * 60) : null,
      overview: episodeEditForm.overview || null,
    };

    const res = await fetch('/api/admin/episodes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (data.success) {
      showToast('Episode metadata saved!');
      cancelEditEpisode();
      reloadSelectedAnime();
      loadAnimeList();
    } else {
      showToast(data.error || 'Error saving episode', 'error');
    }
  }

  async function selectAnime(anime) {
    const res = await fetch(`/api/anime/${anime.id}`);
    const data = await res.json();
    setSelectedAnime(data);
    setEpForm({ anime_id: String(data.id), episode_number: String((data.episodes?.length || 0) + 1), title: '', file_path: '' });
    cancelEditEpisode();
    setTab('episodes');
  }

  // --- Sync functions ---
  async function loadSyncPreview() {
    setSyncLoading(true);
    setSyncResults(null);
    try {
      const res = await fetch('/api/admin/sync');
      if (!res.ok) {
        let errorMsg = `Server error (${res.status})`;
        try {
          const data = await res.json();
          errorMsg = data.error || errorMsg;
        } catch { /* response wasn't JSON */ }
        showToast(errorMsg, 'error');
        setSyncLoading(false);
        return;
      }
      const data = await res.json();
      setSyncPreview(data);
    } catch (err) {
      showToast('Failed to connect to server: ' + err.message, 'error');
    }
    setSyncLoading(false);
  }

  async function syncSeries(jellyfinIds) {
    setSyncing(true);
    setSyncResults(null);
    try {
      const res = await fetch('/api/admin/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jellyfin_ids: jellyfinIds }),
      });
      const data = await res.json();
      setSyncResults(data);
      loadAnimeList();
      loadSyncPreview();
      showToast(`Synced! ${syncSummary(data)}.`);
    } catch (err) {
      showToast('Sync failed: ' + err.message, 'error');
    }
    setSyncing(false);
  }

  async function syncAll() {
    setSyncing(true);
    setSyncResults(null);
    try {
      const res = await fetch('/api/admin/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sync_all: true }),
      });
      const data = await res.json();
      setSyncResults(data);
      loadAnimeList();
      loadSyncPreview();
      showToast(`Synced all! ${syncSummary(data)}.`);
    } catch (err) {
      showToast('Sync failed: ' + err.message, 'error');
    }
    setSyncing(false);
  }

  async function loadRescanStatus({ silent = false } = {}) {
    if (!silent) setRescanLoading(true);
    try {
      const res = await fetch('/api/admin/rescan');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Server error (${res.status})`);
      }
      setRescanStatus(data);
    } catch (err) {
      if (!silent) showToast('Rescan status failed: ' + err.message, 'error');
    }
    if (!silent) setRescanLoading(false);
  }

  async function triggerFullRescan() {
    setRescanStarting(true);
    try {
      const res = await fetch('/api/admin/rescan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullRefresh: true, reason: 'admin-manual', syncAfter: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Server error (${res.status})`);
      }
      setRescanStatus(data);
      showToast('Jellyfin rescan job queued.');
    } catch (err) {
      showToast('Rescan failed: ' + err.message, 'error');
    }
    setRescanStarting(false);
  }

  async function triggerLibraryReconcile() {
    setRescanStarting(true);
    try {
      const res = await fetch('/api/admin/rescan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reconcile: true, force: true, reason: 'admin-manual-reconcile' }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Server error (${res.status})`);
      }
      setRescanStatus(data);
      loadAnimeList();
      loadSyncPreview();
      const removed = data.reconcile?.result?.removed_count || 0;
      const episodesRemoved = data.reconcile?.result?.results?.reduce((total, item) => total + (item.episodes_removed || 0), 0) || 0;
      showToast(`Library reconciled. ${removed} anime removed, ${episodesRemoved} episodes removed.`);
    } catch (err) {
      showToast('Reconcile failed: ' + err.message, 'error');
    }
    setRescanStarting(false);
  }

  async function logoutAdmin() {
    await fetch('/api/admin/auth', { method: 'DELETE' });
    window.location.href = '/admin/login';
  }

  const tabs = [
    { id: 'sync', label: '🔄 Sync Library' },
    { id: 'add', label: '➕ Add Anime' },
    { id: 'manage', label: '📋 Manage' },
    { id: 'episodes', label: '🎬 Episodes' },
  ];

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1>Admin Panel</h1>
          <p className="subtitle">Manage your anime library</p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={logoutAdmin}>
          Logout
        </button>
      </div>

      <div className="admin-tabs">
        {tabs.map(t => (
          <button key={t.id} className={`admin-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* SYNC LIBRARY TAB */}
      {tab === 'sync' && (
        <div>
          <div className="admin-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <div>
                <h3 style={{ margin: 0 }}>Automatic Jellyfin Rescan</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                  Watches your media folder for completed file changes, batches them, tells Jellyfin to rescan, then syncs CultAnime.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button className="btn btn-secondary" onClick={() => loadRescanStatus()} disabled={rescanLoading}>
                  {rescanLoading ? 'Checking...' : 'Refresh Status'}
                </button>
                <button className="btn btn-secondary" onClick={triggerLibraryReconcile} disabled={rescanStarting}>
                  {rescanStarting ? 'Checking...' : 'Reconcile Library'}
                </button>
                <button className="btn btn-primary" onClick={triggerFullRescan} disabled={rescanStarting}>
                  {rescanStarting ? 'Queueing...' : 'Force Full Rescan'}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <div style={{ background: 'var(--bg-tertiary)', padding: '0.75rem 1rem', borderRadius: 'var(--radius)', flex: 1, minWidth: '150px' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Watcher</div>
                <div style={{
                  fontWeight: 800,
                  color: rescanStatus?.watcher?.started ? '#22c55e' : rescanStatus?.watcher?.enabled === false ? 'var(--text-muted)' : 'var(--text-secondary)',
                }}>
                  {rescanStatus?.watcher?.started ? 'Running' : rescanStatus?.watcher?.enabled === false ? 'Disabled' : 'Not Started'}
                </div>
              </div>
              <div style={{ background: 'var(--bg-tertiary)', padding: '0.75rem 1rem', borderRadius: 'var(--radius)', flex: 1, minWidth: '150px' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Watched Directories</div>
                <div style={{ fontWeight: 800 }}>{rescanStatus?.watcher?.watchedDirectories ?? 0}</div>
              </div>
              <div style={{ background: 'var(--bg-tertiary)', padding: '0.75rem 1rem', borderRadius: 'var(--radius)', flex: 1, minWidth: '150px' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Reconciler</div>
                <div style={{
                  fontWeight: 800,
                  color: rescanStatus?.reconciler?.running ? 'var(--accent)' : rescanStatus?.reconciler?.enabled ? '#22c55e' : 'var(--text-muted)',
                }}>
                  {rescanStatus?.reconciler?.running ? 'Running' : rescanStatus?.reconciler?.enabled ? 'Enabled' : 'Disabled'}
                </div>
              </div>
              <div style={{ background: 'var(--bg-tertiary)', padding: '0.75rem 1rem', borderRadius: 'var(--radius)', flex: 1, minWidth: '150px' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Pending Changes</div>
                <div style={{ fontWeight: 800 }}>{rescanStatus?.watcher?.pendingUpdates?.length ?? 0}</div>
              </div>
            </div>

            {rescanStatus?.watcher?.lastError && (
              <div style={{ padding: '0.75rem', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 'var(--radius)', color: '#fca5a5', fontSize: '0.82rem', marginBottom: '1rem' }}>
                {rescanStatus.watcher.lastError}
              </div>
            )}

            {rescanStatus?.watcher?.enabled === false && (
              <div style={{ padding: '0.75rem', background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: 'var(--radius)', color: 'var(--text-secondary)', fontSize: '0.82rem', marginBottom: '1rem' }}>
                Local development mode is active. Automatic folder watching is disabled here and should be enabled on the server where the anime files are mounted.
              </div>
            )}

            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'grid', gap: '0.25rem', marginBottom: '1rem' }}>
              <div><strong>Media root:</strong> {rescanStatus?.watcher?.root || 'Not configured'}</div>
              <div><strong>Jellyfin path:</strong> {rescanStatus?.watcher?.jellyfinRoot || 'Not configured'}</div>
              {rescanStatus?.watcher?.roots?.filter(root => root.kind === 'movie').map(root => (
                <div key={`${root.root}:${root.jellyfinRoot}`}>
                  <strong>Anime movie path:</strong> {root.root} -&gt; {root.jellyfinRoot}
                </div>
              ))}
              <div><strong>Quiet window:</strong> {Math.round((rescanStatus?.watcher?.debounceMs || 0) / 1000)}s before rescanning</div>
            </div>

            {rescanStatus?.jobs?.length > 0 && (
              <div style={{ background: 'var(--bg-tertiary)', borderRadius: 'var(--radius)', padding: '0.75rem' }}>
                <h4 style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>Recent Rescan Jobs</h4>
                {rescanStatus.jobs.slice(0, 5).map(job => (
                  <div key={job.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.45rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.78rem' }}>
                    <span>{job.reason} - {job.updates?.length || (job.fullRefresh ? 1 : 0)} path{(job.updates?.length || 0) === 1 ? '' : 's'}</span>
                    <span style={{ color: job.status === 'error' ? '#f87171' : job.status === 'completed' ? '#22c55e' : 'var(--accent)' }}>{job.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="admin-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ margin: 0 }}>🔄 Jellyfin Library Sync</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                  Automatically import anime series and anime movies from your Jellyfin server with AniList metadata.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-secondary" onClick={loadSyncPreview} disabled={syncLoading}>
                  {syncLoading ? '⏳ Scanning...' : '🔍 Scan Jellyfin'}
                </button>
              </div>
            </div>

            {!syncPreview && !syncLoading && (
              <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
                <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📡</p>
                <p>Click <strong>Scan Jellyfin</strong> to see what anime are available to import.</p>
              </div>
            )}

            {syncLoading && (
              <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
                <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⏳</p>
                <p>Scanning your Jellyfin library...</p>
              </div>
            )}

            {syncPreview && !syncLoading && (
              <>
                <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                  <div style={{ background: 'var(--bg-tertiary)', padding: '0.75rem 1rem', borderRadius: 'var(--radius)', flex: 1, minWidth: '120px' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{syncPreview.total}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>In Jellyfin</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      {syncPreview.series_count || 0} series / {syncPreview.movie_count || 0} movies
                    </div>
                  </div>
                  <div style={{ background: 'var(--bg-tertiary)', padding: '0.75rem 1rem', borderRadius: 'var(--radius)', flex: 1, minWidth: '120px' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#22c55e' }}>{syncPreview.new_count}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>New</div>
                  </div>
                  <div style={{ background: 'var(--bg-tertiary)', padding: '0.75rem 1rem', borderRadius: 'var(--radius)', flex: 1, minWidth: '120px' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{syncPreview.existing_count}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Already Synced</div>
                  </div>
                  <div style={{ background: 'var(--bg-tertiary)', padding: '0.75rem 1rem', borderRadius: 'var(--radius)', flex: 1, minWidth: '120px' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: syncPreview.removed_count > 0 ? '#f87171' : 'var(--text-secondary)' }}>{syncPreview.removed_count || 0}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Missing in Jellyfin</div>
                  </div>
                </div>

                {(syncPreview.new_count > 0 || syncPreview.removed_count > 0) && (
                  <button className="btn btn-primary" onClick={syncAll} disabled={syncing} style={{ marginBottom: '1rem' }}>
                    {syncing ? 'Syncing...' : `Sync Library Changes (${syncPreview.new_count || 0} new, ${syncPreview.removed_count || 0} removed)`}
                  </button>
                )}

                {syncPreview.existing_count > 0 && (
                  <button className="btn btn-secondary" onClick={syncAll} disabled={syncing} style={{ marginBottom: '1rem', marginLeft: (syncPreview.new_count > 0 || syncPreview.removed_count > 0) ? '0.5rem' : 0 }}>
                    {syncing ? 'Refreshing...' : 'Refresh Episode Metadata'}
                  </button>
                )}

                <div className="admin-anime-list">
                  {(syncPreview.items || syncPreview.series || []).map(s => (
                    <div key={s.jellyfin_id} className="admin-anime-item">
                      <div className="info" style={{ flex: 1 }}>
                        <h4>{s.name}</h4>
                        <span style={{ display: 'inline-block', fontSize: '0.72rem', color: 'var(--accent)', background: 'rgba(192,91,255,0.12)', borderRadius: '999px', padding: '0.15rem 0.5rem', marginBottom: '0.35rem' }}>
                          {syncItemTypeLabel(s)}
                        </span>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{s.path}</p>
                      </div>
                      <div className="actions">
                        {s.already_exists ? (
                          <span style={{ fontSize: '0.8rem', color: '#22c55e', padding: '0.25rem 0.75rem', background: 'rgba(34,197,94,0.1)', borderRadius: '999px' }}>✓ Synced</span>
                        ) : (
                          <button className="btn btn-primary btn-sm" onClick={() => syncSeries([s.jellyfin_id])} disabled={syncing}>
                            {syncing ? '...' : 'Import'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {syncPreview.stale_series?.length > 0 && (
                  <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 'var(--radius)' }}>
                    <h4 style={{ marginBottom: '0.5rem', color: '#fca5a5' }}>Missing from Jellyfin</h4>
                    {syncPreview.stale_series.map(s => (
                      <div key={s.jellyfin_id} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.45rem 0', borderBottom: '1px solid rgba(248,113,113,0.15)', fontSize: '0.85rem' }}>
                        <span>{s.title}</span>
                        <span style={{ color: '#fca5a5' }}>Will be removed on sync</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {syncResults && (
              <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius)' }}>
                <h4 style={{ marginBottom: '0.5rem' }}>Sync Results</h4>
                {syncResults.results?.map((r, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.9rem' }}>
                    <span>{r.name} <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>({syncItemTypeLabel(r)})</span></span>
                    <span style={{ color: r.status === 'error' ? '#ef4444' : r.status === 'created' ? '#22c55e' : 'var(--text-secondary)' }}>
                      {syncResultText(r)}
                    </span>
                  </div>
                ))}
                {syncResults.removed_series?.map(series => (
                  <div key={series.jellyfin_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.9rem' }}>
                    <span>{series.title}</span>
                    <span style={{ color: '#f87171' }}>Removed - missing from Jellyfin</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ADD ANIME TAB */}
      {tab === 'add' && (
        <div>
          <div className="admin-card">
            <h3>🔍 Import from AniList</h3>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input className="form-input" placeholder="Search AniList..." value={anilistQuery}
                onChange={e => setAnilistQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && searchAnilist()} />
              <button className="btn btn-primary" onClick={searchAnilist}>Search</button>
            </div>
            {anilistResults.length > 0 && (
              <div className="admin-anime-list" style={{ marginTop: '1rem' }}>
                {anilistResults.map(r => (
                  <div key={r.anilist_id} className="admin-anime-item" onClick={() => importFromAnilist(r.anilist_id)} style={{ cursor: 'pointer' }}>
                    <img src={r.cover_image} alt={r.title} />
                    <div className="info">
                      <h4>{r.title}</h4>
                      <p>{r.year} • {r.format} • {r.episodes || '?'} eps • ⭐ {r.rating}%</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <form className="admin-card" onSubmit={saveAnime}>
            <h3>📝 Anime Details</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label>Title *</label>
                <input className="form-input" required value={form.title || ''} onChange={e => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Romaji Title</label>
                <input className="form-input" value={form.title_romaji || ''} onChange={e => setForm({ ...form, title_romaji: e.target.value })} />
              </div>
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label>Description</label>
                <textarea className="form-input" value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Cover Image URL</label>
                <input className="form-input" value={form.cover_image || ''} onChange={e => setForm({ ...form, cover_image: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Banner Image URL</label>
                <input className="form-input" value={form.banner_image || ''} onChange={e => setForm({ ...form, banner_image: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Genres (comma separated)</label>
                <input className="form-input" value={form.genres || ''} onChange={e => setForm({ ...form, genres: e.target.value })} placeholder="Action, Adventure, Fantasy" />
              </div>
              <div className="form-group">
                <label>Status</label>
                <select className="form-input" value={form.status || ''} onChange={e => setForm({ ...form, status: e.target.value })}>
                  <option value="">Select...</option>
                  <option value="FINISHED">Finished</option>
                  <option value="RELEASING">Releasing</option>
                  <option value="NOT_YET_RELEASED">Not Yet Released</option>
                </select>
              </div>
              <div className="form-group">
                <label>Total Episodes</label>
                <input className="form-input" type="number" value={form.episodes_total || ''} onChange={e => setForm({ ...form, episodes_total: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Rating (%)</label>
                <input className="form-input" type="number" value={form.rating || ''} onChange={e => setForm({ ...form, rating: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Year</label>
                <input className="form-input" type="number" value={form.year || ''} onChange={e => setForm({ ...form, year: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Format</label>
                <select className="form-input" value={form.format || ''} onChange={e => setForm({ ...form, format: e.target.value })}>
                  <option value="">Select...</option>
                  <option value="TV">TV</option>
                  <option value="MOVIE">Movie</option>
                  <option value="OVA">OVA</option>
                  <option value="ONA">ONA</option>
                  <option value="SPECIAL">Special</option>
                </select>
              </div>
            </div>
            {form.cover_image && (
              <div style={{ marginTop: '1rem' }}>
                <img src={form.cover_image} alt="Preview" style={{ width: '100px', borderRadius: '8px' }} />
              </div>
            )}
            <button type="submit" className="btn btn-primary" style={{ marginTop: '1rem' }}>Save Anime</button>
          </form>
        </div>
      )}

      {/* MANAGE TAB */}
      {tab === 'manage' && (
        <div className="admin-card">
          <h3>Your Library ({animeList.length} anime)</h3>
          {animeList.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No anime added yet. Go to "Add Anime" tab.</p>
          ) : (
            <div className="admin-anime-list">
              {animeList.map(a => (
                <div key={a.id} className="admin-anime-item">
                  <img src={a.cover_image || '/placeholder.png'} alt={a.title} />
                  <div className="info">
                    <h4>{a.title}</h4>
                    <p>{a.episode_count} episodes linked • {a.year || 'N/A'} • ⭐ {a.rating || 'N/A'}%</p>
                  </div>
                  <div className="actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => selectAnime(a)}>Episodes</button>
                    <button className="btn btn-sm" style={{ color: '#ef4444' }} onClick={() => deleteAnime(a.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* EPISODES TAB */}
      {tab === 'episodes' && (
        <div>
          {!selectedAnime ? (
            <div className="admin-card">
              <h3>Select an anime</h3>
              <div className="admin-anime-list">
                {animeList.map(a => (
                  <div key={a.id} className="admin-anime-item" onClick={() => selectAnime(a)} style={{ cursor: 'pointer' }}>
                    <img src={a.cover_image || '/placeholder.png'} alt={a.title} />
                    <div className="info">
                      <h4>{a.title}</h4>
                      <p>{a.episode_count} episodes</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="admin-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3>📂 {selectedAnime.title} — Episodes</h3>
                  <button className="btn btn-secondary btn-sm" onClick={() => setSelectedAnime(null)}>← Back</button>
                </div>

                {selectedAnime.episodes?.length > 0 && (
                  <div className="episode-grid" style={{ marginBottom: '1.5rem' }}>
                    {selectedAnime.episodes.map(ep => (
                      <div key={ep.id} className="admin-episode-editor">
                        <div className="episode-item">
                        <span className="episode-number">{ep.episode_number}</span>
                        <span className="episode-title">{ep.title || `Episode ${ep.episode_number}`}</span>
                        <span className="episode-admin-path">
                          {ep.file_path}
                        </span>
                        <span className="episode-admin-meta">
                          {formatEpisodeDate(ep.air_date)} | {formatEpisodeRuntime(ep.duration)}
                        </span>
                        {Boolean(ep.manual_metadata) && <span className="episode-admin-badge">Manual</span>}
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => startEditEpisode(ep)}>
                          {editingEpisodeId === ep.id ? 'Editing' : 'Edit'}
                        </button>
                        <button type="button" className="btn btn-sm" style={{ color: '#ef4444' }} onClick={() => deleteEpisode(ep.id)}>✕</button>
                        </div>

                        {editingEpisodeId === ep.id && (
                          <form className="episode-metadata-form" onSubmit={saveEpisode}>
                            <div className="form-grid episode-metadata-grid">
                              <div className="form-group">
                                <label>EP #</label>
                                <input className="form-input" type="number" required value={episodeEditForm.episode_number}
                                  onChange={e => setEpisodeEditForm({ ...episodeEditForm, episode_number: e.target.value })} />
                              </div>
                              <div className="form-group">
                                <label>Air Date</label>
                                <input className="form-input" type="date" value={episodeEditForm.air_date}
                                  onChange={e => setEpisodeEditForm({ ...episodeEditForm, air_date: e.target.value })} />
                              </div>
                              <div className="form-group">
                                <label>Runtime</label>
                                <input className="form-input" type="number" min="1" value={episodeEditForm.runtime_minutes}
                                  onChange={e => setEpisodeEditForm({ ...episodeEditForm, runtime_minutes: e.target.value })} placeholder="Minutes" />
                              </div>
                              <div className="form-group episode-metadata-title">
                                <label>Title</label>
                                <input className="form-input" value={episodeEditForm.title}
                                  onChange={e => setEpisodeEditForm({ ...episodeEditForm, title: e.target.value })} />
                              </div>
                              <div className="form-group episode-metadata-path">
                                <label>File Path</label>
                                <input className="form-input" required value={episodeEditForm.file_path}
                                  onChange={e => setEpisodeEditForm({ ...episodeEditForm, file_path: e.target.value })} />
                              </div>
                              <div className="form-group episode-metadata-overview">
                                <label>Overview</label>
                                <textarea className="form-input" value={episodeEditForm.overview}
                                  onChange={e => setEpisodeEditForm({ ...episodeEditForm, overview: e.target.value })} />
                              </div>
                            </div>
                            <div className="episode-metadata-actions">
                              <button type="submit" className="btn btn-primary btn-sm">Save Metadata</button>
                              <button type="button" className="btn btn-secondary btn-sm" onClick={cancelEditEpisode}>Cancel</button>
                            </div>
                          </form>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <form className="admin-card" onSubmit={addEpisode}>
                <h3>➕ Add Episode</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>EP #</label>
                    <input className="form-input" type="number" required value={epForm.episode_number}
                      onChange={e => setEpForm({ ...epForm, episode_number: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Title (optional)</label>
                    <input className="form-input" value={epForm.title}
                      onChange={e => setEpForm({ ...epForm, title: e.target.value })} placeholder="Episode title" />
                  </div>
                  <div className="form-group">
                    <label>File Path *</label>
                    <input className="form-input" required value={epForm.file_path}
                      onChange={e => setEpForm({ ...epForm, file_path: e.target.value })}
                      placeholder="e.g. Naruto/S01E01.mp4" />
                  </div>
                </div>
                <button type="submit" className="btn btn-primary" style={{ marginTop: '0.5rem' }}>Add Episode</button>
              </form>
            </>
          )}
        </div>
      )}

      {toast && (
        <div className="toast-container">
          <div className={`toast ${toast.type}`}>{toast.msg}</div>
        </div>
      )}
    </div>
  );
}
