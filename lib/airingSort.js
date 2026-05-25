export const AIRING_SORT_OPTIONS = [
  { key: 'title', label: 'Title' },
  { key: 'next-airing', label: 'Next Airing Episode' },
  { key: 'popularity', label: 'Popularity' },
  { key: 'score', label: 'Score' },
  { key: 'studio', label: 'Studio' },
  { key: 'start-date', label: 'Start Date' },
  { key: 'end-date', label: 'End Date' },
];

const VALID_SORT_KEYS = new Set(AIRING_SORT_OPTIONS.map(option => option.key));

export function normalizeAiringSort(value) {
  const sortKey = String(value || '').trim().toLowerCase();
  return VALID_SORT_KEYS.has(sortKey) ? sortKey : 'popularity';
}

export function titleForAnime(anime) {
  return anime.title || anime.title_romaji || anime.title_english || 'Untitled';
}

function numericDesc(value) {
  return Number.isFinite(Number(value)) ? Number(value) : -1;
}

function timestampAsc(value) {
  return Number.isFinite(Number(value)) ? Number(value) : Number.MAX_SAFE_INTEGER;
}

function textValue(value) {
  return String(value || '').trim().toLowerCase();
}

function optionalTextValue(value) {
  return textValue(value) || '\uffff';
}

function dateValue(value) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const numeric = Number(String(value).replace(/-/g, ''));
  return Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER;
}

function compareAnime(a, b, sortKey) {
  switch (sortKey) {
    case 'next-airing':
      return timestampAsc(a.next_airing_episode?.airingAt) - timestampAsc(b.next_airing_episode?.airingAt);
    case 'score':
      return numericDesc(b.rating) - numericDesc(a.rating);
    case 'title':
      return textValue(titleForAnime(a)).localeCompare(textValue(titleForAnime(b)));
    case 'studio':
      return optionalTextValue(a.studios?.[0]).localeCompare(optionalTextValue(b.studios?.[0]))
        || textValue(titleForAnime(a)).localeCompare(textValue(titleForAnime(b)));
    case 'start-date':
      return dateValue(a.start_date) - dateValue(b.start_date)
        || textValue(titleForAnime(a)).localeCompare(textValue(titleForAnime(b)));
    case 'end-date':
      return dateValue(a.end_date) - dateValue(b.end_date)
        || textValue(titleForAnime(a)).localeCompare(textValue(titleForAnime(b)));
    case 'popularity':
    default:
      return numericDesc(b.popularity) - numericDesc(a.popularity);
  }
}

export function sortAnime(items, sortKey) {
  const normalizedSort = normalizeAiringSort(sortKey);

  return [...items]
    .map((item, index) => ({ item, index }))
    .sort((left, right) => compareAnime(left.item, right.item, normalizedSort) || left.index - right.index)
    .map(entry => entry.item);
}

export function sortAiringGroups(groups, sortKey) {
  return (groups || []).map(group => ({
    ...group,
    anime: sortAnime(group.anime || [], sortKey),
  }));
}
