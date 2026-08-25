export const emptyEpisodeEditForm = {
  id: '', episode_number: '', title: '', file_path: '', air_date: '', runtime_minutes: '', overview: '',
};

export function formatEpisodeDate(value) {
  if (!value) return 'No date';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

export function formatEpisodeRuntime(seconds) {
  if (!seconds) return 'No runtime';
  return `${Math.max(1, Math.round(Number(seconds) / 60))}m`;
}

export function syncItemTypeLabel(item) {
  return item?.item_type === 'movie' ? 'Movie' : 'Series';
}

export function syncUnit(count, itemType) {
  const value = Number(count) || 0;
  const unit = itemType === 'movie' ? 'movie file' : 'episode';
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

export function syncResultText(result) {
  if (result.status === 'created') return `Created - ${syncUnit(result.episodes_added, result.item_type)}`;
  if (result.status === 'updated') {
    const parts = [`${syncUnit(result.episodes_added, result.item_type)} new`, `${result.episodes_updated || 0} refreshed`];
    if (result.episodes_removed) parts.push(`${syncUnit(result.episodes_removed, result.item_type)} removed`);
    return `Updated - ${parts.join(', ')}`;
  }
  if (result.status === 'error') return `Error: ${result.error}`;
  return result.status;
}

export function episodeToEditForm(episode) {
  return {
    id: episode.id,
    episode_number: String(episode.episode_number || ''),
    title: episode.title || '',
    file_path: episode.file_path || '',
    air_date: episode.air_date || '',
    runtime_minutes: episode.duration ? String(Math.max(1, Math.round(Number(episode.duration) / 60))) : '',
    overview: episode.overview || '',
  };
}
