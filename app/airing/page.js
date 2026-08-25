import AiringClient from './AiringClient';
import { getAiringAnime } from '../../lib/anilist';
import { normalizeAiringSort, sortAiringGroups } from '../../lib/airingSort';

export const dynamic = 'force-dynamic';

export default async function AiringPage({ searchParams }) {
  const params = await searchParams;
  const sort = normalizeAiringSort(Array.isArray(params?.sort) ? params.sort[0] : params?.sort);

  let data = { groups: [], season: '', year: '' };
  let initialError = '';
  try {
    data = await getAiringAnime();
  } catch (error) {
    initialError = error.message || 'Could not load airing anime.';
  }

  return (
    <AiringClient
      key={sort}
      initialGroups={sortAiringGroups(data.groups, sort)}
      initialSeason={data.season}
      initialYear={data.year}
      initialSort={sort}
      initialError={initialError}
    />
  );
}
