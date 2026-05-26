const DEFAULT_ANIME_SERIES_JELLYFIN_ROOT = '/media/anime';
const DEFAULT_ANIME_MOVIE_JELLYFIN_ROOT = '/media/anime_movies';

export function normalizeSlash(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map(item => normalizeSlash(item.trim()))
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function isPathInsideRoot(filePath, root) {
  const normalizedPath = normalizeSlash(filePath).toLowerCase();
  const normalizedRoot = normalizeSlash(root).toLowerCase();

  if (!normalizedPath || !normalizedRoot) return false;
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

export function relativeFromRoot(filePath, root) {
  const normalizedPath = normalizeSlash(filePath);
  const normalizedRoot = normalizeSlash(root);

  if (!normalizedPath || !normalizedRoot) return null;
  if (normalizedPath.toLowerCase() === normalizedRoot.toLowerCase()) return '';
  if (normalizedPath.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }

  return null;
}

export function jellyfinAnimeMovieRoots() {
  return unique([
    ...splitList(process.env.JELLYFIN_ANIME_MOVIE_ROOTS),
    process.env.JELLYFIN_ANIME_MOVIE_ROOT,
    process.env.SEERR_ANIME_MOVIE_ROOT_FOLDER,
    DEFAULT_ANIME_MOVIE_JELLYFIN_ROOT,
  ].map(normalizeSlash));
}

export function isJellyfinAnimeMoviePath(filePath) {
  return jellyfinAnimeMovieRoots().some(root => isPathInsideRoot(filePath, root));
}

export function mediaRootMappings() {
  const seriesLocalRoot = process.env.MEDIA_ROOT || DEFAULT_ANIME_SERIES_JELLYFIN_ROOT;
  const seriesJellyfinRoot = process.env.JELLYFIN_MEDIA_ROOT || process.env.MEDIA_ROOT || DEFAULT_ANIME_SERIES_JELLYFIN_ROOT;
  const movieLocalRoot = process.env.ANIME_MOVIE_ROOT || process.env.MEDIA_ANIME_MOVIE_ROOT || null;
  const movieJellyfinRoot = process.env.JELLYFIN_ANIME_MOVIE_ROOT
    || process.env.SEERR_ANIME_MOVIE_ROOT_FOLDER
    || DEFAULT_ANIME_MOVIE_JELLYFIN_ROOT;
  const mappings = [{
    kind: 'series',
    root: seriesLocalRoot,
    jellyfinRoot: seriesJellyfinRoot,
  }];

  if (movieLocalRoot) {
    mappings.push({
      kind: 'movie',
      root: movieLocalRoot,
      jellyfinRoot: movieJellyfinRoot,
    });
  }

  const seen = new Set();
  return mappings
    .map(mapping => ({
      ...mapping,
      root: normalizeSlash(mapping.root),
      jellyfinRoot: normalizeSlash(mapping.jellyfinRoot),
    }))
    .filter(mapping => {
      const key = `${mapping.root}|${mapping.jellyfinRoot}`;
      if (!mapping.root || !mapping.jellyfinRoot || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
