const EPISODE_AIR_DATE_OVERRIDES = [
  {
    anilistId: 5081,
    titles: ['Bakemonogatari'],
    dates: {
      13: '2009-11-03',
      14: '2010-02-23',
      15: '2010-06-25',
    },
  },
];

export function getEpisodeAirDateOverride(series, episodeNumber) {
  const normalizedTitle = series?.title?.trim().toLowerCase();
  const numericEpisode = Number(episodeNumber);

  const override = EPISODE_AIR_DATE_OVERRIDES.find(entry => {
    if (series?.anilistId && Number(series.anilistId) === entry.anilistId) return true;
    return entry.titles.some(title => title.toLowerCase() === normalizedTitle);
  });

  return override?.dates?.[numericEpisode] || null;
}
