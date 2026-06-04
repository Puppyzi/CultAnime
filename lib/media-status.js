export function shouldShowReleasingBadge(anime) {
  const status = String(anime?.status || '').trim().toUpperCase();
  if (status !== 'RELEASING') return false;

  const availableEpisodes = Number(anime?.episode_count);
  const totalEpisodes = Number(anime?.episodes_total);

  if (
    Number.isFinite(availableEpisodes) &&
    Number.isFinite(totalEpisodes) &&
    totalEpisodes > 0 &&
    availableEpisodes >= totalEpisodes
  ) {
    return false;
  }

  return true;
}

export function mediaStatusBadgeLabel(anime) {
  return shouldShowReleasingBadge(anime) ? 'RELEASING' : '';
}
